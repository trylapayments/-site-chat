"use client";

import type { MessageItem, ReceiptCursors } from "@site-chat/shared";
import {
  createOptimisticMessage,
  deriveMessageReceiptStatus,
  genericSenderLabel,
  maxSequenceNumber,
  mergeMessages,
  mergeReceiptCursors,
  toMessageViewFromOperatorRow,
  type MessageView,
} from "@site-chat/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { MessageReceiptIndicator } from "@/components/inbox/MessageReceiptIndicator";
import {
  fetchVisitorReceiptCursorsAction,
  markConversationDeliveredAction,
  markConversationReadAction,
} from "@/lib/inbox/actions";
import { formatRelativeTime } from "@/lib/inbox/search-params";
import {
  subscribeOperatorConversationEphemeral,
  type OperatorEphemeralController,
} from "@/lib/realtime/operator-ephemeral";
import { useLiveConversationThread } from "@/lib/realtime/use-operator-inbox";

function mapInitialMessages(messages: MessageItem[]): MessageView[] {
  return messages.map((message) =>
    toMessageViewFromOperatorRow({
      id: message.id,
      sequence_number: message.sequence_number,
      sender_type: message.sender_type,
      sender_label: message.sender_label,
      body: message.body,
      created_at: message.created_at,
      client_message_id: message.client_message_id ?? null,
      is_internal: message.is_internal,
    }),
  );
}

