"use client";

import { ConversationTranslationProvider, InlineTranslation, useConversationTranslation, translationLanguageName } from "./ConversationTranslation";
import { translateInPortal } from "@/lib/ai-translation/portal-client";
import { TRANSLATION_LANGUAGES, type TranslationLanguage } from "@site-chat/ai/client";

import {
  startInteraction,
  finishInteraction,
} from "@/lib/performance/interactions";
import type {
  CannedResponse,
  MessageItem,
  ReceiptCursors,
} from "@site-chat/shared";
import {
  cannedResponsesMessagesEn,
  createOptimisticMessage,
  deriveMessageReceiptStatus,
  genericSenderLabel,
  maxSequenceNumber,
  mergeMessages,
  mergeReceiptCursors,
  toMessageViewFromOperatorRow,
  type CannedVariableContext,
  type MessageView,
} from "@site-chat/shared";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useConversationVisitorContext } from "@/components/inbox/ConversationVisitorProvider";
import { Paperclip } from "lucide-react";

import { ConversationFollowUp } from "@/components/inbox/ConversationFollowUp";
import { Button } from "@/components/ui/button";
import {
  CannedSlashMenu,
  useCannedSlash,
} from "@/components/inbox/CannedSlashMenu";
import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { OperatorMessageAttachments } from "@/components/inbox/MessageAttachments";
import { MessageReceiptIndicator } from "@/components/inbox/MessageReceiptIndicator";
import { SuggestedReplyPanel } from "@/components/inbox/SuggestedReplyPanel";
import { recordCannedResponseUsageAction } from "@/lib/canned/actions";
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
import { useLiveCannedResponses } from "@/lib/realtime/use-canned-responses";
import { useLiveConversationThread } from "@/lib/realtime/use-operator-inbox";

const cannedMessages = cannedResponsesMessagesEn;

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
      attachments: message.attachments,
    }),
  );
}

