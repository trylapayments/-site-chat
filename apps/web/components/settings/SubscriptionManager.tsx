"use client";

import { MILL_AI_ALLOWANCES } from "@/lib/billing/features";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MILL_PLANS,
  paidPlanChangeTiming,
  formatMillPrice,
  type BillingInterval,
  type MillPlanId,
} from "@/lib/billing/plans";
import { subscriptionAction } from "@/lib/billing/subscription-actions";
import {
  customerPlanEstimate,
  customerPlanConfirm,
} from "@/lib/billing/customer-plan-actions";
import { Button } from "@/components/ui/button";
export function SubscriptionManager({
  slug,
  enabled,
  hasCard,
  subscriptionStatus,
  initialPlan = "essential",
  initialInterval = "month",
}: {
  slug: string;
  enabled: boolean;
  hasCard: boolean;
  subscriptionStatus: string | null;
  initialPlan?: MillPlanId;
  initialInterval?: BillingInterval;
}) {
  const [interval, setInterval] = useState<BillingInterval>(initialInterval);
  const [plan, setPlan] = useState<MillPlanId>(initialPlan);
  const [quote, setQuote] = useState<Extract<
    Awaited<ReturnType<typeof customerPlanEstimate>>,
    { success: true }
  > | null>(null);
  const timing = paidPlanChangeTiming(
    initialPlan,
    initialInterval,
    plan,
    interval,
  );
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const subscribed = Boolean(subscriptionStatus);
  function submit(operation: "subscribe" | "change" | "cancel" | "resume") {
    startTransition(async () => {
      if (operation === "change") {
        if (!quote) {
          const result = await customerPlanEstimate({
            slug,
            planId: plan,
            interval,
            timing,
          });
          if (result.success) setQuote(result);
          else setMessage(result.message);
          return;
        }
        const result = await customerPlanConfirm(slug, quote.token);
        setMessage(result.message);
        setQuote(null);
        setConsent(false);
        if (result.success) router.refresh();
        return;
      }
      const result = await subscriptionAction(slug, {
        operation,
        planId: plan,
        interval,
        consent: true,
      });
      setMessage(result.message);
      if (result.success) {
        setConsent(false);
        router.refresh();
      }
    });
  }
  return (
    <section className="mill-plan-selector rounded-xl border border-inbox-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-semibold">Choose your Mill plan</h2>
        <div
          className="flex rounded-md border p-1"
          aria-label="Billing interval"
        >
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={interval === value}
              disabled={pending}
              onClick={() => {
                setInterval(value);
                setQuote(null);
                setConsent(false);
              }}
              className={`rounded px-3 py-2 text-sm ${interval === value ? "bg-[#edf3fc] font-semibold text-[#1763de]" : "text-muted-foreground"}`}
            >
              {value === "year" ? "Yearly · 2 months free" : "Monthly"}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MILL_PLANS.map((p) => (
          <label
            key={p.id}
            className={`mill-plan-option cursor-pointer rounded-lg border p-4 ${plan === p.id ? "border-[#1763de] bg-[#f7f9fd]" : ""}`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="mill-plan"
                value={p.id}
                checked={plan === p.id}
                disabled={pending}
                onChange={() => {
                  setPlan(p.id);
                  setQuote(null);
                  setConsent(false);
                }}
              />
              <span className="font-semibold">{p.name}</span>
            </span>
            <p className="mt-3 text-xl font-semibold">
              {formatMillPrice(
                p.monthlyPriceCents * (interval === "year" ? 10 : 1),
              )}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}
                / {interval}
              </span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {p.operators} operators · {p.sites}{" "}
              {p.sites === 1 ? "website" : "websites"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {p.removeBranding ? "Remove Mill branding" : "Powered by Mill"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {MILL_AI_ALLOWANCES[p.id] > 0
                ? `${MILL_AI_ALLOWANCES[p.id].toLocaleString()} AI conversations / month`
                : "AI conversations not included"}
            </p>
          </label>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        USD · taxes excluded. Annual plans are charged once per year. Included
        AI conversation allowances renew monthly on both billing intervals.
      </p>
      {!enabled ? (
        <p className="mt-4 text-sm">
          Payments are being prepared. Your existing access is unchanged.
        </p>
      ) : !hasCard && !subscribed ? (
        <p className="mt-4 text-sm">
          Add a payment method below before starting a subscription.
        </p>
      ) : null}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          disabled={!enabled || pending}
          onChange={(e) => {
            setConsent(e.target.checked);
          }}
        />
        {subscribed
          ? timing === "now"
            ? "I agree to upgrade now with a prorated charge to my payment method, after reviewing the calculation."
            : "I agree to apply this change at my next renewal."
          : "I agree to pay for the selected plan now and renew automatically until cancelled."}
      </label>
      {quote ? (
        <div
          role="status"
          className="mt-4 rounded-lg border bg-[#f7f6f2] p-4 text-sm space-y-2"
        >
          <p className="font-semibold">Review your plan change</p>
          <p>Due now: {formatMillPrice(quote.estimate.dueNow)}</p>
          {quote.estimate.credit > 0 ? (
            <p>
              Credit for unused time: {formatMillPrice(quote.estimate.credit)}{" "}
              (applied to billing; not a cash refund)
            </p>
          ) : null}
          {quote.estimate.nextTotal !== null ? (
            <p>Next invoice: {formatMillPrice(quote.estimate.nextTotal)}</p>
          ) : null}
          <p>
            Effective:{" "}
            {quote.estimate.effectiveAt
              ? new Date(quote.estimate.effectiveAt * 1000).toLocaleDateString(
                  "en-US",
                )
              : "Immediately"}
          </p>
          <p className="text-muted-foreground">
            This replaces any previously scheduled change. Switching billing
            intervals may start a new billing period.
          </p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          disabled={
            !enabled ||
            pending ||
            !consent ||
            (!hasCard && !subscribed) ||
            subscriptionStatus === "non_renewing"
          }
          onClick={() => {
            submit(subscribed ? "change" : "subscribe");
          }}
        >
          {pending
            ? "Updating…"
            : subscribed
              ? quote
                ? "Confirm plan change"
                : "Review plan change"
              : "Start subscription"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
