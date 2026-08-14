"use client";

import {
  applyInternalNoteRealtimeChange,
  internalNoteSchema,
  reconcileNotesCatchUp,
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
  const catchUpAbortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef(input.conversationId);
  conversationIdRef.current = input.conversationId;
  const catchUpSinceRef = useRef<string>(new Date().toISOString());
  const initialNotesRef = useRef(input.initialNotes);
  initialNotesRef.current = input.initialNotes;

  const invalidateInFlight = useCallback(() => {
    conversationGenerationRef.current += 1;
    catchUpAbortRef.current?.abort();
    catchUpAbortRef.current = null;
  }, []);

  // Reset only when the conversation changes — do NOT depend on initialNotes
  // referential identity (parent re-renders would abort peer catch-up).
  useEffect(() => {
    invalidateInFlight();
    setNotes(initialNotesRef.current);
    catchUpSinceRef.current = new Date().toISOString();
    setError(null);
    setConnectionState("connecting");
  }, [input.conversationId, invalidateInFlight]);

  const catchUp = useCallback(
    async (mode: "authoritative" | "incremental" = "authoritative") => {
      if (!input.enabled) {
        return;
      }

      const generation = conversationGenerationRef.current;
      const conversationId = input.conversationId;
      catchUpAbortRef.current?.abort();
      const controller = new AbortController();
      catchUpAbortRef.current = controller;

      try {
        const result = await listInternalNotesAction(input.workspaceSlug, {
          conversationId,
          limit: 100,
          authoritative: mode === "authoritative",
          catch_up_since:
            mode === "authoritative" ? undefined : catchUpSinceRef.current,
        });

        if (
          controller.signal.aborted ||
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
        const tombstones = result.data.tombstones;
        setNotes((current) =>
          reconcileNotesCatchUp(current, result.data.items, tombstones, {
            authoritativeReplace:
              mode === "authoritative" || result.data.authoritative,
          }),
        );
        catchUpSinceRef.current = new Date().toISOString();
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        if (
          generation !== conversationGenerationRef.current ||
          conversationId !== conversationIdRef.current
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to load notes.");
      }
    },
    [input.conversationId, input.enabled, input.workspaceSlug],
  );

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
          // Authoritative reload reconciles missed soft-deletes (tombstones).
          void catchUp("authoritative");
        }
      },
      onNoteChange: (payload) => {
        const row = (payload.new ?? payload) as Record<string, unknown>;
        const partial = rowToPartialNote(row);
        if (partial?.deleted_at) {
          setNotes((current) =>
            current.filter((note) => note.id !== partial.id),
          );
          return;
        }
        // Optimistic CDC merge so peers see the note even if catch-up is delayed.
        if (partial) {
          setNotes((current) =>
            applyInternalNoteRealtimeChange(current, partial),
          );
        }
        // Mentions / author label may be incomplete on CDC — refresh.
        void catchUp("authoritative");
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
            void catchUp("authoritative");
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

  return {
    notes,
    setNotes,
    connectionState,
    mentionFlash,
    error,
    retry: () => {
      void catchUp("authoritative");
    },
  };
}
