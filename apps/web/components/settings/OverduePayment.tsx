"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryInvoicePayment } from "@/lib/billing/recovery-actions";
import { formatBillingAmount } from "@/lib/billing/format";
export function OverduePayment({
  slug,
  invoiceId,
  amount,
  currency,
  version,
}: {
  slug: string;
  invoiceId: string;
  amount: number;
  currency: string;
  version: number;
}) {
  const [consent, setConsent] = useState(false),
    [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="mt-4 space-y-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={consent}
          disabled={pending}
          onChange={(e) => {
            setConsent(e.target.checked);
          }}
          className="mt-1"
        />
        I authorise Mill to charge {formatBillingAmount(amount, currency)} to my
        default payment method now for invoice {invoiceId}.
      </label>
      <button
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        disabled={!consent || pending}
        onClick={() => {
          start(async () => {
            const result = await retryInvoicePayment({
              slug,
              invoiceId,
              amount,
              version,
            });
            setMessage(result.message);
            setConsent(false);
            router.refresh();
          });
        }}
      >
        {pending ? "Processing payment…" : "Pay outstanding invoice"}
      </button>
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </div>
  );
}
