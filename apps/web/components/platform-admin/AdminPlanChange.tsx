"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MILL_PLANS,
  formatMillPrice,
  paidPlanChangeTiming,
  type MillPlanId,
  type BillingInterval,
} from "@/lib/billing/plans";
import {
  adminPlanEstimate,
  adminPlanConfirm,
} from "@/lib/platform-admin/billing-actions";
import { Button } from "@/components/ui/button";
export function AdminPlanChange({
  workspaceId,
  enabled,
  currentPlan,
  currentInterval,
}: {
  workspaceId: string;
  enabled: boolean;
  currentPlan: MillPlanId;
  currentInterval: BillingInterval;
}) {
  const [open, setOpen] = useState(false),
    [plan, setPlan] = useState<MillPlanId>("essential"),
    [interval, setInterval] = useState<BillingInterval>("month"),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState("");
  const [quote, setQuote] = useState<{
    token: string;
    estimate: {
      dueNow: number;
      credit: number;
      nextTotal: number | null;
      effectiveAt: number | null;
    };
  } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const timing = paidPlanChangeTiming(
    currentPlan,
    currentInterval,
    plan,
    interval,
  );
  const money = (v: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(v / 100);
  function reset() {
    setQuote(null);
    setMessage("");
  }
  return (
    <div className="mt-5 border-t pt-4">
      <Button
        variant="outline"
        disabled={!enabled || pending}
        onClick={() => {
          setOpen(!open);
        }}
      >
        Change paid plan
      </Button>
      {open && (
        <div className="mt-4 space-y-4 text-sm">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2 block">
              Plan
              <select
                aria-label="New paid plan"
                className="block w-full rounded border p-2"
                value={plan}
                disabled={pending}
                onChange={(e) => {
                  setPlan(e.target.value as MillPlanId);
                  reset();
                }}
              >
                {MILL_PLANS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ·{" "}
                    {formatMillPrice(
                      interval === "year"
                        ? p.monthlyPriceCents * 10
                        : p.monthlyPriceCents,
                    )}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 block">
              Billing interval
              <select
                aria-label="Paid billing interval"
                className="block w-full rounded border p-2"
                value={interval}
                disabled={pending}
                onChange={(e) => {
                  setInterval(e.target.value as BillingInterval);
                  reset();
                }}
              >
                <option value="month">Monthly</option>
                <option value="year">Yearly · 2 months free</option>
              </select>
            </label>
            <div className="space-y-2">
              <p>Effective date</p>
              <p className="rounded border bg-[#f7f9fc] p-2">
                {timing === "now"
                  ? "Immediately · prorated"
                  : "At next renewal"}
              </p>
            </div>
          </div>
          <p className="text-[#747b80]">
            This changes the customer&apos;s paid subscription. Immediate
            changes may charge the saved card. Switching between monthly and
            yearly billing can start a new billing period. Complimentary access
            remains independent.
          </p>
          <label className="block space-y-2">
            Reason
            <textarea
              aria-label="Paid plan change reason"
              className="block w-full rounded border p-2"
              rows={2}
              value={reason}
              disabled={pending}
              onChange={(e) => {
                setReason(e.target.value);
                reset();
              }}
              placeholder="Customer requested this change…"
            />
          </label>
          {quote ? (
            <div className="rounded-lg border bg-[#f7f9fc] p-4 space-y-2">
              <p className="font-semibold">Review billing change</p>
              <p>Due now: {money(quote.estimate.dueNow)}</p>
              <p>Credit generated: {money(quote.estimate.credit)}</p>
              {quote.estimate.nextTotal !== null && (
                <p>Next invoice estimate: {money(quote.estimate.nextTotal)}</p>
              )}
              <p>
                Effective:{" "}
                {quote.estimate.effectiveAt
                  ? new Date(quote.estimate.effectiveAt * 1000).toLocaleString(
                      "en-US",
                    )
                  : "Immediately"}
              </p>
              <p className="text-xs text-[#747b80]">
                Credits are applied through billing; they are not an automatic
                cash refund. This replaces any previously scheduled plan change.
              </p>
              <Button
                disabled={pending}
                onClick={() => {
                  start(async () => {
                    const r = await adminPlanConfirm(quote.token);
                    setMessage(r.message);
                    setQuote(null);
                    if (r.success) {
                      router.refresh();
                      setOpen(false);
                    }
                  });
                }}
              >
                Confirm paid plan change
              </Button>
            </div>
          ) : (
            <Button
              disabled={pending || reason.trim().length < 3}
              onClick={() => {
                start(async () => {
                  const r = await adminPlanEstimate({
                    workspaceId,
                    planId: plan,
                    interval,
                    timing,
                    reason,
                  });
                  if (r.success)
                    setQuote({ token: r.token, estimate: r.estimate });
                  else setMessage(r.message);
                });
              }}
            >
              {pending ? "Loading…" : "Review change"}
            </Button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
