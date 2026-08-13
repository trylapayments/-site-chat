"use client";

import {
  internalNoteSchema,
  mergeInternalNotes,
  type ConnectionState,
  type InternalNote,
} from "@site-chat/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { listInternalNotesAction } from "@/lib/inbox/actions";
import {
  subscribeOperatorInternalNotes,
  subscribeOperatorNotifications,
} from "@/lib/realtime/operator-subscriptions";

function rowToPartialNote(row: Record<string, unknown>): InternalNote | null {
  const parsed = internalNoteSchema.safeParse({
    ...row,
    author_display_label:
      typeof row.author_display_label === "string"
        ? row.author_display_label
        : "Teammate",
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
  const catchUpInFlight = useRef(false);
  const notesRef = useRef(notes);
  notesRef.current = notes;

  useEffect(() => {
    setNotes(input.initialNotes);
  }, [input.conversationId, input.initialNotes]);

  const catchUp = useCallback(async () => {
    if (!input.enabled || catchUpInFlight.current) {
      return;
    }
    catchUpInFlight.current = true;
    try {
      const result = await listInternalNotesAction(input.workspaceSlug, {
        conversationId: input.conversationId,
        limit: 100,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      setError(null);
      setNotes((current) => mergeInternalNotes(current, result.data.items));
    } finally {
      catchUpInFlight.current = false;
    }
  }, [input.conversationId, input.enabled, input.workspaceSlug]);

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
          void catchUp();
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
        // Mentions / author label may be missing on CDC — catch up for durable shape.
        void catchUp();
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
            void catchUp();
          },
        })
      : () => undefined;

    return () => {
      unsubscribeNotes();
      unsubscribeNotifications();
    };
  }, [
    catchUp,
    input.conversationId,
    input.enabled,
    input.memberId,
    input.workspaceId,
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
    retry: catchUp,
  };
}
