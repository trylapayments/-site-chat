"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  type getConversationRatingAction,
  sendOperatorTranscriptAction,
} from "@/lib/conversation-wrapup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function ConversationFollowUp({
  slug,
  conversationId,
  email: initialEmail,
  ratingOnly = false,
  showRating = true,
  pollRating = true,
}: {
  slug: string;
  conversationId: string;
  email?: string | null;
  ratingOnly?: boolean;
  showRating?: boolean;
  pollRating?: boolean;
}) {
  const [rating, setRating] =
    useState<Awaited<ReturnType<typeof getConversationRatingAction>>>(null);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const request = useRef<{ email: string; id: string } | null>(null);
  useEffect(() => {
    if (!showRating) return;
    setRating(null);
    let active = true;
    let flight = false;
    let complete = false;
    async function refresh() {
      if (flight || complete || document.visibilityState === "hidden") return;
      flight = true;
      try {
        const response = await fetch(`/api/portal/rating?${new URLSearchParams({ slug, conversationId })}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load rating.");
        const next = await response.json() as Awaited<ReturnType<typeof getConversationRatingAction>>;
        if (active) { setRating(next); complete = Boolean(next); }
      } catch {
        /* Keep last known rating on a temporary connection failure. */
      } finally {
        flight = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const resume = () => void refresh();
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [slug, conversationId, showRating, pollRating]);
  if (ratingOnly) {
    if (!rating) return null;
    return (
      <section
        role="status"
        className="mx-3 mt-3 shrink-0 rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 md:mx-6"
        data-testid="customer-feedback"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Customer feedback</h2>
          <span
            className="whitespace-nowrap text-sm font-semibold"
            aria-label={`Customer rating: ${String(rating.score)} out of 5`}
          >
            <span aria-hidden="true" className="mr-2 text-amber-600">
              {"★".repeat(rating.score)}
              {"☆".repeat(5 - rating.score)}
            </span>
            {rating.score}/5
          </span>
        </div>
        {rating.comment ? (
          <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-sm">
            {rating.comment}
          </p>
        ) : null}
      </section>
    );
  }
  return (
    <section className="space-y-3 py-4" data-testid="conversation-follow-up">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Conversation follow-up
      </h2>
      {showRating ? (
        <div className="text-sm">
          {rating ? (
            <>
              <p className="font-medium" data-testid="conversation-rating">
                Customer rating: {rating.score}/5
              </p>
              {rating.comment ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {rating.comment}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">No customer rating yet.</p>
          )}
        </div>
      ) : null}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const normalized = email.trim().toLowerCase();
          if (request.current?.email !== normalized)
            request.current = { email: normalized, id: crypto.randomUUID() };
          const id = request.current.id;
          setNotice("");
          start(async () => {
            try {
              const result = await sendOperatorTranscriptAction(slug, {
                conversationId,
                email: normalized,
                requestId: id,
              });
              if (result.success) {
                setNotice("Transcript sent.");
                request.current = null;
              } else setNotice(result.message);
            } catch {
              setNotice("Unable to send the transcript. Please try again.");
            }
          });
        }}
      >
        <label
          htmlFor={`transcript-${conversationId}`}
          className="block text-xs text-muted-foreground"
        >
          Send transcript to
        </label>
        <Input
          id={`transcript-${conversationId}`}
          type="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          placeholder="Customer email"
          disabled={pending}
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={pending || !email.trim()}
        >
          {pending ? "Sending…" : "Email transcript"}
        </Button>
        <p role="status" className="text-xs">
          {notice}
        </p>
      </form>
    </section>
  );
}