export function LiveConversationThread({
  workspaceId,
  workspaceSlug,
  conversationId,
  ephemeralTopic,
  memberId,
  memberDisplayLabel,
  initialMessages,
  initialVisitorReceipts,
  canSend,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  ephemeralTopic: string;
  memberId: string;
  memberDisplayLabel?: string | null;
  initialMessages: MessageItem[];
  initialVisitorReceipts: ReceiptCursors;
  canSend: boolean;
}) {
  // Stabilize mapped props so useLiveConversationThread's effect does not see a
  // fresh array reference on every parent re-render.
  const mappedInitialMessages = useMemo(
    () => mapInitialMessages(initialMessages),
    [initialMessages],
  );

  const [visitorTyping, setVisitorTyping] = useState(false);
  const [visitorOnline, setVisitorOnline] = useState(false);
  const [visitorReceipts, setVisitorReceipts] = useState<ReceiptCursors>(
    initialVisitorReceipts,
  );
  const ephemeralRef = useRef<OperatorEphemeralController | null>(null);
  const lastReadBroadcastRef = useRef(0);
  const lastDeliveredRef = useRef(0);

  const {
    messages,
    setMessages,
    connectionState,
    newMessagesBelow,
    observeBottom,
    catchUp,
  } = useLiveConversationThread({
    workspaceId,
    workspaceSlug,
    conversationId,
    initialMessages: mappedInitialMessages,
    onVisitorReceiptCursors: (cursors) => {
      setVisitorReceipts((current) => {
        const merged = mergeReceiptCursors(current, cursors);
        return merged.advanced ? merged.next : current;
      });
    },
  });

  const initialDelivered = initialVisitorReceipts.lastDeliveredSequence;
  const initialRead = initialVisitorReceipts.lastReadSequence;

  useEffect(() => {
    setVisitorReceipts({
      lastDeliveredSequence: initialDelivered,
      lastReadSequence: initialRead,
    });
  }, [conversationId, initialDelivered, initialRead]);

  useEffect(() => {
    setVisitorTyping(false);
    setVisitorOnline(false);

    if (!ephemeralTopic || !memberId) {
      return;
    }

    const controller = subscribeOperatorConversationEphemeral({
      ephemeralTopic,
      memberId,
      displayLabel: memberDisplayLabel,
      initialVisitorReceipts: {
        lastDeliveredSequence: initialDelivered,
        lastReadSequence: initialRead,
      },
      onVisitorTyping: (indicator) => {
        setVisitorTyping(indicator.active);
      },
      onVisitorPresence: (presence) => {
        setVisitorOnline(presence.online);
      },
      onVisitorReceipts: (cursors) => {
        // Monotonic merge — never replace with a stale receipt.v1 after CDC
        // already advanced the durable watermark.
        setVisitorReceipts((current) => {
          const merged = mergeReceiptCursors(current, cursors);
          return merged.advanced ? merged.next : current;
        });
      },
      onSubscribed: () => {
        // Durable catch-up after (re)subscribe — covers missed receipt.v1.
        void (async () => {
          const result = await fetchVisitorReceiptCursorsAction(workspaceSlug, {
            conversationId,
          });
          if (!result.success) {
            return;
          }
          setVisitorReceipts((current) => {
            const merged = mergeReceiptCursors(current, result.data);
            return merged.advanced ? merged.next : current;
          });
        })();
      },
    });

    ephemeralRef.current = controller;

    return () => {
      ephemeralRef.current = null;
      controller.unsubscribe();
      setVisitorTyping(false);
      setVisitorOnline(false);
    };
  }, [
    conversationId,
    ephemeralTopic,
    initialDelivered,
    initialRead,
    memberDisplayLabel,
    memberId,
    workspaceSlug,
  ]);

  const markReadThrough = useCallback(
    (sequence: number) => {
      if (sequence <= lastReadBroadcastRef.current) {
        return;
      }

      void (async () => {
        const result = await markConversationReadAction(workspaceSlug, {
          conversationId,
          throughSequence: sequence,
        });

        if (
          !result.success ||
          !result.data ||
          !("last_read_sequence" in result.data)
        ) {
          return;
        }

        const readResult = result.data;
        const watermark = readResult.last_read_sequence;
        // Mirror durable watermark even when RPC no-ops (e.g. page-level
        // MarkConversationRead already advanced the cursor) so the visitor
        // still receives receipt.v1.
        if (watermark <= lastReadBroadcastRef.current) {
          return;
        }

        lastReadBroadcastRef.current = watermark;
        lastDeliveredRef.current = Math.max(
          lastDeliveredRef.current,
          watermark,
        );
        ephemeralRef.current?.broadcastReceipt({
          kind: "read",
          lastDeliveredSequence: watermark,
          lastReadSequence: watermark,
        });
      })();
    },
    [conversationId, workspaceSlug],
  );

  const markDeliveredThrough = useCallback(
    (sequence: number) => {
      if (sequence <= lastDeliveredRef.current) {
        return;
      }

      void (async () => {
        const result = await markConversationDeliveredAction(workspaceSlug, {
          conversationId,
          throughSequence: sequence,
        });

        if (
          !result.success ||
          !result.data ||
          !("last_delivered_sequence" in result.data)
        ) {
          return;
        }

        const delivered = result.data;
        const watermark = delivered.last_delivered_sequence;
        if (watermark <= lastDeliveredRef.current) {
          return;
        }

        lastDeliveredRef.current = watermark;
        ephemeralRef.current?.broadcastReceipt({
          kind: "delivered",
          lastDeliveredSequence: watermark,
          lastReadSequence: lastReadBroadcastRef.current,
        });
      })();
    },
    [conversationId, workspaceSlug],
  );

  return (
    <div className="space-y-4">
      <span
        data-testid="thread-realtime-ready"
        data-realtime-state={connectionState}
        hidden
      />
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-muted-foreground text-xs"
          data-testid="visitor-presence"
          data-presence={visitorOnline ? "online" : "offline"}
        >
          <span
            className={
              visitorOnline
                ? "bg-emerald-500 mr-1.5 inline-block size-1.5 rounded-full"
                : "bg-muted-foreground/40 mr-1.5 inline-block size-1.5 rounded-full"
            }
            aria-hidden="true"
          />
          {visitorOnline ? "Online" : "Offline"}
        </p>
      </div>
      <ConnectionBanner
        state={connectionState}
        onRetry={() => {
          void catchUp();
        }}
      />
      <MessageList
        messages={messages}
        visitorReceipts={visitorReceipts}
        bottomRef={observeBottom}
      />
      {newMessagesBelow > 0 ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              observeBottom(document.createElement("div"));
            }}
          >
            New messages
          </Button>
        </div>
      ) : null}
      <div
        className="text-muted-foreground min-h-5 text-xs"
        data-testid="visitor-typing"
        aria-live="polite"
        aria-atomic="true"
      >
        {visitorTyping ? "Visitor is typing…" : null}
      </div>
      <LiveReplyComposer
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        canSend={canSend}
        messages={messages}
        setMessages={setMessages}
        onComposerChange={(text) => {
          ephemeralRef.current?.notifyComposerChange(text);
        }}
        onClearTyping={() => {
          ephemeralRef.current?.clearLocalTyping();
        }}
        onVisitorMessageDisplayed={(sequence) => {
          markDeliveredThrough(sequence);
          markReadThrough(sequence);
        }}
      />
    </div>
  );
}

