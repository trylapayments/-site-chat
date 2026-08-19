import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        status === "open" && "bg-emerald-50 text-emerald-700",
        status === "pending" && "bg-amber-50 text-amber-800",
        status === "resolved" && "bg-sky-50 text-sky-800",
        status === "closed" && "bg-neutral-100 text-neutral-500",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "open" && "bg-emerald-500",
          status === "pending" && "bg-amber-500",
          status === "resolved" && "bg-sky-500",
          status === "closed" && "bg-neutral-400",
        )}
        aria-hidden="true"
      />
      {status}
    </span>
  );
}

export function ConversationHeader({
  contactLabel,
  conversationId,
  status,
  locationLabel,
  deviceLabel,
  pageTitle,
}: {
  contactLabel: string;
  conversationId: string;
  status: string;
  locationLabel: string | null;
  deviceLabel: string | null;
  pageTitle: string | null;
}) {
  const shortId = conversationId.slice(0, 8);

  return (
    <header className="border-inbox-border flex shrink-0 items-start justify-between gap-4 border-b bg-inbox-panel px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-neutral-900">
            {contactLabel}
          </h2>
          <StatusBadge status={status} />
          <span className="text-inbox-muted font-mono text-[11px] tabular-nums">
            #{shortId}
          </span>
        </div>
        <p className="text-inbox-muted mt-1 truncate text-[12px]">
          {[locationLabel, deviceLabel, pageTitle]
            .filter(Boolean)
            .join(" · ") || "No visitor context yet"}
        </p>
      </div>
    </header>
  );
}
