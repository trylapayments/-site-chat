"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { subscriptionAction } from "@/lib/billing/subscription-actions";
export function CancelPlan({
  slug,
  enabled,
  status,
  periodEnd,
}: {
  slug: string;
  enabled: boolean;
  status: string | null;
  periodEnd: number | null;
}) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const cancelled = status === "non_renewing";
  if (!status || !["active", "trialing", "non_renewing"].includes(status))
    return null;
  const end = periodEnd
    ? new Date(periodEnd * 1000).toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : null;
  function submit() {
    startTransition(async () => {
      const result = await subscriptionAction(slug, {
        operation: cancelled ? "resume" : "cancel",
        consent: true,
      });
      setMessage(result.message);
      if (result.success) {
        setConfirm(false);
        router.refresh();
      }
    });
  }
  return (
    <section
      className="rounded-xl border border-inbox-border bg-white p-6"
      aria-label="Automatic renewal"
    >
      <h2 className="font-semibold">
        {cancelled ? "Renewal cancelled" : "Cancel plan"}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {cancelled
          ? "Your plan will not renew automatically."
          : "Stop automatic renewal and keep your access until the end of the current billing period."}
      </p>
      <p className="mt-2 text-sm">
        {end
          ? `Paid access ends: ${end}.`
          : "The billing period end is unavailable. Refresh Billing before cancelling."}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {cancelled
          ? "No renewal charge will be made unless you resume renewal."
          : "Cancellation stops future renewal charges. It does not refund the current period or remove outstanding invoices."}
      </p>
      {confirm ? (
        <div
          role="group"
          aria-label="Confirm subscription change"
          className="mt-4 rounded-lg border p-4"
        >
          <p className="text-sm font-medium">
            {cancelled
              ? "Resume automatic renewal at your existing price?"
              : `Cancel automatic renewal? Your access continues until ${end ?? "the end of your billing period"}.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button disabled={pending} onClick={submit}>
              {pending
                ? "Updating…"
                : cancelled
                  ? "Confirm resume"
                  : "Confirm cancellation"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                setConfirm(false);
              }}
            >
              Keep current setting
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="mt-4"
          variant="outline"
          disabled={!enabled || pending || !periodEnd}
          onClick={() => {
            setConfirm(true);
          }}
        >
          {cancelled ? "Resume renewal" : "Cancel Plan"}
        </Button>
      )}
      {message ? (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
