"use client";

import type {
  ConversationListItem,
  ListConversationsQuery,
} from "@site-chat/shared";
import {
  conversationMatchesFilters,
  genericSenderLabel,
  mergeMessages,
  operatorConversationChangeSchema,
  operatorMessageChangeSchema,
  patchConversationListItem,
  sortConversationItems,
  toMessageViewFromOperatorRow,
  upsertConversationListItem,
  type ConnectionState,
  type MessageView,
} from "@site-chat/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchConversations } from "@/lib/inbox/queries";
import {
  subscribeOperatorConversation,
  subscribeOperatorWorkspaceInbox,
  useOnlineStatus,
} from "@/lib/realtime/operator-subscriptions";
import { createClient } from "@/lib/supabase/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";

export function useLiveInboxList(input: {
  workspaceId: string;
  memberId: string;
  initialItems: ConversationListItem[];
  query: ListConversationsQuery;
}) {
  const [items, setItems] = useState(input.initialItems);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setItems(input.initialItems);
  }, [input.initialItems]);

  const refreshList = useCallback(async () => {
    const supabase = createClient() as AppSupabaseClient;
    const refreshed = await fetchConversations(
      supabase,
      input.workspaceId,
      input.query,
    );
    setItems(refreshed.items);
  }, [input.query, input.workspaceId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      void refreshList();
    }, 250);
  }, [refreshList]);

  useEffect(() => {
    const unsubscribe = subscribeOperatorWorkspaceInbox({
      workspaceId: input.workspaceId,
      onConnectionChange: setConnectionState,
      onMessageInsert: (raw) => {
        const parsed = operatorMessageChangeSchema.safeParse(raw);
        if (!parsed.success || parsed.data.is_internal) {
          return;
        }

        setItems((current) => {
          const existing = current.find(
            (item) => item.id === parsed.data.conversation_id,
          );
          if (!existing) {
            scheduleRefresh();
            return current;
          }

          const next = patchConversationListItem(existing, {
            last_message_at: parsed.data.created_at,
            last_message_preview: parsed.data.body.slice(0, 200),
            message_count: existing.message_count + 1,
            has_unread: parsed.data.sender_type === "visitor",
          });

          return sortConversationItems(
            upsertConversationListItem(
              current,
              next,
              input.query.sort ?? "-last_message_at",
            ),
            input.query.sort ?? "-last_message_at",
          );
        });
      },
      onConversationChange: (raw) => {
        const parsed = operatorConversationChangeSchema.safeParse(raw);
        if (!parsed.success) {
          scheduleRefresh();
          return;
        }

        setItems((current) => {
          const existing = current.find((item) => item.id === parsed.data.id);
          if (!existing) {
            scheduleRefresh();
            return current;
          }

          const patched = patchConversationListItem(existing, parsed.data);
          const matches = conversationMatchesFilters(patched, {
            status: input.query.status,
            assignment: input.query.assignment,
            memberId: input.memberId,
          });

          if (!matches) {
            return current.filter((item) => item.id !== patched.id);
          }

          return sortConversationItems(
            upsertConversationListItem(
              current,
              patched,
              input.query.sort ?? "-last_message_at",
            ),
            input.query.sort ?? "-last_message_at",
          );
        });
      },
    });

    return unsubscribe;
  }, [input.memberId, input.query, input.workspaceId, scheduleRefresh]);

  useOnlineStatus((online) => {
    if (online) {
      void refreshList();
    } else {
      setConnectionState("disconnected");
    }
  });

  useEffect(() => {
    if (connectionState === "connected") {
      void refreshList();
    }
  }, [connectionState, refreshList]);

  return useMemo(
    () => ({
      items,
      connectionState,
      refreshList,
    }),
    [connectionState, items, refreshList],
  );
}

