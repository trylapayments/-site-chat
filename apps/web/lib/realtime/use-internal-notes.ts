"use client";

import {
  advanceNotesCatchUpWatermark,
  applyInternalNoteRealtimeChange,
  internalNoteSchema,
  reconcileNotesCatchUp,
  seedNotesCatchUpWatermark,
  type ConnectionState,
  type InternalNote,
} from "@site-chat/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { listInternalNotesAction } from "@/lib/inbox/actions";
import {
  subscribeOperatorInternalNotes,
  subscribeOperatorNotifications,
} from "@/lib/realtime/operator-subscriptions";

/**
 * Map a Realtime CDC row to InternalNote. Pick known fields only — table rows
 * include generated columns (e.g. search_vector) that fail strict schema parse.
 */
function rowToPartialNote(row: Record<string, unknown>): InternalNote | null {
  const parsed = internalNoteSchema.safeParse({
    id: row.id,
    workspace_id: row.workspace_id,
    conversation_id: row.conversation_id,
    author_member_id: row.author_member_id ?? null,
    author_display_label:
      typeof row.author_display_label === "string"
        ? row.author_display_label
        : "Teammate",
    body: row.body,
    client_note_id: row.client_note_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
    mentions: Array.isArray(row.mentions) ? row.mentions : [],
  });
  return parsed.success ? parsed.data : null;
}

