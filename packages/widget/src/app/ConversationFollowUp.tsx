import { useEffect, useRef, useState } from "react";
import type { WidgetApiClient } from "../api/client";
type Context = Awaited<ReturnType<WidgetApiClient["engagement"]>>;
export function ConversationFollowUp({
  api,
  embedToken,
  sessionToken,
  context,
  onRated,
  accentColor,
  textColor,
  borderColor,
}: {
  api: WidgetApiClient;
  embedToken: string;
  sessionToken: string;
  context: Context;
  onRated: (rating: { score: number; comment: string }) => void;
  accentColor: string;
  textColor: string;
  borderColor: string;
}) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [emailOpen, setEmailOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<{ email: string; id: string } | null>(null);
  const completed =
    context.conversationStatus === "closed" || context.conversationStatus === "resolved";
  useEffect(() => {
    setScore(0);
    setComment("");
    setNotice("");
    setPending(false);
    request.current = null;
  }, [context.conversationId]);
  const button = {
    padding: "0.5rem 0.8rem",
    borderRadius: 8,
    border: `1px solid ${borderColor}`,
    background: "transparent",
    color: textColor,
    fontSize: "0.8125rem",
    cursor: "pointer",
  };
  const inputStyle = {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "0.65rem",
    border: `1px solid ${borderColor}`,
    borderRadius: 8,
    background: "transparent",
    color: textColor,
    fontFamily: "inherit",
    fontSize: "0.875rem",
  };
  if (!context.conversationId) return null;
  return (
    <section
      style={{
        margin: "0.75rem 0",
        padding: "1rem",
        border: `1px solid ${borderColor}`,
        borderRadius: 12,
        color: textColor,
      }}
      data-testid="widget-conversation-follow-up"
    >
      {completed ? (
        <p
          role="status"
          style={{ margin: "0 0 0.5rem", fontWeight: 600, fontSize: "0.875rem" }}
          data-testid="widget-conversation-closed"
        >
          This conversation is closed.
        </p>
      ) : null}
      {completed ? (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.8125rem", lineHeight: 1.5 }}>
          You can send a message below to chat with us again.
        </p>
      ) : null}
      {completed && context.setup.ratingEnabled ? (
        context.rating ? (
          <p style={{ fontSize: "0.8125rem" }} data-testid="widget-rating-thanks">
            Thank you for your feedback · {context.rating.score}/5
          </p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                if (!score || pending) return;
                setPending(true);
                setNotice("");
                try {
                  const result = await api.conversationAction(embedToken, sessionToken, {
                    action: "rating",
                    conversationId: context.conversationId,
                    score,
                    comment,
                  });
                  if (typeof result.score === "number")
                    onRated({ score: result.score, comment: result.comment ?? "" });
                } catch (error) {
                  setNotice(error instanceof Error ? error.message : "Unable to send your rating.");
                } finally {
                  setPending(false);
                }
              })();
            }}
            style={{ display: "grid", gap: "0.65rem", marginBottom: "0.75rem" }}
          >
            <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500 }}>
              How was your conversation?
            </p>
            <div
              role="group"
              aria-label="Rate your conversation"
              style={{ display: "flex", gap: 6 }}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`Rate ${String(n)} out of 5`}
                  aria-pressed={score === n}
                  disabled={pending}
                  onClick={() => {
                    setScore(n);
                  }}
                  style={{
                    ...button,
                    color: n <= score ? accentColor : textColor,
                    fontSize: "1.65rem",
                    lineHeight: 1,
                    padding: "0.25rem 0.4rem",
                    border: 0,
                  }}
                >
                  {n <= score ? "★" : "☆"}
                </button>
              ))}
            </div>
            <textarea
              aria-label="Feedback (optional)"
              placeholder="Tell us more (optional)"
              value={comment}
              maxLength={1000}
              rows={2}
              disabled={pending}
              onChange={(e) => {
                setComment(e.target.value);
              }}
              style={{ ...inputStyle, resize: "vertical" }}
            />
            <button
              type="submit"
              disabled={!score || pending}
              style={{ ...button, justifySelf: "start", opacity: !score || pending ? 0.5 : 1 }}
            >
              {pending ? "Sending…" : "Send feedback"}
            </button>
          </form>
        )
      ) : null}
      {context.setup.transcriptEnabled ? (
        <>
          {!emailOpen ? (
            <button
              type="button"
              style={button}
              onClick={() => {
                setEmailOpen(true);
              }}
            >
              Email me this conversation
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void (async () => {
                  if (pending) return;
                  const normalized = email.trim().toLowerCase();
                  if (request.current?.email !== normalized)
                    request.current = { email: normalized, id: crypto.randomUUID() };
                  const id = request.current.id;
                  setPending(true);
                  setNotice("");
                  try {
                    await api.conversationAction(embedToken, sessionToken, {
                      action: "transcript",
                      conversationId: context.conversationId,
                      requestId: id,
                      email: normalized,
                    });
                    setNotice("Transcript sent. Please check your inbox.");
                    setEmailOpen(false);
                    request.current = null;
                  } catch (error) {
                    setNotice(
                      error instanceof Error ? error.message : "Unable to send your transcript.",
                    );
                  } finally {
                    setPending(false);
                  }
                })();
              }}
              style={{ display: "grid", gap: "0.5rem" }}
            >
              <label htmlFor="visitor-transcript-email" style={{ fontSize: "0.8125rem" }}>
                Your email address
              </label>
              <input
                id="visitor-transcript-email"
                type="email"
                required
                value={email}
                disabled={pending}
                maxLength={254}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="submit" disabled={pending} style={button}>
                  {pending ? "Sending…" : "Send transcript"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  style={button}
                  onClick={() => {
                    setEmailOpen(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </>
      ) : null}
      <p role="status" style={{ fontSize: "0.8125rem", margin: notice ? "0.65rem 0 0" : 0 }}>
        {notice}
      </p>
    </section>
  );
}
