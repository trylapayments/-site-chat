"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  getConversationRatingAction,
  sendOperatorTranscriptAction,
} from "@/lib/conversation-wrapup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function ConversationFollowUp({
  slug,
  conversationId,
  email: initialEmail,
}: {
  slug: string;
  conversationId: string;
  email?: string | null;
}) {
  const [rating, setRating] =
    useState<Awaited<ReturnType<typeof getConversationRatingAction>>>(null);
  const [email, setEmail] = useState(initialEmail ?? "");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  const request = useRef<{ email: string; id: string } | null>(null);
  useEffect(() => {
    let active = true;
    let flight = false;
    async function refresh() {
      if (flight || document.visibilityState === "hidden") return;
      flight = true;
      try {
        const next = await getConversationRatingAction(slug, conversationId);
        if (active) setRating(next);
      } catch {
        /* Keep last known rating on a temporary connection failure. */
      } finally {
        flight = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [slug, conversationId]);
  return (
    <section className="space-y-3 py-4" data-testid="conversation-follow-up">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Conversation follow-up
      </h2>
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