export function useLiveInternalNotes(input: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  memberId: string;
  initialNotes: InternalNote[];
  enabled: boolean;
  /** When the notes tab becomes visible, refresh so peers catch creates without CDC. */
  active?: boolean;
}) {
  const [notes, setNotes] = useState<InternalNote[]>(input.initialNotes);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [mentionFlash, setMentionFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notesRef = useRef(notes);
  notesRef.current = notes;

  /** Bumped on conversation change so stale catch-up never merges into the wrong thread. */
  const conversationGenerationRef = useRef(0);
  /** Monotonic id: only the latest in-flight catch-up for this generation may apply. */
  const catchUpRequestRef = useRef(0);
  const conversationIdRef = useRef(input.conversationId);
  conversationIdRef.current = input.conversationId;
  const catchUpSinceRef = useRef<string | null>(
    seedNotesCatchUpWatermark(input.initialNotes),
  );
  const initialNotesRef = useRef(input.initialNotes);
  initialNotesRef.current = input.initialNotes;
  /**
   * Session-local soft-delete ids. Prevents an in-flight catch-up that still
   * lists a note from resurrecting it after the operator deleted it.
   */
  const localTombstoneIdsRef = useRef<Set<string>>(new Set());

  const invalidateInFlight = useCallback(() => {
    conversationGenerationRef.current += 1;
    catchUpRequestRef.current += 1;
  }, []);

  const markNoteDeleted = useCallback(
    (noteId: string) => {
      localTombstoneIdsRef.current.add(noteId);
      // Drop any catch-up that started before this delete — it may still contain
      // the note and would otherwise re-merge it into local state.
      invalidateInFlight();
      setNotes((current) => current.filter((note) => note.id !== noteId));
    },
    [invalidateInFlight],
  );

  const clearLocalTombstone = useCallback((noteId: string) => {
    localTombstoneIdsRef.current.delete(noteId);
  }, []);

  // Reset only when the conversation changes — do NOT depend on initialNotes
  // referential identity (parent re-renders would abort peer catch-up).
  useEffect(() => {
    invalidateInFlight();
    localTombstoneIdsRef.current = new Set();
    setNotes(initialNotesRef.current);
    catchUpSinceRef.current = seedNotesCatchUpWatermark(
      initialNotesRef.current,
    );
    setError(null);
    setConnectionState("connecting");
  }, [input.conversationId, invalidateInFlight]);

  const catchUp = useCallback(async () => {
    if (!input.enabled) {
      return;
    }

    const generation = conversationGenerationRef.current;
    const requestId = ++catchUpRequestRef.current;
    const conversationId = input.conversationId;
    const watermark = catchUpSinceRef.current;

    try {
      const result = await listInternalNotesAction(input.workspaceSlug, {
        conversationId,
        limit: 100,
        authoritative: true,
        // Pass watermark only when it originated from server note timestamps.
        ...(watermark ? { catch_up_since: watermark } : {}),
      });

      // Ignore stale responses: a newer catch-up or conversation switch won.
      if (
        requestId !== catchUpRequestRef.current ||
        generation !== conversationGenerationRef.current ||
        conversationId !== conversationIdRef.current
      ) {
        return;
      }

      if (!result.success) {
        setError(result.message);
        return;
      }

      setError(null);
      const localTombstones: InternalNote[] = [
        ...localTombstoneIdsRef.current,
      ].map((id) => ({
        id,
        workspace_id: input.workspaceId,
        conversation_id: conversationId,
        author_member_id: null,
        author_display_label: "Former member",
        body: "(deleted)",
        client_note_id: null,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
        deleted_at: new Date().toISOString(),
        mentions: [],
      }));
      const tombstones = [...result.data.tombstones, ...localTombstones];
      setNotes((current) =>
        reconcileNotesCatchUp(current, result.data.items, tombstones, {
          authoritativeReplace: true,
        }),
      );
      // Advance only from server-originated timestamps (RPC cursor + rows).
      catchUpSinceRef.current = advanceNotesCatchUpWatermark(
        watermark,
        result.data.items,
        result.data.tombstones,
        result.data.server_watermark,
      );
    } catch (err) {
      if (
        requestId !== catchUpRequestRef.current ||
        generation !== conversationGenerationRef.current ||
        conversationId !== conversationIdRef.current
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : "Unable to load notes.");
    }
  }, [
    input.conversationId,
    input.enabled,
    input.workspaceId,
    input.workspaceSlug,
  ]);

  useEffect(() => {
    if (!input.enabled) {
      setConnectionState("disconnected");
      return;
    }

    const unsubscribeNotes = subscribeOperatorInternalNotes({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      onConnectionChange: (status) => {
        setConnectionState(status);
        if (status === "connected") {
          // Watermarked authoritative catch-up reconciles missed soft-deletes.
          void catchUp();
        }
      },
      onNoteChange: (payload) => {
        const row = (payload.new ?? payload) as Record<string, unknown>;
        // Soft-delete may arrive before strict parse succeeds — prefer id + deleted_at.
        if (typeof row.id === "string" && row.deleted_at) {
          localTombstoneIdsRef.current.add(row.id);
          setNotes((current) => current.filter((note) => note.id !== row.id));
          // Lightweight local merge is enough; no full resync.
          return;
        }
        const partial = rowToPartialNote(row);
        if (!partial) {
          // Incomplete CDC row — resync once with watermark.
          void catchUp();
          return;
        }
        if (
          partial.deleted_at ||
          localTombstoneIdsRef.current.has(partial.id)
        ) {
          localTombstoneIdsRef.current.add(partial.id);
          setNotes((current) =>
            current.filter((note) => note.id !== partial.id),
          );
          return;
        }
        // Optimistic CDC merge; mentions/author label may be incomplete until
        // tab focus / reconnect catch-up, but avoid per-event DB resync.
        setNotes((current) =>
          applyInternalNoteRealtimeChange(current, partial),
        );
      },
    });

    const unsubscribeNotifications = input.memberId
      ? subscribeOperatorNotifications({
          workspaceId: input.workspaceId,
          memberId: input.memberId,
          onInsert: (payload) => {
            const row = (payload.new ?? payload) as Record<string, unknown>;
            if (row.type !== "mention") {
              return;
            }
            if (row.resource_type !== "internal_note") {
              return;
            }
            const title =
              typeof row.title === "string"
                ? row.title
                : "You were mentioned in an internal note";
            setMentionFlash(title);
            // Flash only — note CDC / focus catch-up loads the body.
          },
        })
      : () => undefined;

    return () => {
      invalidateInFlight();
      unsubscribeNotes();
      unsubscribeNotifications();
    };
  }, [
    catchUp,
    input.conversationId,
    input.enabled,
    input.memberId,
    input.workspaceId,
    invalidateInFlight,
  ]);

  useEffect(() => {
    if (!mentionFlash) {
      return;
    }
    const timer = setTimeout(() => {
      setMentionFlash(null);
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [mentionFlash]);

  // Tab focus / visibility: peers may miss CDC under multi-tab load.
  useEffect(() => {
    if (!input.enabled || input.active === false) {
      return;
    }
    void catchUp();

    function refreshOnVisible() {
      if (document.visibilityState === "visible") {
        void catchUp();
      }
    }

    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [catchUp, input.active, input.enabled, input.conversationId]);

  return {
    notes,
    setNotes,
    connectionState,
    mentionFlash,
    error,
    markNoteDeleted,
    clearLocalTombstone,
    retry: () => {
      void catchUp();
    },
  };
}
