import {
  createOptimisticMessage,
  deriveMessageReceiptStatus,
  maxSequenceNumber,
  mergeMessages,
  reduceUploadBatch,
  uploadBatchAriaStatus,
  createEmptyUploadBatch,
  type ConnectionState,
  type MessageReceiptStatus,
  type MessageView,
  type ReceiptCursors,
  type UploadBatchState,
  type WidgetLocale,
} from "@site-chat/shared";
import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";

import { WidgetApiClient, type BootstrapPayload, type WidgetPublicConfig } from "../api/client";
import { MessageAttachments } from "../attachments/AttachmentViews";
import {
  acceptAttributeForAttachments,
  fileToSelectedLocalFile,
  revokePreviewUrls,
  uploadBlobWithProgress,
  type SelectedLocalFile,
} from "../attachments/upload-file";
import {
  englishMessages,
  formatMessageTime,
  formatWidgetMessage,
  getWidgetDirection,
  loadWidgetDictionary,
  resolveWidgetLocale,
  type WidgetMessages,
} from "../i18n";
import { isMessageFromParent } from "../post-message";
import { readParentOriginFromLocation } from "../parent-origin";
import { maxAgentMessageSequence, shouldMarkMessagesRead } from "../realtime/receipt-visibility";
import {
  mapWidgetHttpMessages,
  WidgetRealtimeTransport,
  type WidgetTypingIndicator,
} from "../realtime/visitor-transport";
import {
  clearSessionToken,
  generateClientMessageId,
  readSessionToken,
  writeSessionToken,
} from "../session/storage";
import { isNearBottom, scrollContainerToBottom, shouldAutoScroll } from "./scroll";

const EMPTY_RECEIPTS: ReceiptCursors = {
  lastDeliveredSequence: 0,
  lastReadSequence: 0,
};

const MESSAGE_SOURCE = "sitechat-embed";

type InitPayload = BootstrapPayload & {
  parentOrigin: string;
};

type WidgetState =
  | { status: "booting" }
  | { status: "ready"; init: InitPayload; sessionToken: string; locale: WidgetLocale }
  | { status: "error"; message: string };

function postToParent(parentOrigin: string, type: string, payload?: Record<string, unknown>) {
  window.parent.postMessage(
    {
      source: MESSAGE_SOURCE,
      type,
      payload,
    },
    parentOrigin,
  );
}

function resolveParentOrigin(init: InitPayload | null): string | null {
  if (init?.parentOrigin) {
    return init.parentOrigin;
  }

  return readParentOriginFromLocation(window.location);
}

function applyDocumentLocale(locale: WidgetLocale, direction: "ltr" | "rtl") {
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
}

function positionInsets(position: "bottom-right" | "bottom-left"): {
  left?: string;
  right?: string;
} {
  // Physical left/right so launcher/panel position is NOT mirrored in RTL.
  if (position === "bottom-left") {
    return { left: "1rem", right: "auto" };
  }
  return { right: "1rem", left: "auto" };
}

