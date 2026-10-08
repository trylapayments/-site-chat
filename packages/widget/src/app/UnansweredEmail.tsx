import { useEffect, useState } from "react";
import type { WidgetApiClient } from "../api/client";
import type { MessageView } from "@site-chat/shared";
import { unansweredSince } from "./waiting";
export function UnansweredEmail({
  api,
  embedToken,
  sessionToken,
  messages,
  enabled,
  delaySeconds,
  saved,
  hasOperatorReply = false,
  open,
  accentColor,
  textColor,
  borderColor,
}: {
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  messages: MessageView[];
  enabled: boolean;
  delaySeconds: number;
  saved: boolean;
  hasOperatorReply?: boolean;
  open: boolean;
  accentColor: string;
  textColor: string;
  borderColor: string;
}) {
  const [now, setNow] = useState(Date.now());
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(saved);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const since = hasOperatorReply ? null : unansweredSince(messages);
  useEffect(() => {
    if (saved) setDone(true);
  }, [saved]);
  useEffect(() => {
    if (!enabled || !open || since === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, open, since]);
  if (!enabled || since === null || now - since < delaySeconds * 1000) return null;
  return (
    <section
      data-testid="widget-unanswered-email"
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 14,
        padding: "1rem",
        color: textColor,
      }}
    >
      {done ? (
        <p role="status" style={{ margin: 0 }}>
          Your messages are saved. We'll email you when our team replies. You can keep chatting
          here.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            setError("");
            void api
              .saveReplyEmail(embedToken, sessionToken, email)
              .then((result) => {
                if (!result.saved) throw new Error();
                setDone(true);
              })
              .catch(() => {
                setError("Unable to save your email. Please try again.");
              })
              .finally(() => {
                setPending(false);
              });
          }}
          style={{ display: "grid", gap: "0.7rem" }}
        >
          <strong>Don't want to wait?</strong>
          <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.5 }}>
            Leave your message below and we'll reply by email. Your conversation stays right here.
          </p>
          <label style={{ fontSize: "0.875rem" }}>
            Email address
            <input
              required
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              autoComplete="email"
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                padding: "0.75rem",
                border: `1px solid ${borderColor}`,
                borderRadius: 9,
                fontSize: 16,
                marginTop: 6,
                color: textColor,
                background: "transparent",
              }}
            />
          </label>
          <button
            disabled={pending}
            type="submit"
            style={{
              padding: "0.75rem",
              border: 0,
              borderRadius: 9,
              background: accentColor,
              color: "white",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            {pending ? "Saving…" : "Get a reply by email"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </form>
      )}
    </section>
  );
}
