import { PortalPageReady } from "@/components/dashboard/PortalPageReady";
import {
  Check,
  MessageSquareText,
  UsersRound,
  ContactRound,
} from "lucide-react";

export function InboxEmptyState() {
  return (
    <div
      className="bg-inbox-surface flex h-full min-h-0 flex-1 flex-col items-center justify-center px-8 text-center"
      data-testid="inbox-empty-selection"
    >
      <PortalPageReady />
      <div className="mill-inbox-empty-art" aria-hidden="true">
        <div className="mill-empty-note">
          <i />
          <i />
        </div>
        <div className="mill-empty-note">
          <i />
          <i />
        </div>
        <span className="mill-empty-icon">
          <Check className="size-4" />
        </span>
      </div>
      <p className="mb-3 text-[10px] font-semibold tracking-[.16em] text-brand">
        YOUR TEAM, CONNECTED
      </p>
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">
        Every conversation starts here.
      </h2>
      <p className="text-inbox-muted mt-3 max-w-xs text-sm leading-relaxed">
        Select a conversation to reply, bring in a teammate and see the person
        behind the message.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-3 text-[11px] text-inbox-muted">
        <span className="flex items-center gap-1.5">
          <MessageSquareText className="size-3.5" /> Reply
        </span>
        <span className="flex items-center gap-1.5">
          <UsersRound className="size-3.5" /> Collaborate
        </span>
        <span className="flex items-center gap-1.5">
          <ContactRound className="size-3.5" /> Customer context
        </span>
      </div>
    </div>
  );
}
