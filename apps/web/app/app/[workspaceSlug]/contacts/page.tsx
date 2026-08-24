import { Users } from "lucide-react";

export default function ContactsPage() {
  return (
    <div
      className="bg-inbox-surface flex h-full min-h-0 flex-1 flex-col items-center justify-center px-8 text-center"
      data-testid="contacts-empty-selection"
    >
      <div className="bg-brand-soft text-brand mb-4 flex size-14 items-center justify-center rounded-2xl">
        <Users className="size-7" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-neutral-900">
        Select a contact
      </h2>
      <p className="text-inbox-muted mt-1.5 max-w-sm text-sm leading-relaxed">
        Choose a customer from the list to review identity, CRM fields, recent
        conversations, and activity.
      </p>
    </div>
  );
}
