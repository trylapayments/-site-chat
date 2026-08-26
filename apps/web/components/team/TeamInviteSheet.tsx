"use client";

import {
  inviteRolesFor,
  teamMessagesEn,
  type InviteRole,
  type MemberRole,
} from "@site-chat/shared";
import { useEffect, useId, useRef, useState, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { inviteWorkspaceMemberAction } from "@/lib/team/actions";
import { roleLabel } from "@/components/team/team-format";

const messages = teamMessagesEn;

export function TeamInviteSheet({
  open,
  onOpenChange,
  workspaceSlug,
  callerRole,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceSlug: string;
  callerRole: MemberRole;
  onInvited: () => void;
}) {
  const roles = inviteRolesFor(callerRole);
  const emailId = useId();
  const roleId = useId();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("agent");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setEmail("");
    setRole("agent");
    setPending(false);
    setError(null);
    setInviteUrl(null);
    setCopied(false);
    const frame = window.requestAnimationFrame(() => {
      emailRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    setCopied(false);
    const result = await inviteWorkspaceMemberAction(workspaceSlug, {
      email,
      role,
    });
    setPending(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    setInviteUrl(result.data.invite_url);
    onInvited();
  }

  async function handleCopy() {
    if (!inviteUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("Unable to copy the invite link.");
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-inbox-surface border-inbox-border w-full sm:max-w-md"
        data-testid="team-invite-sheet"
      >
        <SheetHeader className="border-inbox-border/70 border-b px-6 py-5">
          <SheetTitle className="text-[16px] tracking-tight">
            {messages.inviteTitle}
          </SheetTitle>
          <SheetDescription className="text-inbox-muted text-[13px]">
            {messages.inviteDescription}
          </SheetDescription>
        </SheetHeader>

        {inviteUrl ? (
          <div className="space-y-4 px-6 py-5">
            <p className="text-[13px] font-medium text-neutral-900">
              {messages.invitePendingLabel}
            </p>
            <p className="text-inbox-muted text-[13px] leading-relaxed">
              {messages.inviteLinkHint}
            </p>
            <p className="border-inbox-border bg-inbox-panel truncate rounded-md border px-3 py-2 text-[13px]">
              {inviteUrl}
            </p>
            <Button
              type="button"
              size="sm"
              className="bg-brand text-brand-foreground hover:bg-brand/90 h-8"
              onClick={() => {
                void handleCopy();
              }}
            >
              {copied ? messages.inviteCopied : messages.inviteCopyLink}
            </Button>
          </div>
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
            data-testid="team-invite-form"
          >
            <div className="space-y-4 px-6 py-5">
              <div className="space-y-1.5">
                <Label htmlFor={emailId} className="text-[13px]">
                  {messages.inviteEmailLabel}
                </Label>
                <Input
                  ref={emailRef}
                  id={emailId}
                  type="email"
                  autoComplete="off"
                  required
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                  }}
                  placeholder={messages.inviteEmailPlaceholder}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="border-inbox-border h-9 text-[13px] shadow-none"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={roleId} className="text-[13px]">
                  {messages.inviteRoleLabel}
                </Label>
                <select
                  id={roleId}
                  value={role}
                  onChange={(event) => {
                    setRole(event.target.value as InviteRole);
                  }}
                  className="border-inbox-border bg-inbox-surface focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-[13px] shadow-none focus-visible:ring-1 focus-visible:outline-none"
                >
                  {roles.map((option) => (
                    <option key={option} value={option}>
                      {roleLabel(option)}
                    </option>
                  ))}
                </select>
              </div>
              {error ? (
                <p
                  id={errorId}
                  className="text-destructive text-[13px]"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
            </div>
            <SheetFooter className="border-inbox-border/70 mt-auto border-t px-6 py-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-inbox-border h-8"
                onClick={() => {
                  onOpenChange(false);
                }}
              >
                {messages.inviteCancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-brand text-brand-foreground hover:bg-brand/90 h-8"
                disabled={pending || roles.length === 0}
              >
                {pending ? "Creating…" : messages.inviteSubmit}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