export function LiveConversationThread({
  workspaceId,
  workspaceSlug,
  workspaceName,
  conversationId,
  ephemeralTopic,
  memberId,
  memberDisplayLabel,
  initialMessages,
  initialVisitorReceipts,
  initialCannedResponses,
  visitorName,
  visitorEmail,
  canSend,
  canUseCannedResponses,
  aiSuggestedRepliesEnabled = false,
  focusMessageId = null,
  composerAccessory = null,
}: {
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  conversationId: string;
  ephemeralTopic: string;
  memberId: string;
  memberDisplayLabel?: string | null;
  initialMessages: MessageItem[];
  initialVisitorReceipts: ReceiptCursors;
  /** Prefetched on the conversation page; empty when the role cannot use them. */
  initialCannedResponses: CannedResponse[];
  visitorName: string | null;
  visitorEmail: string | null;
  canSend: boolean;
  canUseCannedResponses: boolean;
  aiSuggestedRepliesEnabled?: boolean;
  /** From global search: scroll/focus a message when present. */
  focusMessageId?: string | null;
  /** Optional chrome rendered above the composer (e.g. Reply / Internal note). */
  composerAccessory?: ReactNode;
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
  // Keep ephemeral subscribe identity stable across router.refresh() / RSC
  // prop churn (receipts, display label). Recreating the channel on those
  // updates races presence .on() after subscribe() and jumps the UI.
  const memberDisplayLabelRef = useRef(memberDisplayLabel);
  memberDisplayLabelRef.current = memberDisplayLabel;
  const workspaceSlugRef = useRef(workspaceSlug);
  workspaceSlugRef.current = workspaceSlug;
  const initialVisitorReceiptsRef = useRef(initialVisitorReceipts);
  initialVisitorReceiptsRef.current = initialVisitorReceipts;

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

  // Prefetch covers the first keystroke; live CDC keeps the slash menu current
  // when the shared library changes while the conversation stays open.
  const cannedEnabled = canUseCannedResponses && canSend && Boolean(memberId);
  const { responses: cannedResponses } = useLiveCannedResponses({
    workspaceId,
    workspaceSlug,
    memberId,
    initialResponses: initialCannedResponses,
    enabled: cannedEnabled,
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
      displayLabel: memberDisplayLabelRef.current,
      initialVisitorReceipts: {
        lastDeliveredSequence:
          initialVisitorReceiptsRef.current.lastDeliveredSequence,
        lastReadSequence: initialVisitorReceiptsRef.current.lastReadSequence,
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
          const result = await fetchVisitorReceiptCursorsAction(
            workspaceSlugRef.current,
            {
              conversationId,
            },
          );
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
    // Intentionally omit receipt/display-label props: router.refresh() after
    // mark-read must not tear down the ephemeral channel.
  }, [conversationId, ephemeralTopic, memberId]);

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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followLatestRef = useRef(true);
  const previousLastRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || focusMessageId) return;
    const last = messages.at(-1);
    const changed = last?.id !== previousLastRef.current;
    previousLastRef.current = last?.id;
    if (followLatestRef.current || (changed && last?.isOptimistic)) {
      container.scrollTop = container.scrollHeight;
      followLatestRef.current = true;
    }
    const observer = new ResizeObserver(() => {
      if (followLatestRef.current) container.scrollTop = container.scrollHeight;
    });
    if (container.firstElementChild) observer.observe(container.firstElementChild);
    return () => { observer.disconnect(); };
  }, [messages, focusMessageId]);

  const currentStatus = useConversationVisitorContext()?.snapshot.status;

  return (
    <ConversationTranslationProvider key={`${memberId}:${conversationId}`} identity={memberId} workspaceId={workspaceId} conversationId={conversationId} messageVersion={String(maxSequenceNumber(messages))}>
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="conversation-thread"
    >
      <span
        data-testid="thread-realtime-ready"
        data-realtime-state={connectionState}
        hidden
      />
      <div className="flex shrink-0 items-center gap-3 bg-inbox-surface px-6 py-1.5">
        <p
          className="text-inbox-muted text-[12.5px]"
          data-testid="visitor-presence"
          data-presence={visitorOnline ? "online" : "offline"}
        >
          <span
            className={
              visitorOnline
                ? "mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500"
                : "mr-1.5 inline-block size-1.5 rounded-full bg-neutral-300"
            }
            aria-hidden="true"
          />
          {visitorOnline ? "Online" : "Offline"}
        </p>
      </div>
      <ConversationFollowUp
        key={conversationId}
        slug={workspaceSlug}
        conversationId={conversationId}
        ratingOnly
        pollRating={currentStatus === "closed" || currentStatus === "resolved"}
      />
      <ConnectionBanner
        state={connectionState}
        onRetry={() => {
          void catchUp();
        }}
      />
      <div ref={scrollRef} onScroll={() => {
        const node = scrollRef.current;
        if (node) followLatestRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
      }} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        <MessageList
          conversationId={conversationId}
          workspaceId={workspaceId}
          messages={messages}
          visitorReceipts={visitorReceipts}
          bottomRef={observeBottom}
          focusMessageId={focusMessageId}
        />
        {currentStatus === "closed" || currentStatus === "resolved" ? (
          <p
            role="status"
            className="py-4 text-center text-xs text-inbox-muted"
          >
            Chat Closed
          </p>
        ) : null}
        {newMessagesBelow > 0 ? (
          <div className="flex justify-center py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                followLatestRef.current = true;
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }}
            >
              New messages
            </Button>
          </div>
        ) : null}
        <div
          className="text-inbox-muted min-h-6 pt-2 text-[13px]"
          data-testid="visitor-typing"
          aria-live="polite"
          aria-atomic="true"
        >
          {visitorTyping ? (
            <span className="inline-flex items-center gap-2">
              <span className="flex gap-1" aria-hidden="true">
                <span className="bg-brand/50 size-1.5 animate-pulse rounded-full" />
                <span className="bg-brand/50 size-1.5 animate-pulse rounded-full [animation-delay:120ms]" />
                <span className="bg-brand/50 size-1.5 animate-pulse rounded-full [animation-delay:240ms]" />
              </span>
              Visitor is typing…
            </span>
          ) : null}
        </div>
      </div>
      {composerAccessory}
      <LiveReplyComposer
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        canSend={canSend}
        aiSuggestedRepliesEnabled={aiSuggestedRepliesEnabled}
        cannedResponses={cannedEnabled ? cannedResponses : []}
        cannedEnabled={cannedEnabled}
        cannedContext={{
          visitorName,
          visitorEmail,
          operatorName: memberDisplayLabel ?? null,
          workspaceName,
          conversationId,
        }}
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
    </ConversationTranslationProvider>
  );
}

function messageDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function initialsFromSender(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

function MessageList({
  conversationId,
  workspaceId,
  messages,
  visitorReceipts,
  bottomRef,
  focusMessageId,
}: {
  conversationId: string;
  workspaceId: string;
  messages: MessageView[];
  visitorReceipts: ReceiptCursors;
  bottomRef: (node: HTMLDivElement | null) => void;
  focusMessageId?: string | null;
}) {
  useEffect(() => {
    if (!focusMessageId) {
      return;
    }
    const node = document.querySelector(
      `[data-message-id="${CSS.escape(focusMessageId)}"]`,
    );
    if (node instanceof HTMLElement) {
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.focus({ preventScroll: true });
    }
  }, [focusMessageId, messages]);

  const translation = useConversationTranslation();

  if (messages.length === 0) {
    return (
      <p className="text-inbox-muted py-12 text-center text-[14px]">
        No messages in this conversation yet.
      </p>
    );
  }

  let lastDay = "";

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-3.5">
      {messages.map((message) => {
        const receiptStatus =
          message.senderType === "agent" && !message.isOptimistic
            ? deriveMessageReceiptStatus({
                sequenceNumber: message.sequenceNumber,
                peer: visitorReceipts,
              })
            : null;
        const replyOriginal = message.clientMessageId && translation?.prefs.enabled ? translation.originals[message.clientMessageId] : undefined;
        const focused = focusMessageId === message.id;
        const isVisitor = message.senderType === "visitor";
        const day = messageDayKey(message.createdAt);
        const showDay = day !== lastDay;
        lastDay = day;

        return (
          <div key={message.id}>
            {showDay ? (
              <div className="flex items-center gap-3 py-2.5">
                <div className="bg-inbox-border/80 h-px flex-1" />
                <span className="text-inbox-muted text-[12px] font-medium tracking-wide">
                  {day}
                </span>
                <div className="bg-inbox-border/80 h-px flex-1" />
              </div>
            ) : null}
            <article
              className={
                isVisitor
                  ? "mr-auto flex w-full max-w-[min(100%,36rem)] gap-2.5"
                  : "ml-auto flex w-full max-w-[min(100%,36rem)] flex-row-reverse gap-2.5"
              }
              data-sequence={message.sequenceNumber}
              data-message-id={message.id}
              tabIndex={focused ? -1 : undefined}
            >
              {!isVisitor ? (
                <div
                  className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-neutral-200/80 text-[10px] font-semibold text-neutral-600"
                  aria-hidden="true"
                >
                  {initialsFromSender(message.senderLabel)}
                </div>
              ) : (
                <div
                  className="bg-brand/12 text-brand mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                  aria-hidden="true"
                >
                  {initialsFromSender(message.senderLabel)}
                </div>
              )}
              <div
                className={
                  isVisitor
                    ? `min-w-0 flex-1 rounded-xl rounded-bl-md border border-inbox-border bg-inbox-bubble-visitor px-3.5 py-2.5${focused ? " ring-2 ring-brand/30" : ""}`
                    : `mill-agent-bubble min-w-0 flex-1 rounded-xl rounded-br-md bg-inbox-bubble-agent px-3.5 py-2.5${focused ? " ring-2 ring-brand/30" : ""}`
                }
              >
                <header className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[12.5px] font-medium text-neutral-600">
                    {message.senderLabel}
                  </span>
                  <time className="text-inbox-muted text-[11.5px] tabular-nums">
                    {formatRelativeTime(message.createdAt)}
                  </time>
                </header>
                {message.body ? (
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-neutral-900">
                    {replyOriginal?.original ?? message.body}
                  </p>
                ) : null}
                {replyOriginal && <div className="mt-2 border-t border-neutral-200 pt-2 text-xs text-neutral-500"><p className="mb-1 text-[10px]">{translationLanguageName(replyOriginal.sourceLanguage)} → {translationLanguageName(replyOriginal.targetLanguage)}</p><p dir="auto" className="whitespace-pre-wrap leading-relaxed">{replyOriginal.translated}</p></div>}
                {isVisitor && message.body && !message.isInternal && !message.isOptimistic && messages.indexOf(message) >= messages.length - 20 ? (
                  <InlineTranslation workspaceId={workspaceId} conversationId={conversationId} messageId={message.id} original={message.body} latest={message.id === [...messages].reverse().find(item => item.senderType === "visitor" && !item.isInternal)?.id} />
                ) : null}
                {message.attachments && message.attachments.length > 0 ? (
                  <OperatorMessageAttachments
                    workspaceId={workspaceId}
                    attachments={message.attachments}
                  />
                ) : null}
                {message.status === "pending" ? (
                  <p className="text-inbox-muted mt-2 text-[12px]">
                    Sending...
                  </p>
                ) : null}
                {message.status === "failed" ? (
                  <p className="text-destructive mt-2 text-[12px]">
                    Failed to send
                  </p>
                ) : null}
                {receiptStatus ? (
                  <MessageReceiptIndicator status={receiptStatus} />
                ) : null}
              </div>
            </article>
          </div>
        );
      })}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}

function LiveReplyComposer({
  workspaceId,
  workspaceSlug,
  conversationId,
  canSend,
  aiSuggestedRepliesEnabled,
  cannedResponses,
  cannedEnabled,
  cannedContext,
  messages,
  setMessages,
  onComposerChange,
  onClearTyping,
  onVisitorMessageDisplayed,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  canSend: boolean;
  aiSuggestedRepliesEnabled: boolean;
  cannedResponses: CannedResponse[];
  cannedEnabled: boolean;
  cannedContext: CannedVariableContext;
  messages: MessageView[];
  setMessages: (updater: (current: MessageView[]) => MessageView[]) => void;
  onComposerChange: (text: string) => void;
  onClearTyping: () => void;
  onVisitorMessageDisplayed: (sequence: number) => void;
}) {
  const translation = useConversationTranslation();
  const translationRequestRef = useRef<{ binding: string; id: string } | null>(null);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const clientMessageIdRef = useRef<string | null>(null);
  const lastMarkedVisitorSequenceRef = useRef(0);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const canned = useCannedSlash({
    items: cannedResponses,
    enabled: cannedEnabled,
    body,
    textareaRef: bodyRef,
    context: cannedContext,
    onInsert: (next, used) => {
      setBody(next.body);
      onComposerChange(next.body);
      // Usage telemetry must never block or fail an insertion.
      void recordCannedResponseUsageAction(workspaceSlug, {
        cannedResponseId: used.id,
      });
    },
  });

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
  const closeCannedRef = useRef(canned.close);
  closeCannedRef.current = canned.close;

  useEffect(() => {
    // Conversation switch: clear composer typing state.
    setBody("");
    onClearTypingRef.current();
    closeCannedRef.current();
  }, [conversationId]);

  if (!canSend) {
    return (
      <p className="text-inbox-muted border-inbox-border border-t bg-inbox-panel px-6 py-4 text-[14px]">
        You have read-only access to this conversation.
      </p>
    );
  }

  const suggestedRepliesEnabled = aiSuggestedRepliesEnabled;
  let latestVisitorMessageId: string | null = null;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.senderType === "visitor" && !message.isOptimistic) {
      latestVisitorMessageId = message.id;
      break;
    }
  }

  return (
    <form
      className="bg-inbox-panel shrink-0 px-3 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] md:px-5"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
          setPendingFiles((current) => [...current, ...files].slice(0, 10));
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const trimmed = body.trim();
        if ((!trimmed && pendingFiles.length === 0) || isPending) {
          return;
        }

        if (!clientMessageIdRef.current) {
          clientMessageIdRef.current = crypto.randomUUID();
        }

        const timing = startInteraction(
          pendingFiles.length ? "Send attachment" : "Send message",
        );
        const clientMessageId = clientMessageIdRef.current;
        const tempId = crypto.randomUUID();
        const filesForSend = pendingFiles;
        const optimistic = createOptimisticMessage({
          tempId,
          clientMessageId,
          body: trimmed,
          senderType: "agent",
          senderLabel: genericSenderLabel("agent"),
          nextSequence: maxSequenceNumber(messages) + 1,
          attachments: filesForSend.map((file, index) => ({
            id: `op-pending-${String(index)}`,
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            kind: file.type.startsWith("image/") ? "image" : "document",
            sortOrder: index,
            hasThumbnail: file.type.startsWith("image/"),
          })),
        });

        setMessages((current) => mergeMessages(current, [], [optimistic]));
        setBody("");
        setPendingFiles([]);
        setUploadFailed(false);
        onClearTyping();

        startTransition(async () => {
          let batchIdForCleanup: string | null = null;
          try {
            let deliveredBody = trimmed;
            if (translation?.prefs.enabled && translation.prefs.replies && trimmed) {
              const target = translation.prefs.replyLanguage === "auto" ? translation.customerLanguage : translation.prefs.replyLanguage;
              if (!target || !Object.hasOwn(TRANSLATION_LANGUAGES, target))
                throw new Error("Choose a reply language while the customer's language is being detected.");
              const binding = JSON.stringify([conversationId, trimmed, target]);
              if (translationRequestRef.current?.binding !== binding)
                translationRequestRef.current = { binding, id: crypto.randomUUID() };
              const translated = await translateInPortal({ workspaceId, operation: "previewReplyTranslation", input: {
                conversationId, text: trimmed, targetLanguage: target as TranslationLanguage, consent: true, requestId: clientMessageId,
              } });
              if (!translated.ok) throw new Error(translated.error);
              const translatedText = translated.result.translatedText;
              translation.rememberOriginal(clientMessageId, { original: trimmed, translated: translatedText, sourceLanguage: translated.result.sourceLanguage ?? "und", targetLanguage: target });
              deliveredBody = translation.prefs.shareOriginal && trimmed !== translatedText ? `${trimmed}\n\n${translatedText}` : translatedText;
            }
            if (filesForSend.length > 0) {
              const {
                initiateOperatorUploadsAction,
                completeOperatorUploadsAction,
              } = await import("@/lib/inbox/actions");

              setUploadProgress(`Uploading 0/${String(filesForSend.length)}…`);
              const initiated = await initiateOperatorUploadsAction(
                workspaceSlug,
                {
                  conversationId,
                  body: deliveredBody,
                  clientMessageId,
                  files: filesForSend.map((file, index) => ({
                    localId: `op-${String(index)}-${file.name}`,
                    filename: file.name,
                    mimeType: file.type || "application/octet-stream",
                    sizeBytes: file.size,
                  })),
                },
              );

              if (!initiated.success || !("uploads" in initiated.data)) {
                throw new Error(
                  !initiated.success ? initiated.message : "Upload failed",
                );
              }

              batchIdForCleanup = initiated.data.batchId;
              setActiveBatchId(initiated.data.batchId);
              const abort = new AbortController();
              uploadAbortRef.current = abort;

              let uploadedCount = 0;
              for (const upload of initiated.data.uploads) {
                if (abort.signal.aborted) {
                  throw new Error("Upload cancelled");
                }
                const fileIndex = filesForSend.findIndex(
                  (candidate, index) =>
                    `op-${String(index)}-${candidate.name}` === upload.localId,
                );
                const file =
                  fileIndex >= 0 ? filesForSend[fileIndex] : undefined;
                if (!file) continue;
                // Token is already on the signed URL (?token=). Do not send it
                // as Authorization Bearer — that is interpreted as a user JWT.
                let uploadUrl = upload.uploadUrl;
                if (upload.uploadToken) {
                  try {
                    const parsed = new URL(upload.uploadUrl);
                    if (!parsed.searchParams.get("token")) {
                      parsed.searchParams.set("token", upload.uploadToken);
                    }
                    uploadUrl = parsed.toString();
                  } catch {
                    uploadUrl = upload.uploadUrl;
                  }
                }
                // Match supabase-js uploadToSignedUrl multipart shape.
                const body = new FormData();
                body.append("cacheControl", "3600");
                body.append("", file, file.name);
                const response = await fetch(uploadUrl, {
                  method: "PUT",
                  body,
                  signal: abort.signal,
                });
                if (!response.ok) {
                  throw new Error(`Upload failed (${String(response.status)})`);
                }
                uploadedCount += 1;
                setUploadProgress(
                  `Uploading ${String(uploadedCount)}/${String(filesForSend.length)}…`,
                );
              }

              setUploadProgress("Confirming…");
              const completed = await completeOperatorUploadsAction(
                workspaceSlug,
                {
                  conversationId,
                  batchId: initiated.data.batchId,
                  uploadIds: initiated.data.uploads.map(
                    (item) => item.uploadId,
                  ),
                  body: deliveredBody,
                  clientMessageId,
                },
              );

              if (!completed.success || !("message" in completed.data)) {
                throw new Error(
                  !completed.success
                    ? completed.message
                    : "Something went wrong.",
                );
              }

              finishInteraction(timing, true);
              const sent = completed.data;
              clientMessageIdRef.current = null;
              setUploadProgress(null);
              setActiveBatchId(null);
              setUploadFailed(false);
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
                      attachments: sent.message.attachments,
                    }),
                  ],
                  [],
                ),
              );
              return;
            }

            const { sendMessageAction } = await import("@/lib/inbox/actions");
            const result = await sendMessageAction(workspaceSlug, {
              conversationId,
              body: deliveredBody,
              clientMessageId,
            });

            if (
              !result.success ||
              !result.data ||
              !("message" in result.data)
            ) {
              setMessages((current) =>
                current.map((message) =>
                  message.clientMessageId === clientMessageId
                    ? { ...message, status: "failed" }
                    : message,
                ),
              );
              finishInteraction(timing, false);
              setError(
                !result.success ? result.message : "Something went wrong.",
              );
              setBody(trimmed);
              setPendingFiles(filesForSend);
              return;
            }

            finishInteraction(timing, true);
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
                    attachments: sent.message.attachments,
                  }),
                ],
                [],
              ),
            );
          } catch (uploadError) {
            finishInteraction(timing, false);
            setUploadProgress(null);
            setActiveBatchId(null);
            if (filesForSend.length > 0) {
              setUploadFailed(true);
              if (batchIdForCleanup) {
                const { cancelOperatorUploadsAction } =
                  await import("@/lib/inbox/actions");
                void cancelOperatorUploadsAction(workspaceSlug, {
                  batchId: batchIdForCleanup,
                });
              }
            }
            setMessages((current) =>
              current.map((message) =>
                message.clientMessageId === clientMessageId
                  ? { ...message, status: "failed" }
                  : message,
              ),
            );
            setError(
              uploadError instanceof Error
                ? uploadError.message
                : "Something went wrong.",
            );
            setBody(trimmed);
            setPendingFiles(filesForSend);
          } finally {
            uploadAbortRef.current = null;
          }
        });
      }}
    >
      <SuggestedReplyPanel
        workspaceId={workspaceId}
        conversationId={conversationId}
        composerText={body}
        enabled={suggestedRepliesEnabled}
        latestVisitorMessageId={latestVisitorMessageId}
        onInsertIntoComposer={(text) => {
          setBody(text);
          onComposerChange(text);
        }}
      />
      <label className="sr-only" htmlFor="reply-body">
        Reply
      </label>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        data-testid="operator-file-input"
        accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
        onChange={(event) => {
          // Capture before resetting the input: React may run the updater
          // later, after the browser has cleared its FileList.
          const selected = Array.from(event.currentTarget.files ?? []);
          if (selected.length > 0) {
            setPendingFiles((current) =>
              [...current, ...selected].slice(0, 10),
            );
            event.currentTarget.value = "";
          }
        }}
      />
      {pendingFiles.length > 0 ? (
        <ul
          className="mb-2 space-y-1 text-xs"
          data-testid="operator-pending-attachments"
        >
          {pendingFiles.map((file) => (
            <li
              key={`${file.name}-${String(file.size)}`}
              className="flex items-center gap-2"
            >
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                className="text-inbox-muted underline"
                onClick={() => {
                  setPendingFiles((current) =>
                    current.filter((item) => item !== file),
                  );
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {uploadProgress ? (
        <p
          className="text-inbox-muted mb-2 text-xs"
          role="status"
          aria-live="polite"
          data-testid="operator-upload-status"
        >
          {uploadProgress}
        </p>
      ) : null}

      <div className="mill-message-composer border-inbox-border/90 bg-inbox-surface focus-within:ring-brand/20 rounded-lg border focus-within:ring-1">
        <div className="relative">
          {canned.query !== null ? (
            <CannedSlashMenu
              options={canned.options}
              activeIndex={canned.activeIndex}
              onSelect={canned.select}
            />
          ) : null}
          <textarea
            id="reply-body"
            ref={bodyRef}
            value={body}
            onChange={(event) => {
              const next = event.target.value;
              setBody(next);
              onComposerChange(next);
              canned.sync(next, event.target.selectionStart);
            }}
            onKeyDown={(event) => {
              canned.onKeyDown(event);
            }}
            onBlur={() => {
              canned.close();
            }}
            onClick={(event) => {
              canned.sync(body, event.currentTarget.selectionStart);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData.items)
                .filter((item) => item.kind === "file")
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length > 0) {
                event.preventDefault();
                setPendingFiles((current) =>
                  [...current, ...files].slice(0, 10),
                );
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Write a reply..."
            disabled={isPending}
            className="w-full resize-none bg-transparent px-3.5 py-2.5 text-base leading-relaxed md:text-[14px] outline-none placeholder:text-neutral-400"
          />
        </div>
        <div className="border-inbox-border/80 flex items-center justify-between gap-2 border-t px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isPending}
              aria-label="Attach files"
              data-testid="operator-attach-button"
              className="text-inbox-muted hover:text-neutral-800 h-8 gap-1.5 px-2"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="size-3.5" aria-hidden="true" />
              Attach
            </Button>
            {cannedEnabled ? (
              <span
                className="text-inbox-muted hidden truncate text-[11.5px] sm:inline"
                data-testid="canned-slash-hint"
              >
                {cannedMessages.slashHint}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {activeBatchId && isPending ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                aria-label="Cancel upload"
                data-testid="operator-upload-cancel"
                onClick={() => {
                  uploadAbortRef.current?.abort();
                  const batchId = activeBatchId;
                  setActiveBatchId(null);
                  setUploadProgress(null);
                  void import("@/lib/inbox/actions").then(
                    ({ cancelOperatorUploadsAction }) => {
                      void cancelOperatorUploadsAction(workspaceSlug, {
                        batchId,
                      });
                    },
                  );
                }}
              >
                Cancel
              </Button>
            ) : null}
            {uploadFailed && !isPending ? (
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="h-8"
                aria-label="Retry upload"
                data-testid="operator-upload-retry"
              >
                Retry upload
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90 h-8 px-3.5 text-[13px]"
                disabled={
                  isPending ||
                  (body.trim().length === 0 && pendingFiles.length === 0)
                }
              >
                {isPending ? "Sending..." : "Send reply"}
              </Button>
            )}
          </div>
        </div>
      </div>
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
    </form>
  );
}
