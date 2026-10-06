"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminDebtEstimate,
  adminDebtConfirm,
} from "@/lib/platform-admin/debt-actions";
import { formatBillingAmount } from "@/lib/billing/format";
export function AdminDebtWriteOff({ workspaceId }: { workspaceId: string }) {
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState<Extract<
    Awaited<ReturnType<typeof adminDebtEstimate>>,
    { success: true }
  > | null>(null);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="font-semibold">Write off outstanding debt</h2>
      <p className="mt-2 text-sm text-[#747b80]">
        Clear unpaid invoices and restore services paused for debt. No card is
        charged. The subscription and next billing cycle continue as usual.
      </p>
      <label className="mt-4 block text-sm">
        Reason
        <textarea
          className="mt-2 w-full rounded-md border p-3"
          value={reason}
          maxLength={300}
          disabled={pending}
          onChange={(e) => {
            setReason(e.target.value);
            setQuote(null);
          }}
        />
      </label>
      {quote ? (
        <div className="mt-4 rounded-md border bg-[#f7f6f2] p-4">
          <p className="font-medium">
            The following balances will be written off:
          </p>
          <ul className="mt-2 space-y-1">
            {quote.invoices.map((i) => (
              <li key={i.id}>
                Invoice {i.id} · {formatBillingAmount(i.amount, i.currency)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm">
            This waives existing debt only. The next renewal will still be
            charged.
          </p>
        </div>
      ) : null}
      <button
        disabled={pending || reason.trim().length < 3}
        className="mt-4 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        onClick={() => {
          start(async () => {
            if (quote) {
              const result = await adminDebtConfirm(quote.token);
              setMessage(result.message);
              setQuote(null);
              router.refresh();
            } else {
              const result = await adminDebtEstimate({ workspaceId, reason });
              if (result.success) {
                setQuote(result);
                setMessage("");
              } else setMessage(result.message);
            }
          });
        }}
      >
        {pending
          ? "Processing…"
          : quote
            ? "Confirm write-off"
            : "Review outstanding debt"}
      </button>
      {message ? (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
