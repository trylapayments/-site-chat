import { Inbox } from "lucide-react";

export default function InboxPage() {
  return (
    <div
      className="bg-inbox-surface flex h-full min-h-0 flex-1 flex-col items-center justify-center px-8 text-center"
      data-testid="inbox-empty-selection"
    >
      <div className="bg-brand-soft text-brand mb-4 flex size-14 items-center justify-center rounded-2xl">
        <Inbox className="size-7" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-neutral-900">
        Select a conversation
      </h2>
      <p className="text-inbox-muted mt-1.5 max-w-sm text-sm leading-relaxed">
        Choose a conversation from the queue to reply, assign, and review
        customer context — without leaving your inbox.
      </p>
    </div>
  );
}