export function useLiveConversationThread(input: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  initialMessages: MessageView[];
}) {
  const [messages, setMessages] = useState<MessageView[]>(
    input.initialMessages,
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const atBottomRef = useRef(true);
  const conversationIdRef = useRef(input.conversationId);
  const maxSequenceRef = useRef(
    input.initialMessages.reduce(
      (max, message) => Math.max(max, message.sequenceNumber),
      0,
    ),
  );

  useEffect(() => {
    setMessages((current) => {
      if (conversationIdRef.current !== input.conversationId) {
        conversationIdRef.current = input.conversationId;
        maxSequenceRef.current = input.initialMessages.reduce(
          (max, message) => Math.max(max, message.sequenceNumber),
          0,
        );
        return input.initialMessages;
      }

      if (
        current.some(
          (message) => message.isOptimistic || message.status === "pending",
        )
      ) {
        return current;
      }

      maxSequenceRef.current = input.initialMessages.reduce(
        (max, message) => Math.max(max, message.sequenceNumber),
        0,
      );
      return input.initialMessages;
    });
  }, [input.conversationId, input.initialMessages]);

  const catchUp = useCallback(async () => {
    const supabase = createClient() as AppSupabaseClient;
    let afterSequence = maxSequenceRef.current;

    for (let page = 0; page < 20; page += 1) {
      const result = await fetchConversationsMessages(
        supabase,
        input.workspaceId,
        input.conversationId,
        afterSequence,
      );

      if (result.length === 0) {
        break;
      }

      setMessages((current) => {
        const merged = mergeMessages(current, result, []);
        maxSequenceRef.current = merged.reduce(
          (max, message) => Math.max(max, message.sequenceNumber),
          0,
        );
        return merged;
      });

      afterSequence = Math.max(
        afterSequence,
        ...result.map((message) => message.sequenceNumber),
      );

      if (result.length < 50) {
        break;
      }
    }
  }, [input.conversationId, input.workspaceId]);

  useEffect(() => {
    const unsubscribe = subscribeOperatorConversation({
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      onConnectionChange: setConnectionState,
      onMessageInsert: (raw) => {
        const parsed = operatorMessageChangeSchema.safeParse(raw);
        if (!parsed.success || parsed.data.is_internal) {
          return;
        }

        const next = toMessageViewFromOperatorRow({
          id: parsed.data.id,
          sequence_number: parsed.data.sequence_number,
          sender_type: parsed.data.sender_type,
          sender_label: genericSenderLabel(parsed.data.sender_type),
          body: parsed.data.body,
          created_at: parsed.data.created_at,
          client_message_id: parsed.data.client_message_id,
          is_internal: parsed.data.is_internal,
        });

        setMessages((current) => {
          const merged = mergeMessages(current, [next], []);
          maxSequenceRef.current = merged.reduce(
            (max, message) => Math.max(max, message.sequenceNumber),
            0,
          );
          return merged;
        });

        if (!atBottomRef.current) {
          setNewMessagesBelow((count) => count + 1);
        }
      },
      onConversationChange: () => {
        // Sidebar/detail enrichment uses targeted RPC elsewhere.
      },
    });

    return unsubscribe;
  }, [input.conversationId, input.workspaceId]);

  useEffect(() => {
    if (connectionState === "connected") {
      void catchUp();
    }
  }, [catchUp, connectionState]);

  useOnlineStatus((online) => {
    if (online) {
      void catchUp();
    } else {
      setConnectionState("disconnected");
    }
  });

  const observeBottom = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        atBottomRef.current = entry?.isIntersecting ?? false;
        if (atBottomRef.current) {
          setNewMessagesBelow(0);
        }
      },
      { rootMargin: "0px 0px 100px 0px" },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    messages,
    setMessages,
    connectionState,
    newMessagesBelow,
    observeBottom,
    catchUp,
  };
}

async function fetchConversationsMessages(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  afterSequence: number,
) {
  const { fetchMessages } = await import("@/lib/inbox/queries");
  const result = await fetchMessages(supabase, workspaceId, conversationId, {
    after_sequence: afterSequence,
    limit: 50,
  });

  return result.items.map((item) =>
    toMessageViewFromOperatorRow({
      id: item.id,
      sequence_number: item.sequence_number,
      sender_type: item.sender_type,
      sender_label: item.sender_label,
      body: item.body,
      created_at: item.created_at,
      client_message_id: item.client_message_id ?? null,
      is_internal: item.is_internal,
    }),
  );
}