function MessageList({
  messages,
  visitorReceipts,
  bottomRef,
}: {
  messages: MessageView[];
  visitorReceipts: ReceiptCursors;
  bottomRef: (node: HTMLDivElement | null) => void;
}) {
  if (messages.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No messages in this conversation yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((message) => {
        const receiptStatus =
          message.senderType === "agent" && !message.isOptimistic
            ? deriveMessageReceiptStatus({
                sequenceNumber: message.sequenceNumber,
                peer: visitorReceipts,
              })
            : null;

        return (
          <article
            key={message.id}
            className={
              message.senderType === "agent"
                ? "bg-primary/5 ml-8 rounded-lg border px-4 py-3"
                : "bg-muted/40 mr-8 rounded-lg border px-4 py-3"
            }
            data-sequence={message.sequenceNumber}
          >
            <header className="mb-1 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{message.senderLabel}</span>
              <time className="text-muted-foreground text-xs">
                {formatRelativeTime(message.createdAt)}
              </time>
            </header>
            <p className="text-sm whitespace-pre-wrap">{message.body}</p>
            {message.status === "pending" ? (
              <p className="text-muted-foreground mt-2 text-xs">Sending...</p>
            ) : null}
            {message.status === "failed" ? (
              <p className="text-destructive mt-2 text-xs">Failed to send</p>
            ) : null}
            {receiptStatus ? (
              <MessageReceiptIndicator status={receiptStatus} />
            ) : null}
          </article>
        );
      })}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

function LiveReplyComposer({
  workspaceSlug,
  conversationId,
  canSend,
  messages,
  setMessages,
  onComposerChange,
  onClearTyping,
  onVisitorMessageDisplayed,
}: {
  workspaceSlug: string;
  conversationId: string;
  canSend: boolean;
  messages: MessageView[];
  setMessages: (updater: (current: MessageView[]) => MessageView[]) => void;
  onComposerChange: (text: string) => void;
  onClearTyping: () => void;
  onVisitorMessageDisplayed: (sequence: number) => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const clientMessageIdRef = useRef<string | null>(null);
  const lastMarkedVisitorSequenceRef = useRef(0);

  useEffect(() => {
    for (const message of messages) {
      if (
        message.senderType === "visitor" &&
        message.sequenceNumber > lastMarkedVisitorSequenceRef.current &&
        !message.isOptimistic
      ) {
        lastMarkedVisitorSequenceRef.current = message.sequenceNumber;
        onVisitorMessageDisplayed(message.sequenceNumber);
      }
    }
  }, [messages, onVisitorMessageDisplayed]);

  const onClearTypingRef = useRef(onClearTyping);
  onClearTypingRef.current = onClearTyping;

  useEffect(() => {
    // Conversation switch: clear composer typing state.
    setBody("");
    onClearTypingRef.current();
  }, [conversationId]);

  if (!canSend) {
    return (
      <p className="text-muted-foreground border-t pt-4 text-sm">
        You have read-only access to this conversation.
      </p>
    );
  }

  return (
    <form
      className="border-t pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const trimmed = body.trim();
        if (!trimmed || isPending) {
          return;
        }

        if (!clientMessageIdRef.current) {
          clientMessageIdRef.current = crypto.randomUUID();
        }

        const clientMessageId = clientMessageIdRef.current;
        const tempId = crypto.randomUUID();
        const optimistic = createOptimisticMessage({
          tempId,
          clientMessageId,
          body: trimmed,
          senderType: "agent",
          senderLabel: genericSenderLabel("agent"),
          nextSequence: maxSequenceNumber(messages) + 1,
        });

        setMessages((current) => mergeMessages(current, [], [optimistic]));
        setBody("");
        onClearTyping();

        startTransition(async () => {
          const { sendMessageAction } = await import("@/lib/inbox/actions");
          const result = await sendMessageAction(workspaceSlug, {
            conversationId,
            body: trimmed,
            clientMessageId,
          });

          if (!result.success || !result.data || !("message" in result.data)) {
            setMessages((current) =>
              current.map((message) =>
                message.clientMessageId === clientMessageId
                  ? { ...message, status: "failed" }
                  : message,
              ),
            );
            setError(
              !result.success ? result.message : "Something went wrong.",
            );
            setBody(trimmed);
            return;
          }

          const sent = result.data;
          clientMessageIdRef.current = null;
          setMessages((current) =>
            mergeMessages(
              current.filter((message) => message.id !== tempId),
              [
                toMessageViewFromOperatorRow({
                  id: sent.message.id,
                  sequence_number: sent.message.sequence_number,
                  sender_type: "agent",
                  sender_label: genericSenderLabel("agent"),
                  body: sent.message.body,
                  created_at: sent.message.created_at,
                  client_message_id: clientMessageId,
                  is_internal: false,
                }),
              ],
              [],
            ),
          );
        });
      }}
    >
      <label className="sr-only" htmlFor="reply-body">
        Reply
      </label>
      <textarea
        id="reply-body"
        value={body}
        onChange={(event) => {
          const next = event.target.value;
          setBody(next);
          onComposerChange(next);
        }}
        rows={4}
        maxLength={4000}
        placeholder="Write a reply..."
        disabled={isPending}
        className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm"
      />
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={isPending || body.trim().length === 0}>
          {isPending ? "Sending..." : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
