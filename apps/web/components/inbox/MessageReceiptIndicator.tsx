"use client";

import type { MessageReceiptStatus } from "@site-chat/shared";

/**
 * Accessible sent → delivered → seen ticks for the local party's messages.
 */
export function MessageReceiptIndicator({
  status,
  testId,
}: {
  status: MessageReceiptStatus;
  testId?: string;
}) {
  const label =
    status === "seen" ? "Seen" : status === "delivered" ? "Delivered" : "Sent";

  return (
    <span
      className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-xs"
      data-testid={testId ?? "message-receipt"}
      data-receipt={status}
      aria-label={label}
      title={label}
    >
      <ReceiptGlyph status={status} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function ReceiptGlyph({ status }: { status: MessageReceiptStatus }) {
  if (status === "seen") {
    return (
      <span aria-hidden="true" className="text-sky-600 tracking-tighter">
        ✓✓
      </span>
    );
  }

  if (status === "delivered") {
    return (
      <span aria-hidden="true" className="tracking-tighter">
        ✓✓
      </span>
    );
  }

  return (
    <span aria-hidden="true" className="tracking-tighter">
      ✓
    </span>
  );
}
