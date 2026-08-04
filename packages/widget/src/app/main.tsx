import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  WidgetApiClient,
  type BootstrapPayload,
  type MessagePayload,
  type WidgetPublicConfig,
} from "../api/client";
import {
  formatMessageTime,
  getWidgetDirection,
  resolveWidgetLocale,
  widgetDictionaries,
  type WidgetLocale,
} from "../i18n";
import {
  clearSessionToken,
  generateClientMessageId,
  readSessionToken,
  writeSessionToken,
} from "../session/storage";

function isMessageFromParent(event: MessageEvent, expectedParentOrigin: string): boolean {
  return event.source === window.parent && event.origin === expectedParentOrigin;
}

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

function WidgetApp() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WidgetState>({ status: "booting" });
  const [messages, setMessages] = useState<MessagePayload[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const initRef = useRef<InitPayload | null>(null);
  const parentOriginRef = useRef<string | null>(null);

  const api = useMemo(() => new WidgetApiClient(window.location.origin), []);

  const locale = state.status === "ready" ? state.locale : "en";
  const messagesCopy = widgetDictionaries[locale];
  const direction = getWidgetDirection(locale);

  const config: WidgetPublicConfig | null =
    state.status === "ready" ? state.init.config : (initRef.current?.config ?? null);

  const initialize = useCallback(
    async (init: InitPayload) => {
      initRef.current = init;
      parentOriginRef.current = init.parentOrigin;

      const resolvedLocale = resolveWidgetLocale({
        configLocale: init.config.locale,
        browserLocale: navigator.language,
      });

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

        setState({
          status: "ready",
          init,
          sessionToken: session.sessionToken,
          locale: session.locale,
        });

        if (session.hasConversation) {
          const listed = await api.listMessages({
            embedToken: init.embedToken,
            sessionToken: session.sessionToken,
          });
          setMessages(listed.items);
        }
      } catch {
        clearSessionToken(init.widgetPublicKey);
        setState({ status: "error", message: messagesCopy.loadError });
      }
    },
    [api, messagesCopy.loadError],
  );

  useEffect(() => {
    const parentOrigin = parentOriginRef.current ?? window.location.origin;
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
    const parentOrigin = parentOriginRef.current ?? initRef.current?.parentOrigin;
    if (!parentOrigin) {
      return;
    }

    postToParent(parentOrigin, "sitechat:visibility", { open });
  }, [open]);

  const handleSend = async () => {
    if (state.status !== "ready" || !composer.trim() || sending) {
      return;
    }

    const body = composer.trim();
    const clientMessageId = generateClientMessageId();
    setComposer("");
    setSending(true);
    setSendError(null);

    try {
      const result = await api.sendMessage({
        embedToken: state.init.embedToken,
        sessionToken: state.sessionToken,
        body,
        clientMessageId,
        pageUrl: state.init.parentOrigin,
        referrer: document.referrer || undefined,
      });

      setMessages((current) => {
        const exists = current.some((item) => item.id === result.message.id);
        if (exists) {
          return current;
        }
        return [...current, result.message].sort((a, b) => a.sequence_number - b.sequence_number);
      });
    } catch {
      setComposer(body);
      setSendError(messagesCopy.sendError);
    } finally {
      setSending(false);
    }
  };

  const primaryColor = config?.branding.primaryColor ?? "#0066FF";
  const position = config?.position ?? "bottom-right";

  return (
    <div
      dir={direction}
      lang={locale}
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
          insetInlineEnd: "1rem",
          bottom: "1rem",
          ...(position === "bottom-left"
            ? { insetInlineEnd: "auto", insetInlineStart: "1rem" }
            : {}),
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
          aria-label="Site Chat"
          style={{
            position: "fixed",
            insetInlineEnd: "1rem",
            bottom: "5rem",
            ...(position === "bottom-left"
              ? { insetInlineEnd: "auto", insetInlineStart: "1rem" }
              : {}),
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
            <div style={{ fontWeight: 600 }}>{config?.branding.displayName ?? "Site Chat"}</div>
            {config?.greetingMessage ? (
              <div style={{ fontSize: "0.875rem", opacity: 0.95, marginTop: "0.25rem" }}>
                {config.greetingMessage}
              </div>
            ) : null}
          </header>

          <div
            aria-live="polite"
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
              const isVisitor = message.sender_type === "visitor";
              const label = isVisitor
                ? messagesCopy.youLabel
                : message.sender_type === "agent"
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
                  }}
                >
                  <div style={{ fontSize: "0.75rem", opacity: 0.85, marginBottom: "0.25rem" }}>
                    {label} · {formatMessageTime(message.created_at, locale)}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {message.body}
                  </div>
                </article>
              );
            })}
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
