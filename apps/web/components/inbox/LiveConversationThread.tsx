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
import { OperatorMessageAttachments } from "@/components/inbox/MessageAttachments";
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
      attachments: message.attachments,
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
        workspaceId={workspaceId}
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
  workspaceId,
  messages,
  visitorReceipts,
  bottomRef,
}: {
  workspaceId: string;
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
            {message.body ? (
              <p className="text-sm whitespace-pre-wrap">{message.body}</p>
            ) : null}
            {message.attachments && message.attachments.length > 0 ? (
              <OperatorMessageAttachments
                workspaceId={workspaceId}
                attachments={message.attachments}
              />
            ) : null}
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
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
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          setPendingFiles((current) =>
            [...current, ...Array.from(event.dataTransfer.files)].slice(0, 10),
          );
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
                  body: trimmed,
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
                const response = await fetch(uploadUrl, {
                  method: "PUT",
                  headers: {
                    "Content-Type": upload.mimeType,
                  },
                  body: file,
                  signal: abort.signal,
                });
                if (!response.ok) {
                  throw new Error("Upload failed");
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
                  body: trimmed,
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
              body: trimmed,
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
              setError(
                !result.success ? result.message : "Something went wrong.",
              );
              setBody(trimmed);
              setPendingFiles(filesForSend);
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
                    attachments: sent.message.attachments,
                  }),
                ],
                [],
              ),
            );
          } catch (uploadError) {
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
          const selected = event.target.files;
          if (selected) {
            setPendingFiles((current) =>
              [...current, ...Array.from(selected)].slice(0, 10),
            );
            event.target.value = "";
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
                className="text-muted-foreground underline"
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
          className="text-muted-foreground mb-2 text-xs"
          role="status"
          aria-live="polite"
          data-testid="operator-upload-status"
        >
          {uploadProgress}
        </p>
      ) : null}
      <textarea
        id="reply-body"
        value={body}
        onChange={(event) => {
          const next = event.target.value;
          setBody(next);
          onComposerChange(next);
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.items)
            .filter((item) => item.kind === "file")
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          if (files.length > 0) {
            event.preventDefault();
            setPendingFiles((current) => [...current, ...files].slice(0, 10));
          }
        }}
        rows={4}
        maxLength={4000}
        placeholder="Write a reply..."
        disabled={isPending}
        className="border-input bg-background w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm"
      />
      {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          aria-label="Attach files"
          data-testid="operator-attach-button"
          onClick={() => fileInputRef.current?.click()}
        >
          Attach
        </Button>
        <div className="flex items-center gap-2">
          {activeBatchId && isPending ? (
            <Button
              type="button"
              variant="outline"
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
              aria-label="Retry upload"
              data-testid="operator-upload-retry"
            >
              Retry upload
            </Button>
          ) : (
            <Button
              type="submit"
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
    </form>
  );
}