function WidgetApp() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WidgetState>({ status: "booting" });
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [failedClientMessageId, setFailedClientMessageId] = useState<string | null>(null);
  const [messagesCopy, setMessagesCopy] = useState<WidgetMessages>(englishMessages);
  const [agentTyping, setAgentTyping] = useState<WidgetTypingIndicator>({
    active: false,
    displayName: null,
  });
  const [operatorsOnline, setOperatorsOnline] = useState(false);
  const [agentReceipts, setAgentReceipts] = useState<ReceiptCursors>(EMPTY_RECEIPTS);
  const [pendingFiles, setPendingFiles] = useState<SelectedLocalFile[]>([]);
  const [uploadBatch, setUploadBatch] = useState<UploadBatchState>(createEmptyUploadBatch());
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const initRef = useRef<InitPayload | null>(null);
  const parentOriginRef = useRef<string | null>(null);
  const transportRef = useRef<WidgetRealtimeTransport | null>(null);
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const messagesRef = useRef<MessageView[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const forceScrollRef = useRef(false);
  const nearBottomRef = useRef(true);
  const sessionLocaleRef = useRef<WidgetLocale>("en");
  const visitorReceiptsRef = useRef<ReceiptCursors>(EMPTY_RECEIPTS);
  const agentReceiptsRef = useRef<ReceiptCursors>(EMPTY_RECEIPTS);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    agentReceiptsRef.current = agentReceipts;
  }, [agentReceipts]);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || !open) {
      return;
    }

    const force = forceScrollRef.current;
    forceScrollRef.current = false;

    if (
      !shouldAutoScroll({
        force,
        nearBottom: nearBottomRef.current,
      })
    ) {
      return;
    }

    scrollContainerToBottom(container);
    // After paint, snap again in case bubble height settled late.
    requestAnimationFrame(() => {
      const latest = messagesContainerRef.current;
      if (latest) {
        scrollContainerToBottom(latest);
        nearBottomRef.current = true;
      }
    });
  }, [messages, open, agentTyping.active]);

  const api = useMemo(() => new WidgetApiClient(window.location.origin), []);

  const locale = state.status === "ready" ? state.locale : sessionLocaleRef.current;
  const direction = getWidgetDirection(locale);

  useEffect(() => {
    applyDocumentLocale(locale, direction);
  }, [locale, direction]);

  const config: WidgetPublicConfig | null =
    state.status === "ready" ? state.init.config : (initRef.current?.config ?? null);

  const readySessionToken = state.status === "ready" ? state.sessionToken : null;
  const readyEmbedToken = state.status === "ready" ? state.init.embedToken : null;

  const initialize = useCallback(
    async (init: InitPayload) => {
      initRef.current = init;
      parentOriginRef.current = init.parentOrigin;

      const resolvedLocale = resolveWidgetLocale({
        configLocale: init.config.locale,
        browserLanguages: typeof navigator !== "undefined" ? navigator.languages : undefined,
        browserLocale: typeof navigator !== "undefined" ? navigator.language : undefined,
      });

      sessionLocaleRef.current = resolvedLocale;
      const dictionary = await loadWidgetDictionary(resolvedLocale);
      setMessagesCopy(dictionary);
      applyDocumentLocale(resolvedLocale, getWidgetDirection(resolvedLocale));

      try {
        const existingToken = readSessionToken(init.widgetPublicKey);

        const session = await api.createSession({
          embedToken: init.embedToken,
          sessionToken: existingToken,
          locale: resolvedLocale,
          pageUrl: init.parentOrigin,
          referrer: document.referrer || undefined,
        });

        writeSessionToken(init.widgetPublicKey, session.sessionToken);

        // Prefer session-returned locale when supported; keep session-stable otherwise.
        const sessionLocale = resolveWidgetLocale({ configLocale: session.locale });
        sessionLocaleRef.current = sessionLocale;
        if (sessionLocale !== resolvedLocale) {
          const sessionDictionary = await loadWidgetDictionary(sessionLocale);
          setMessagesCopy(sessionDictionary);
          applyDocumentLocale(sessionLocale, getWidgetDirection(sessionLocale));
        }

        setState({
          status: "ready",
          init,
          sessionToken: session.sessionToken,
          locale: sessionLocale,
        });

        if (session.hasConversation) {
          const listed = await api.listMessages({
            embedToken: init.embedToken,
            sessionToken: session.sessionToken,
          });
          const initialMessages = mapWidgetHttpMessages(listed.items);
          const nextAgentReceipts = {
            lastDeliveredSequence: listed.agent_last_delivered_sequence,
            lastReadSequence: listed.agent_last_read_sequence,
          };
          visitorReceiptsRef.current = {
            lastDeliveredSequence: listed.visitor_last_delivered_sequence,
            lastReadSequence: listed.visitor_last_read_sequence,
          };
          agentReceiptsRef.current = nextAgentReceipts;
          setAgentReceipts(nextAgentReceipts);
          forceScrollRef.current = true;
          nearBottomRef.current = true;
          setMessages(initialMessages);
        }
      } catch {
        clearSessionToken(init.widgetPublicKey);
        setState({ status: "error", message: dictionary.loadError });
      }
    },
    [api],
  );

  useEffect(() => {
    const parentOrigin = resolveParentOrigin(initRef.current);
    if (!parentOrigin) {
      return;
    }

    parentOriginRef.current = parentOrigin;
    postToParent(parentOrigin, "sitechat:ready");

    function onMessage(event: MessageEvent) {
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: InitPayload;
      };

      if (data.source !== "sitechat-loader" || data.type !== "sitechat:init" || !data.payload) {
        return;
      }

      if (!isMessageFromParent(event, data.payload.parentOrigin)) {
        return;
      }

      void initialize(data.payload);
    }

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [initialize]);

  useEffect(() => {
    const parentOrigin = resolveParentOrigin(
      state.status === "ready" ? state.init : initRef.current,
    );
    if (!parentOrigin) {
      return;
    }

    postToParent(parentOrigin, "sitechat:visibility", { open });
  }, [open, state]);

  useEffect(() => {
    const init = initRef.current;
    if (!readySessionToken || !readyEmbedToken || !open || !init) {
      transportRef.current?.stop();
      transportRef.current = null;
      setAgentTyping({ active: false, displayName: null });
      setOperatorsOnline(false);
      return;
    }

    const sessionToken = readySessionToken;
    const snapshot = transportRef.current?.getMessages() ?? messagesRef.current;

    void (async () => {
      transportRef.current?.stop();

      const transport = new WidgetRealtimeTransport(api, {
        onMessages: (next) => {
          setMessages(next);
        },
        onConnectionState: setConnectionState,
        onAgentTyping: (indicator) => {
          setAgentTyping(indicator);
        },
        onPresence: (presence) => {
          setOperatorsOnline(presence.operatorsOnline);
        },
        onAgentReceipts: (cursors) => {
          agentReceiptsRef.current = cursors;
          setAgentReceipts(cursors);
        },
      });
      transportRef.current = transport;
      await transport.start({
        embedToken: init.embedToken,
        sessionToken,
        initialMessages: snapshot,
        initialAgentReceipts: agentReceiptsRef.current,
        initialVisitorReceipts: visitorReceiptsRef.current,
      });

      // StrictMode/effect cleanup may have replaced or cleared this transport.
      if (transportRef.current !== transport) {
        transport.stop();
      }
    })();

    return () => {
      const current = transportRef.current;
      transportRef.current = null;
      current?.stop();
      setAgentTyping({ active: false, displayName: null });
      setOperatorsOnline(false);
    };
  }, [api, open, readyEmbedToken, readySessionToken]);

  // Read receipts: only while the panel is open AND the document is visible.
  // Closing the panel or hiding the tab stops further mark-read calls.
  useEffect(() => {
    if (!open) {
      return;
    }

    const markVisibleAgentMessagesRead = () => {
      if (
        !shouldMarkMessagesRead({
          panelOpen: open,
          visibilityState: document.visibilityState,
        })
      ) {
        return;
      }

      const maxSeq = maxAgentMessageSequence(messagesRef.current);
      if (maxSeq > 0) {
        transportRef.current?.notifyMessagesVisible(maxSeq);
      }
    };

    markVisibleAgentMessagesRead();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        markVisibleAgentMessagesRead();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [open, messages]);

  // Multi-tab / race: panel may open before listMessages finishes. When the
  // conversation snapshot arrives, promote connecting → subscribed.
  useEffect(() => {
    const init = initRef.current;
    const transport = transportRef.current;
    if (!open || !init || !readySessionToken || !readyEmbedToken || !transport) {
      return;
    }
    if (messages.length === 0) {
      return;
    }

    if (transport.getMessages().length === 0) {
      transport.replaceMessages(messages);
    }
    void transport.ensureLiveConnection({
      embedToken: init.embedToken,
      sessionToken: readySessionToken,
    });
  }, [messages.length, open, readyEmbedToken, readySessionToken]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onOffline = () => {
      setConnectionState("disconnected");
    };

    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("offline", onOffline);
    };
  }, [open]);

  const addLocalFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const accepted: SelectedLocalFile[] = [];
      for (const file of incoming) {
        const result = await fileToSelectedLocalFile(file);
        if (!result.ok) {
          setSendError(
            result.message.toLowerCase().includes("large")
              ? messagesCopy.attachmentTooLarge
              : messagesCopy.attachmentUnsupported,
          );
          continue;
        }
        accepted.push(result.value);
      }
      if (accepted.length === 0) {
        return;
      }
      setPendingFiles((current) => [...current, ...accepted].slice(0, 10));
      setSendError(null);
    },
    [messagesCopy.attachmentTooLarge, messagesCopy.attachmentUnsupported],
  );

  useEffect(() => {
    const preventNavigation = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);

  const reconcileTransport = async (
    readyState: Extract<WidgetState, { status: "ready" }>,
    mergedMessages: MessageView[],
  ) => {
    if (!transportRef.current) {
      const transport = new WidgetRealtimeTransport(api, {
        onMessages: setMessages,
        onConnectionState: setConnectionState,
        onAgentTyping: setAgentTyping,
        onPresence: (presence) => {
          setOperatorsOnline(presence.operatorsOnline);
        },
        onAgentReceipts: (cursors) => {
          agentReceiptsRef.current = cursors;
          setAgentReceipts(cursors);
        },
      });
      transportRef.current = transport;
      await transport.start({
        embedToken: readyState.init.embedToken,
        sessionToken: readyState.sessionToken,
        initialMessages: mergedMessages,
        initialAgentReceipts: agentReceiptsRef.current,
        initialVisitorReceipts: visitorReceiptsRef.current,
      });
    } else {
      transportRef.current.replaceMessages(mergedMessages);
      await transportRef.current.ensureLiveConnection({
        embedToken: readyState.init.embedToken,
        sessionToken: readyState.sessionToken,
      });
    }
  };

  const handleSend = async () => {
    if (state.status !== "ready" || sending) {
      return;
    }
    if (!composer.trim() && pendingFiles.length === 0) {
      return;
    }

    const body = composer.trim();
    const filesForSend = pendingFiles;
    const clientMessageId = pendingClientMessageIdRef.current ?? generateClientMessageId();
    pendingClientMessageIdRef.current = clientMessageId;
    const tempId = crypto.randomUUID();
    const optimistic = createOptimisticMessage({
      tempId,
      clientMessageId,
      body,
      senderType: "visitor",
      senderLabel: messagesCopy.youLabel,
      nextSequence: maxSequenceNumber(messages) + 1,
      attachments: filesForSend.map((file, index) => ({
        id: file.localId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        kind: file.kind,
        width: file.width,
        height: file.height,
        sortOrder: index,
        hasThumbnail: file.kind === "image",
      })),
    });

    forceScrollRef.current = true;
    nearBottomRef.current = true;
    setMessages((current) => mergeMessages(current, [], [optimistic]));
    setComposer("");
    setPendingFiles([]);
    transportRef.current?.clearLocalTyping();
    setSending(true);
    setSendError(null);
    setFailedClientMessageId(null);

    try {
      let resultMessage;
      if (filesForSend.length > 0) {
        let batch = reduceUploadBatch(createEmptyUploadBatch(body), {
          type: "SELECT_FILES",
          clientMessageId,
          body,
          items: filesForSend.map((file) => ({
            localId: file.localId,
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            kind: file.kind,
            previewUrl: file.previewUrl,
            width: file.width,
            height: file.height,
          })),
        });
        setUploadBatch(batch);

        const initiated = await api.initiateUploads({
          embedToken: state.init.embedToken,
          sessionToken: state.sessionToken,
          files: filesForSend.map((file) => ({
            localId: file.localId,
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            width: file.width,
            height: file.height,
          })),
          body,
          clientMessageId,
          pageUrl: state.init.parentOrigin,
          referrer: document.referrer || undefined,
        });

        batch = reduceUploadBatch(batch, {
          type: "PREPARE_SUCCESS",
          batchId: initiated.batchId,
          uploads: initiated.uploads.map((upload) => ({
            localId: upload.localId,
            uploadId: upload.uploadId,
            attachmentId: upload.attachmentId,
          })),
        });
        setUploadBatch(batch);

        const abort = new AbortController();
        uploadAbortRef.current = abort;

        for (const upload of initiated.uploads) {
          const local = filesForSend.find((file) => file.localId === upload.localId);
          if (!local) {
            continue;
          }
          await uploadBlobWithProgress({
            url: upload.uploadUrl,
            token: upload.uploadToken,
            file: local.file,
            contentType: upload.mimeType,
            signal: abort.signal,
            onProgress: (percent) => {
              setUploadBatch((current) =>
                reduceUploadBatch(current, {
                  type: "UPLOAD_PROGRESS",
                  localId: upload.localId,
                  progress: percent,
                }),
              );
            },
          });
          batch = reduceUploadBatch(batch, {
            type: "UPLOAD_ITEM_SUCCESS",
            localId: upload.localId,
          });
          setUploadBatch(batch);
        }

        batch = reduceUploadBatch(batch, { type: "CONFIRM_START" });
        setUploadBatch(batch);

        const completed = await api.completeUploads({
          embedToken: state.init.embedToken,
          sessionToken: state.sessionToken,
          batchId: initiated.batchId,
          uploadIds: initiated.uploads.map((upload) => upload.uploadId),
          body,
          clientMessageId,
          pageUrl: state.init.parentOrigin,
          referrer: document.referrer || undefined,
        });
        resultMessage = completed.message;
        setUploadBatch(reduceUploadBatch(batch, { type: "CONFIRM_SUCCESS" }));
        revokePreviewUrls(filesForSend);
      } else {
        const result = await api.sendMessage({
          embedToken: state.init.embedToken,
          sessionToken: state.sessionToken,
          body,
          clientMessageId,
          pageUrl: state.init.parentOrigin,
          referrer: document.referrer || undefined,
        });
        resultMessage = result.message;
      }

      pendingClientMessageIdRef.current = null;
      const confirmedMessages = mapWidgetHttpMessages([resultMessage]).map((message) => ({
        ...message,
        clientMessageId: message.clientMessageId ?? clientMessageId,
      }));
      const mergedMessages = mergeMessages(
        messagesRef.current.filter(
          (item) => item.id !== tempId && item.clientMessageId !== clientMessageId,
        ),
        confirmedMessages,
        [],
      );

      messagesRef.current = mergedMessages;
      forceScrollRef.current = true;
      nearBottomRef.current = true;
      setMessages(mergedMessages);
      setUploadBatch(createEmptyUploadBatch());
      await reconcileTransport(state, mergedMessages);
    } catch {
      pendingClientMessageIdRef.current = clientMessageId;
      setFailedClientMessageId(clientMessageId);
      setMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item,
        ),
      );
      setComposer(body);
      setPendingFiles(filesForSend);
      // Text-only failures must not flip the upload state machine (would replace Send
      // with "Retry upload" and break message-retry UX / a11y selectors).
      if (filesForSend.length > 0) {
        setUploadBatch((current) =>
          reduceUploadBatch(current, {
            type: "CONFIRM_FAILURE",
            message: messagesCopy.uploadFailedLabel,
          }),
        );
      }
      setSendError(messagesCopy.sendError);
    } finally {
      uploadAbortRef.current = null;
      setSending(false);
    }
  };

  const primaryColor = config?.branding.primaryColor ?? "#0066FF";
  const position = config?.position ?? "bottom-right";
  const insets = positionInsets(position);
  const panelLabel = config?.branding.displayName ?? messagesCopy.chatPanelLabel;

  return (
    <div
      dir={direction}
      lang={locale}
      data-widget-locale={locale}
      data-widget-dir={direction}
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#111827",
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? messagesCopy.launcherOpenLabel : messagesCopy.launcherLabel}
        onClick={() => {
          setOpen((value) => !value);
        }}
        style={{
          position: "fixed",
          bottom: "1rem",
          ...insets,
          width: "3.5rem",
          height: "3.5rem",
          borderRadius: "9999px",
          border: "none",
          background: primaryColor,
          color: "#fff",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(0,0,0,0.18)",
          zIndex: 1,
        }}
      >
        {open ? "×" : "💬"}
      </button>

      {open ? (
        <section
          aria-label={panelLabel}
          data-testid="widget-realtime-ready"
          data-realtime-state={connectionState}
          style={{
            position: "fixed",
            bottom: "5rem",
            ...insets,
            width: "min(100vw - 2rem, 24rem)",
            height: "min(100vh - 7rem, 32rem)",
            background: "#fff",
            borderRadius: "1rem",
            boxShadow: "0 20px 40px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 1,
          }}
        >
          <header
            style={{
              padding: "1rem",
              borderBottom: "1px solid #e5e7eb",
              background: primaryColor,
              color: "#fff",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {config?.branding.displayName ?? messagesCopy.chatPanelLabel}
            </div>
            <div
              data-testid="widget-operator-presence"
              data-presence={operatorsOnline ? "online" : "offline"}
              style={{
                fontSize: "0.75rem",
                opacity: 0.9,
                marginTop: "0.2rem",
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: "0.4rem",
                  height: "0.4rem",
                  borderRadius: "9999px",
                  background: operatorsOnline ? "#86efac" : "rgba(255,255,255,0.45)",
                  display: "inline-block",
                }}
              />
              {operatorsOnline ? messagesCopy.online : messagesCopy.offline}
            </div>
            {config?.greetingMessage ? (
              <div style={{ fontSize: "0.875rem", opacity: 0.95, marginTop: "0.25rem" }}>
                {config.greetingMessage}
              </div>
            ) : null}
            {connectionState !== "connected" && connectionState !== "connecting" ? (
              <div
                role="status"
                data-testid="widget-connection-status"
                data-connection-state={connectionState}
                style={{ fontSize: "0.75rem", marginTop: "0.35rem", opacity: 0.9 }}
              >
                {connectionState === "reconnecting"
                  ? messagesCopy.reconnectingLabel
                  : connectionState === "failed"
                    ? messagesCopy.connectionFailedLabel
                    : messagesCopy.offlineLabel}
              </div>
            ) : null}
          </header>

          <div
            ref={messagesContainerRef}
            aria-live="polite"
            data-testid="widget-messages"
            onScroll={(event) => {
              nearBottomRef.current = isNearBottom(event.currentTarget);
            }}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "1rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              background: "#f9fafb",
            }}
          >
            {state.status === "error" ? <p role="alert">{state.message}</p> : null}

            {state.status === "booting" ? <p>{messagesCopy.welcomeTitle}</p> : null}

            {state.status === "ready" && messages.length === 0 ? (
              <p>{config?.greetingMessage ?? messagesCopy.welcomeTitle}</p>
            ) : null}

            {messages.map((message) => {
              const isVisitor = message.senderType === "visitor";
              const label = isVisitor
                ? messagesCopy.youLabel
                : message.senderType === "agent"
                  ? messagesCopy.agentLabel
                  : messagesCopy.systemLabel;
              const receiptStatus =
                isVisitor && message.status !== "failed" && !message.isOptimistic
                  ? deriveMessageReceiptStatus({
                      sequenceNumber: message.sequenceNumber,
                      peer: agentReceipts,
                    })
                  : null;

              return (
                <article
                  key={message.id}
                  data-testid={isVisitor ? "visitor-message" : "agent-message"}
                  style={{
                    alignSelf: isVisitor ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    background: isVisitor ? primaryColor : "#fff",
                    color: isVisitor ? "#fff" : "#111827",
                    padding: "0.625rem 0.75rem",
                    borderRadius: "0.75rem",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                    opacity: message.status === "pending" ? 0.8 : 1,
                  }}
                >
                  <div style={{ fontSize: "0.75rem", opacity: 0.85, marginBottom: "0.25rem" }}>
                    {label} · {formatMessageTime(message.createdAt, locale)}
                  </div>
                  {message.body ? (
                    <div dir="auto" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                      {message.body}
                    </div>
                  ) : null}
                  {state.status === "ready" &&
                  message.attachments &&
                  message.attachments.length > 0 ? (
                    <MessageAttachments
                      attachments={message.attachments}
                      isVisitor={isVisitor}
                      api={api}
                      embedToken={state.init.embedToken}
                      sessionToken={state.sessionToken}
                      copy={messagesCopy}
                    />
                  ) : null}
                  {receiptStatus ? (
                    <MessageReceiptTicks
                      status={receiptStatus}
                      label={receiptLabel(receiptStatus, messagesCopy)}
                    />
                  ) : null}
                  {message.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setComposer(message.body);
                        pendingClientMessageIdRef.current =
                          message.clientMessageId ?? failedClientMessageId;
                      }}
                      style={{
                        marginTop: "0.35rem",
                        background: "transparent",
                        border: "none",
                        color: isVisitor ? "#fff" : "#b91c1c",
                        textDecoration: "underline",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                      }}
                    >
                      {messagesCopy.retryLabel}
                    </button>
                  ) : null}
                </article>
              );
            })}
            <div data-testid="widget-messages-end" aria-hidden="true" />
          </div>

          <div
            data-testid="agent-typing"
            aria-live="polite"
            aria-atomic="true"
            style={{
              minHeight: "1.25rem",
              padding: "0 1rem",
              fontSize: "0.75rem",
              color: "#6b7280",
              background: "#f9fafb",
            }}
          >
            {agentTyping.active
              ? formatWidgetMessage(messagesCopy.agentTyping, {
                  name: agentTyping.displayName ?? messagesCopy.agentLabel,
                })
              : null}
          </div>

          <footer
            style={{
              borderTop: "1px solid #e5e7eb",
              padding: "0.75rem",
              position: "relative",
              outline: dragActive ? `2px solid ${primaryColor}` : undefined,
              background: dragActive ? "#eff6ff" : undefined,
            }}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              if (event.dataTransfer.files.length > 0) {
                void addLocalFiles(event.dataTransfer.files);
              }
            }}
          >
            {dragActive ? (
              <div
                role="status"
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(239,246,255,0.92)",
                  zIndex: 2,
                  fontSize: "0.875rem",
                  fontWeight: 600,
                }}
              >
                {messagesCopy.dropFilesLabel}
              </div>
            ) : null}
            {sendError ? (
              <p
                role="alert"
                style={{ color: "#b91c1c", fontSize: "0.875rem", marginBottom: "0.5rem" }}
              >
                {sendError}
              </p>
            ) : null}
            {pendingFiles.length > 0 ? (
              <ul
                data-testid="pending-attachments"
                style={{
                  listStyle: "none",
                  margin: "0 0 0.5rem",
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.35rem",
                }}
              >
                {pendingFiles.map((file) => (
                  <li
                    key={file.localId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      fontSize: "0.75rem",
                    }}
                  >
                    {file.previewUrl ? (
                      <img
                        src={file.previewUrl}
                        alt=""
                        width={32}
                        height={32}
                        style={{ objectFit: "cover", borderRadius: "0.25rem" }}
                      />
                    ) : null}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {file.filename}
                    </span>
                    <button
                      type="button"
                      aria-label={formatWidgetMessage(messagesCopy.removeAttachmentLabel, {
                        filename: file.filename,
                      })}
                      onClick={() => {
                        setPendingFiles((current) => {
                          const next = current.filter((item) => item.localId !== file.localId);
                          revokePreviewUrls(
                            current.filter((item) => item.localId === file.localId),
                          );
                          return next;
                        });
                      }}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        color: "#6b7280",
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div
              role="status"
              aria-live="polite"
              data-testid="upload-status"
              data-upload-status={uploadBatchAriaStatus(uploadBatch.status)}
              style={{
                fontSize: "0.75rem",
                color: "#6b7280",
                minHeight: uploadBatch.status === "idle" ? 0 : "1rem",
                marginBottom: uploadBatch.status === "idle" ? 0 : "0.35rem",
              }}
            >
              {uploadBatch.status === "uploading" || uploadBatch.status === "confirming"
                ? messagesCopy.uploadUploadingLabel
                : uploadBatch.status === "failed"
                  ? messagesCopy.uploadFailedLabel
                  : uploadBatch.status === "complete"
                    ? messagesCopy.uploadCompleteLabel
                    : null}
              {(() => {
                const uploading = uploadBatch.items.find((item) => item.status === "uploading");
                return uploading ? ` ${String(uploading.progress)}%` : null;
              })()}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={acceptAttributeForAttachments()}
                capture="environment"
                aria-label={messagesCopy.attachFilesLabel}
                data-testid="widget-file-input"
                style={{ display: "none" }}
                onChange={(event) => {
                  if (event.target.files) {
                    void addLocalFiles(event.target.files);
                    event.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                data-testid="widget-attach-button"
                aria-label={messagesCopy.attachLabel}
                disabled={state.status !== "ready" || sending}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  borderRadius: "0.75rem",
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#111827",
                  padding: "0.625rem 0.75rem",
                  cursor: "pointer",
                }}
              >
                +
              </button>
              <textarea
                value={composer}
                onChange={(event) => {
                  const next = event.target.value;
                  setComposer(next);
                  transportRef.current?.notifyComposerChange(next);
                }}
                onPaste={(event) => {
                  const items = event.clipboardData.items;
                  const files: File[] = [];
                  for (const item of Array.from(items)) {
                    if (item.kind === "file") {
                      const file = item.getAsFile();
                      if (file) {
                        files.push(file);
                      }
                    }
                  }
                  if (files.length > 0) {
                    event.preventDefault();
                    void addLocalFiles(files);
                  }
                }}
                placeholder={messagesCopy.composerPlaceholder}
                aria-label={messagesCopy.composerPlaceholder}
                dir="auto"
                rows={2}
                disabled={state.status !== "ready" || sending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                style={{
                  flex: 1,
                  resize: "none",
                  borderRadius: "0.75rem",
                  border: "1px solid #d1d5db",
                  padding: "0.625rem 0.75rem",
                  font: "inherit",
                }}
              />
              {uploadBatch.status === "uploading" || uploadBatch.status === "confirming" ? (
                <button
                  type="button"
                  data-testid="widget-upload-cancel"
                  aria-label={messagesCopy.uploadCancelLabel}
                  onClick={() => {
                    uploadAbortRef.current?.abort();
                    setUploadBatch((current) => reduceUploadBatch(current, { type: "CANCEL" }));
                    if (uploadBatch.batchId && state.status === "ready") {
                      void api.cancelUploads({
                        embedToken: state.init.embedToken,
                        sessionToken: state.sessionToken,
                        batchId: uploadBatch.batchId,
                      });
                    }
                    setSending(false);
                  }}
                  style={{
                    borderRadius: "0.75rem",
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    padding: "0 0.75rem",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              ) : null}
              {uploadBatch.status === "failed" ? (
                <button
                  type="button"
                  data-testid="widget-upload-retry"
                  aria-label={messagesCopy.uploadRetryLabel}
                  onClick={() => {
                    setUploadBatch((current) => reduceUploadBatch(current, { type: "RETRY" }));
                    void handleSend();
                  }}
                  style={{
                    borderRadius: "0.75rem",
                    border: "none",
                    background: primaryColor,
                    color: "#fff",
                    padding: "0 1rem",
                    cursor: "pointer",
                  }}
                >
                  {messagesCopy.uploadRetryLabel}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={
                    state.status !== "ready" ||
                    sending ||
                    (!composer.trim() && pendingFiles.length === 0)
                  }
                  aria-label={sending ? messagesCopy.sendingLabel : messagesCopy.sendLabel}
                  style={{
                    borderRadius: "0.75rem",
                    border: "none",
                    background: primaryColor,
                    color: "#fff",
                    padding: "0 1rem",
                    cursor: "pointer",
                    minWidth: "4.5rem",
                  }}
                >
                  {sending ? messagesCopy.sendingLabel : messagesCopy.sendLabel}
                </button>
              )}
            </div>
            {config?.branding.showPoweredBy !== false ? (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.75rem",
                  color: "#6b7280",
                  textAlign: "end",
                }}
              >
                {messagesCopy.poweredBy}
              </div>
            ) : null}
          </footer>
        </section>
      ) : null}
    </div>
  );
}

function receiptLabel(status: MessageReceiptStatus, copy: WidgetMessages): string {
  if (status === "seen") {
    return copy.messageSeen;
  }
  if (status === "delivered") {
    return copy.messageDelivered;
  }
  return copy.messageSent;
}

function MessageReceiptTicks({ status, label }: { status: MessageReceiptStatus; label: string }) {
  const glyph = status === "sent" ? "✓" : "✓✓";

  return (
    <span
      data-testid="message-receipt"
      data-receipt={status}
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        marginTop: "0.35rem",
        fontSize: "0.7rem",
        opacity: status === "seen" ? 1 : 0.85,
        letterSpacing: status === "sent" ? "0" : "-0.06em",
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </span>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <WidgetApp />
    </StrictMode>,
  );
}
