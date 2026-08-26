"use client";

import type { ReactNode } from "react";
import {
  canChangeMemberRole,
  canDeactivateMember,
  canRemoveMember,
  canRevokeInvitation,
  interpolateTeamCount,
  memberActionBlockReason,
  roleOptionsForMember,
  teamMemberDisplayName,
  teamMemberInitials,
  teamMessagesEn,
  type MemberRole,
  type TeamInvitation,
  type TeamMember,
} from "@site-chat/shared";
import { useState } from "react";

import { ConfirmDialog } from "@/components/dashboard/actions/ConfirmDialog";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { formatTeamDate, roleLabel } from "@/components/team/team-format";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const messages = teamMessagesEn;

function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-inbox-muted text-[12px]">{label}</p>
      <div className="mt-0.5 text-[13px] font-medium text-neutral-800">
        {value}
      </div>
    </div>
  );
}

function assignedLabel(count: number): string {
  if (count <= 0) {
    return messages.assignedNone;
  }
  if (count === 1) {
    return messages.assignedOne;
  }
  return interpolateTeamCount(messages.assignedMany, count);
}

function blockCopy(
  reason: ReturnType<typeof memberActionBlockReason>,
): string | null {
  switch (reason) {
    case "self":
      return messages.selfActionBlocked;
    case "last_owner":
      return messages.lastOwnerBlocked;
    case "owner_protected":
      return messages.ownerProtected;
    case "deactivated":
      return messages.deactivatedRoleBlocked;
    case "forbidden":
      return messages.permissionDenied;
    default:
      return null;
  }
}

