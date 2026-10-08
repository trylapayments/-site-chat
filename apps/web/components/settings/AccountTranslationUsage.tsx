import React from "react";
import { createClient } from "@/lib/supabase/server";
import { mobileTranslationCapabilities } from "@/lib/ai-translation/mobile";

/** Uses the same account allowance and fresh authorization as translation requests. */
export async function AccountTranslationUsage({
  workspaceId,
}: {
  workspaceId: string;
}) {
  let balance: Awaited<ReturnType<typeof mobileTranslationCapabilities>>;
  const now = new Date();
  const renewal = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Fail closed on malformed authentication responses.
    if (error || !data.user || !data.user.email_confirmed_at)
      throw new Error("Authentication required");
    balance = await mobileTranslationCapabilities(
      { client, user: data.user },
      workspaceId,
    );
  } catch {
    return (
      <section
        className="h-full rounded-xl border border-inbox-border bg-white p-6"
        aria-label="AI translation usage"
      >
        <h2 className="text-lg font-semibold">AI translations</h2>
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          Your AI balance could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }
  const used = Math.max(0, balance.monthlyLimit - balance.remaining);
  const percent =
    balance.monthlyLimit > 0
      ? Math.min(100, Math.round((used / balance.monthlyLimit) * 100))
      : 0;
  const low = balance.monthlyLimit > 0 && percent >= 80;
  return (
    <section
      className="h-full rounded-xl border border-inbox-border bg-white p-6"
      aria-label="AI translation usage"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">AI translations</h2>
        <span className="text-xs text-muted-foreground">
          Shared account allowance
        </span>
      </div>
      {balance.monthlyLimit > 0 ? (
        <>
          <p className="mt-4 text-3xl font-semibold tabular-nums">
            {balance.remaining.toLocaleString("en-US")}{" "}
            <span className="text-base font-normal text-muted-foreground">
              translations remaining
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {used.toLocaleString("en-US")} of{" "}
            {balance.monthlyLimit.toLocaleString("en-US")} used this month
          </p>
          <div
            role="progressbar"
            aria-label="Monthly translation allowance used"
            aria-valuemin={0}
            aria-valuemax={balance.monthlyLimit}
            aria-valuenow={used}
            className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-100"
          >
            <div
              className={
                low
                  ? "h-full rounded-full bg-amber-500"
                  : "h-full rounded-full bg-brand"
              }
              style={{ width: `${String(percent)}%` }}
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Renews{" "}
            {renewal.toLocaleDateString("en-US", {
              timeZone: "UTC",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}{" "}
            · UTC
          </p>
          {low && (
            <p role="status" className="mt-3 text-sm text-amber-700">
              {balance.remaining === 0
                ? "Your translation allowance is used up. You can keep chatting without translation."
                : "Your translation allowance is running low."}
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          AI translation is not enabled or included for this account.
        </p>
      )}
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        All companies and operators belonging to the subscription owner share
        this allowance. Switching companies does not reset your balance.
      </p>
    </section>
  );
}
