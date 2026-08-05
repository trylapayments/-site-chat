"use client";

import type { MessageItem } from "@site-chat/shared";
import {
  createOptimisticMessage,
  genericSenderLabel,
  maxSequenceNumber,
  mergeMessages,
  toMessageViewFromOperatorRow,
  type MessageView,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { markConversationReadAction } from "@/lib/inbox/actions";
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
  initialMessages,
  canSend,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  initialMessages: MessageItem[];
  canSend: boolean;
}) {
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
    initialMessages: mapInitialMessages(initialMessages),
  });

  return (
    <div className="space-y-4">
      <span
        data-testid="thread-realtime-ready"
        data-realtime-state={connectionState}
        hidden
      />
      <ConnectionBanner
        state={connectionState}
        onRetry={() => {
          void catchUp();
        }}
      />
      <MessageList messages={messages} bottomRef={observeBottom} />
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
      <LiveReplyComposer
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        canSend={canSend}
        messages={messages}
        setMessages={setMessages}
        onVisitorMessageDisplayed={(sequence) => {
          void markConversationReadAction(workspaceSlug, {
            conversationId,
            throughSequence: sequence,
          });
        }}
      />
    </div>
  );
}

function MessageList({
  messages,
  bottomRef,
}: {
  messages: MessageView[];
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
      {messages.map((message) => (
        <article
          key={message.id}
          className={
            message.senderType === "agent"
              ? "bg-primary/5 ml-8 rounded-lg border px-4 py-3"
              : "bg-muted/40 mr-8 rounded-lg border px-4 py-3"
          }
        >
          <header className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{message.senderLabel}</span>
            <time className="text-muted-foreground text-xs">
              {new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(message.createdAt))}
            </time>
          </header>
          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
          {message.status === "pending" ? (
            <p className="text-muted-foreground mt-2 text-xs">Sending...</p>
          ) : null}
          {message.status === "failed" ? (
            <p className="text-destructive mt-2 text-xs">Failed to send</p>
          ) : null}
        </article>
      ))}
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
  onVisitorMessageDisplayed,
}: {
  workspaceSlug: string;
  conversationId: string;
  canSend: boolean;
  messages: MessageView[];
  setMessages: (updater: (current: MessageView[]) => MessageView[]) => void;
  onVisitorMessageDisplayed: (sequence: number) => void;
}) {
  const router = useRouter();
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

        startTransition(async () => {
          const { sendMessageAction } = await import("@/lib/inbox/actions");
          const result = await sendMessageAction(workspaceSlug, {
            conversationId,
            body: trimmed,
            clientMessageId,
          });

          if (!result.success || !result.data) {
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
          router.refresh();
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
          setBody(event.target.value);
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
