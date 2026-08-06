import {
  createOptimisticMessage,
  maxSequenceNumber,
  mergeMessages,
  type ConnectionState,
  type MessageView,
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
import {
  englishMessages,
  formatMessageTime,
  getWidgetDirection,
  loadWidgetDictionary,
  resolveWidgetLocale,
  type WidgetMessages,
} from "../i18n";
import { isMessageFromParent } from "../post-message";
import { readParentOriginFromLocation } from "../parent-origin";
import { mapWidgetHttpMessages, WidgetRealtimeTransport } from "../realtime/visitor-transport";
import {
  clearSessionToken,
  generateClientMessageId,
  readSessionToken,
  writeSessionToken,
} from "../session/storage";
import { isNearBottom, scrollContainerToBottom, shouldAutoScroll } from "./scroll";

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
  const initRef = useRef<InitPayload | null>(null);
  const parentOriginRef = useRef<string | null>(null);
  const transportRef = useRef<WidgetRealtimeTransport | null>(null);
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const messagesRef = useRef<MessageView[]>([]);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const forceScrollRef = useRef(false);
  const nearBottomRef = useRef(true);
  const sessionLocaleRef = useRef<WidgetLocale>("en");

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
  }, [messages, open]);

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
      });
      transportRef.current = transport;
      await transport.start({
        embedToken: init.embedToken,
        sessionToken,
        initialMessages: snapshot,
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
    };
  }, [api, open, readyEmbedToken, readySessionToken]);

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

  const handleSend = async () => {
    if (state.status !== "ready" || !composer.trim() || sending) {
      return;
    }

    const body = composer.trim();
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
    });

    forceScrollRef.current = true;
    nearBottomRef.current = true;
    setMessages((current) => mergeMessages(current, [], [optimistic]));
    setComposer("");
    setSending(true);
    setSendError(null);
    setFailedClientMessageId(null);

    try {
      const result = await api.sendMessage({
        embedToken: state.init.embedToken,
        sessionToken: state.sessionToken,
        body,
        clientMessageId,
        pageUrl: state.init.parentOrigin,
        referrer: document.referrer || undefined,
      });

      pendingClientMessageIdRef.current = null;
      const confirmedMessages = mapWidgetHttpMessages([result.message]).map((message) => ({
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

      if (!transportRef.current) {
        const transport = new WidgetRealtimeTransport(api, {
          onMessages: setMessages,
          onConnectionState: setConnectionState,
        });
        transportRef.current = transport;
        await transport.start({
          embedToken: state.init.embedToken,
          sessionToken: state.sessionToken,
          initialMessages: mergedMessages,
        });
      } else {
        transportRef.current.replaceMessages(mergedMessages);
        await transportRef.current.ensureLiveConnection({
          embedToken: state.init.embedToken,
          sessionToken: state.sessionToken,
        });
      }
    } catch {
      pendingClientMessageIdRef.current = clientMessageId;
      setFailedClientMessageId(clientMessageId);
      setMessages((current) =>
        current.map((item) =>
          item.clientMessageId === clientMessageId ? { ...item, status: "failed" } : item,
        ),
      );
      setComposer(body);
      setSendError(messagesCopy.sendError);
    } finally {
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
            {config?.greetingMessage ? (
              <div style={{ fontSize: "0.875rem", opacity: 0.95, marginTop: "0.25rem" }}>
                {config.greetingMessage}
              </div>
            ) : null}
            {connectionState !== "connected" && connectionState !== "connecting" ? (
              <div
                role="status"
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

              return (
                <article
                  key={message.id}
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
                  <div dir="auto" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {message.body}
                  </div>
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

          <footer style={{ borderTop: "1px solid #e5e7eb", padding: "0.75rem" }}>
            {sendError ? (
              <p
                role="alert"
                style={{ color: "#b91c1c", fontSize: "0.875rem", marginBottom: "0.5rem" }}
              >
                {sendError}
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <textarea
                value={composer}
                onChange={(event) => {
                  setComposer(event.target.value);
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
              <button
                type="button"
                onClick={() => {
                  void handleSend();
                }}
                disabled={state.status !== "ready" || sending || !composer.trim()}
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

const rootElement = document.getElementById("root");
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <WidgetApp />
    </StrictMode>,
  );
}
