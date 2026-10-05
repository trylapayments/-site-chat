"use client";
import { useEffect, useState } from "react";
import { ConversationFollowUp } from "./ConversationFollowUp";
import { getConversationEngagementAction } from "@/lib/visitors/context-action";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
export function ConversationEngagement({
  slug,
  conversationId,
}: {
  slug: string;
  conversationId: string;
}) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof getConversationEngagementAction>>>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async (force = false) => {
      if (inFlight || (!force && document.visibilityState === "hidden")) return;
      inFlight = true;
      try {
        const next = await getConversationEngagementAction(
          slug,
          conversationId,
        );
        if (active) {
          setData(next);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      } finally {
        inFlight = false;
      }
    };
    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [slug, conversationId]);
  return (
    <section className="space-y-3 py-4" data-testid="conversation-engagement">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Visitor details
      </h2>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">IP address</dt>
          <dd className="mt-1 break-words" data-testid="visitor-ip">
            {data?.ip ?? "Unavailable"}
          </dd>
        </div>
        {data?.submission ? (
          <>
            <div>
              <dt className="text-xs text-muted-foreground">Pre-chat form</dt>
              <dd className="mt-1 text-xs text-muted-foreground">
                Submitted by visitor · unverified details
              </dd>
            </div>
            {[
              ["Name", data.submission.name],
              ["Email", data.submission.email],
              ["Phone", data.submission.phone],
            ]
              .filter(([, value]) => Boolean(value))
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words">{value}</dd>
                </div>
              ))}
            {data.submission.fields.map((field) => (
              <div key={field.id}>
                <dt className="text-xs text-muted-foreground">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words">
                  {typeof field.value === "boolean"
                    ? field.value
                      ? "Yes"
                      : "No"
                    : field.value || "Not provided"}
                </dd>
              </div>
            ))}
          </>
        ) : null}
      </dl>
      {error ? (
        <p role="status" className="text-xs text-muted-foreground">
          Visitor details are temporarily unavailable.
        </p>
      ) : null}
    </section>
  );
}
export function MobileConversationDetails(props: {
  slug: string;
  conversationId: string;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 xl:hidden">
          Details
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Visitor details</SheetTitle>
        </SheetHeader>
        <ConversationEngagement {...props} />
        <ConversationFollowUp {...props} />
      </SheetContent>
    </Sheet>
  );
}