export function TeamMemberSheet({
  open,
  onOpenChange,
  member,
  invitation,
  callerRole,
  callerMemberId,
  activeOwnerCount,
  isSelf,
  onChangeRole,
  onDeactivate,
  onRemove,
  onRevoke,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember | null;
  invitation: TeamInvitation | null;
  callerRole: MemberRole;
  callerMemberId: string;
  activeOwnerCount: number;
  isSelf: boolean;
  onChangeRole: (memberId: string, role: MemberRole) => Promise<boolean>;
  onDeactivate: (memberId: string) => Promise<boolean>;
  onRemove: (memberId: string) => Promise<boolean>;
  onRevoke: (invitationId: string) => Promise<boolean>;
  busy: boolean;
  error: string | null;
}) {
  const [confirm, setConfirm] = useState<
    "deactivate" | "remove" | "revoke" | null
  >(null);

  const email = member?.email ?? invitation?.email ?? "";
  const name = teamMemberDisplayName(email);
  const roleOptions = member
    ? roleOptionsForMember({
        callerRole,
        target: member,
        callerMemberId,
        activeOwnerCount,
      })
    : [];
  const canRole = member
    ? canChangeMemberRole({
        callerRole,
        target: member,
        callerMemberId,
        activeOwnerCount,
      })
    : false;
  const canDeactivate = member
    ? canDeactivateMember({
        callerRole,
        target: member,
        callerMemberId,
        activeOwnerCount,
      })
    : false;
  const canRemove = member
    ? canRemoveMember({
        callerRole,
        target: member,
        callerMemberId,
        activeOwnerCount,
      })
    : false;
  const notice = member
    ? blockCopy(
        memberActionBlockReason({
          callerRole,
          target: member,
          callerMemberId,
          activeOwnerCount,
        }),
      )
    : null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="bg-inbox-surface border-inbox-border w-full sm:max-w-md"
          data-testid="team-member-sheet"
        >
          <SheetHeader className="border-inbox-border/70 border-b px-6 py-5">
            <div className="flex items-start gap-3">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-full bg-neutral-200/80 text-[12px] font-semibold text-neutral-600"
                aria-hidden="true"
              >
                {teamMemberInitials(name)}
              </div>
              <div className="min-w-0">
                <SheetTitle className="truncate text-[16px] tracking-tight">
                  {name}
                  {isSelf ? (
                    <span className="text-inbox-muted ml-2 text-[12px] font-medium">
                      {messages.youLabel}
                    </span>
                  ) : null}
                </SheetTitle>
                <SheetDescription className="text-inbox-muted mt-0.5 truncate text-[13px]">
                  {email || "—"}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="space-y-5 px-6 py-5">
            {member ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem
                    label={messages.detailRole}
                    value={
                      canRole ? (
                        <select
                          aria-label={messages.changeRole}
                          className="border-inbox-border bg-inbox-surface focus-visible:ring-ring h-8 w-full rounded-md border px-2 text-[13px] shadow-none focus-visible:ring-1 focus-visible:outline-none"
                          value={member.role}
                          disabled={busy}
                          onChange={(event) => {
                            void onChangeRole(
                              member.member_id,
                              event.target.value as MemberRole,
                            );
                          }}
                        >
                          {roleOptions.map((option) => (
                            <option key={option} value={option}>
                              {roleLabel(option)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        roleLabel(member.role)
                      )
                    }
                  />
                  <DetailItem
                    label={messages.detailStatus}
                    value={<TeamStatusBadge status={member.status} />}
                  />
                  <DetailItem
                    label={messages.detailJoined}
                    value={formatTeamDate(member.joined_at)}
                  />
                  <DetailItem
                    label={messages.detailAssigned}
                    value={assignedLabel(member.assigned_conversation_count)}
                  />
                </div>
                {notice && !canRole && !canDeactivate && !canRemove ? (
                  <p className="text-inbox-muted text-[13px] leading-relaxed">
                    {notice}
                  </p>
                ) : null}
                {error ? (
                  <p className="text-destructive text-[13px]" role="alert">
                    {error}
                  </p>
                ) : null}
                {canDeactivate || canRemove ? (
                  <div className="flex flex-wrap gap-2">
                    {canDeactivate ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-inbox-border h-8 text-[13px]"
                        disabled={busy}
                        onClick={() => {
                          setConfirm("deactivate");
                        }}
                      >
                        {messages.deactivate}
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 h-8 text-[13px]"
                        disabled={busy}
                        onClick={() => {
                          setConfirm("remove");
                        }}
                      >
                        {messages.remove}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : invitation ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem
                    label={messages.detailRole}
                    value={roleLabel(invitation.role)}
                  />
                  <DetailItem
                    label={messages.detailStatus}
                    value={<TeamStatusBadge status="invited" />}
                  />
                  <DetailItem
                    label={messages.detailInvited}
                    value={formatTeamDate(invitation.created_at)}
                  />
                  <DetailItem
                    label={messages.detailExpires}
                    value={formatTeamDate(invitation.expires_at)}
                  />
                </div>
                {error ? (
                  <p className="text-destructive text-[13px]" role="alert">
                    {error}
                  </p>
                ) : null}
                {canRevokeInvitation(callerRole) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-inbox-border h-8 text-[13px]"
                    disabled={busy}
                    onClick={() => {
                      setConfirm("revoke");
                    }}
                  >
                    {messages.revokeInvite}
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={confirm === "deactivate"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.deactivateTitle}
        description={messages.deactivateDescription}
        confirmLabel={messages.deactivateConfirm}
        variant="destructive"
        loading={busy}
        onConfirm={async () => {
          if (!member) {
            return;
          }
          const ok = await onDeactivate(member.member_id);
          if (ok) {
            setConfirm(null);
            onOpenChange(false);
          } else {
            throw new Error("deactivate failed");
          }
        }}
      />
      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.removeTitle}
        description={messages.removeDescription}
        confirmLabel={messages.removeConfirm}
        variant="destructive"
        loading={busy}
        onConfirm={async () => {
          if (!member) {
            return;
          }
          const ok = await onRemove(member.member_id);
          if (ok) {
            setConfirm(null);
            onOpenChange(false);
          } else {
            throw new Error("remove failed");
          }
        }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(next) => {
          if (!next) {
            setConfirm(null);
          }
        }}
        title={messages.revokeTitle}
        description={messages.revokeDescription}
        confirmLabel={messages.revokeConfirm}
        variant="destructive"
        loading={busy}
        onConfirm={async () => {
          if (!invitation) {
            return;
          }
          const ok = await onRevoke(invitation.invitation_id);
          if (ok) {
            setConfirm(null);
            onOpenChange(false);
          } else {
            throw new Error("revoke failed");
          }
        }}
      />
    </>
  );
}
