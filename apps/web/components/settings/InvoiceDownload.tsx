"use client";
import { useState } from "react";
export function InvoiceDownload({
  slug,
  invoiceId,
  adminWorkspaceId,
}: {
  slug: string;
  invoiceId: string;
  adminWorkspaceId?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return (
    <div>
      <button
        className="text-brand disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          void (async () => {
            setPending(true);
            setError(false);
            try {
              const response = await fetch(
                adminWorkspaceId
                  ? `/api/admin/customers/${encodeURIComponent(adminWorkspaceId)}/invoices/${encodeURIComponent(invoiceId)}`
                  : `/api/billing/${encodeURIComponent(slug)}/invoices/${encodeURIComponent(invoiceId)}`,
                { cache: "no-store" },
              );
              if (!response.ok) throw new Error();
              const url = URL.createObjectURL(await response.blob());
              const link = document.createElement("a");
              link.href = url;
              link.download = `${invoiceId}.pdf`;
              document.body.appendChild(link);
              link.click();
              link.remove();
              setTimeout(() => {
                URL.revokeObjectURL(url);
              }, 10000);
            } catch {
              setError(true);
            } finally {
              setPending(false);
            }
          })();
        }}
      >
        {pending ? "Downloading…" : "Download PDF"}
      </button>
      {error ? (
        <p role="status" className="mt-1 text-xs">
          Download failed. Please try again.
        </p>
      ) : null}
    </div>
  );
}
