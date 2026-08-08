"use client";

import type { MessageItem } from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { markConversationReadAction } from "@/lib/inbox/actions";

export function MarkConversationRead({
  workspaceSlug,
  conversationId,
  throughSequence,
}: {
  workspaceSlug: string;
  conversationId: string;
  throughSequence?: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const markedRef = useRef(false);

  useEffect(() => {
    if (markedRef.current) {
      return;
    }
    markedRef.current = true;

    startTransition(async () => {
      const result = await markConversationReadAction(workspaceSlug, {
        conversationId,
        throughSequence,
      });

      // Only refresh when a write occurred so reopening a read conversation
      // stays write-free and avoids unnecessary RSC churn.
      if (
        result.success &&
        result.data &&
        "updated" in result.data &&
        result.data.updated
      ) {
        router.refresh();
      }
    });
  }, [conversationId, router, throughSequence, workspaceSlug]);

  return null;
}

export function MessageList({ messages }: { messages: MessageItem[] }) {
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
            message.sender_type === "agent"
              ? "bg-primary/5 ml-8 rounded-lg border px-4 py-3"
              : "bg-muted/40 mr-8 rounded-lg border px-4 py-3"
          }
        >
          <header className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{message.sender_label}</span>
            <time className="text-muted-foreground text-xs">
              {new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(message.created_at))}
            </time>
          </header>
          <p className="text-sm whitespace-pre-wrap">{message.body}</p>
        </article>
      ))}
    </div>
  );
}

export function ReplyComposer({
  workspaceSlug,
  conversationId,
  canSend,
}: {
  workspaceSlug: string;
  conversationId: string;
  canSend: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const clientMessageIdRef = useRef<string | null>(null);

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

        startTransition(async () => {
          const { sendMessageAction } = await import("@/lib/inbox/actions");
          const result = await sendMessageAction(workspaceSlug, {
            conversationId,
            body: trimmed,
            clientMessageId,
          });

          if (!result.success) {
            setError(result.message);
            return;
          }

          clientMessageIdRef.current = null;
          setBody("");
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
