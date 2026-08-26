"use client";

import {
  canChangeMemberRole,
  canDeactivateMember,
  canManageWorkspaceMembers,
  canRemoveMember,
  interpolateTeamCount,
  roleOptionsForMember,
  teamMemberDisplayName,
  teamMemberInitials,
  teamMessagesEn,
  type MemberRole,
  type TeamInvitation,
  type TeamMember,
  type TeamTableRow,
} from "@site-chat/shared";
import { MoreHorizontal } from "lucide-react";

import { ActionMenu } from "@/components/dashboard/actions/ActionMenu";
import { TeamStatusBadge } from "@/components/team/TeamStatusBadge";
import { formatTeamDate, roleLabel } from "@/components/team/team-format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const messages = teamMessagesEn;

function assignedLabel(count: number): string {
  if (count <= 0) {
    return "—";
  }
  return interpolateTeamCount(
    count === 1 ? messages.assignedOne : messages.assignedMany,
    count,
  );
}

export function TeamTable({
  rows,
  callerRole,
  callerMemberId,
  activeOwnerCount,
  onOpenMember,
  onOpenInvitation,
  onChangeRole,
  onDeactivate,
  onRemove,
  onRevoke,
  busyMemberId,
}: {
  rows: TeamTableRow[];
  callerRole: MemberRole;
  callerMemberId: string;
  activeOwnerCount: number;
  onOpenMember: (member: TeamMember) => void;
  onOpenInvitation: (invitation: TeamInvitation) => void;
  onChangeRole: (memberId: string, role: MemberRole) => void;
  onDeactivate: (member: TeamMember) => void;
  onRemove: (member: TeamMember) => void;
  onRevoke: (invitation: TeamInvitation) => void;
  busyMemberId: string | null;
}) {
  const canManage = canManageWorkspaceMembers(callerRole);

  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="team-table">
      <table className="w-full border-collapse text-left" aria-label="Team">
        <thead className="bg-inbox-panel sticky top-0 z-10">
          <tr className="border-inbox-border/70 text-inbox-muted border-b text-[11px] font-medium tracking-wide uppercase">
            <th scope="col" className="px-4 py-2.5 font-medium">
              {messages.columnMember}
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium lg:table-cell"
            >
              {messages.columnEmail}
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              {messages.columnRole}
            </th>
            <th scope="col" className="px-3 py-2.5 font-medium">
              {messages.columnStatus}
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium md:table-cell"
            >
              {messages.columnAssigned}
            </th>
            <th
              scope="col"
              className="hidden px-3 py-2.5 font-medium md:table-cell"
            >
              {messages.columnJoined}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-medium">
              <span className="sr-only">{messages.columnActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "invitation") {
              const invitation = row.invitation;
              const name = teamMemberDisplayName(invitation.email);
              return (
                <tr
                  key={row.id}
                  data-testid={`team-row-invite-${invitation.invitation_id}`}
                  className="border-inbox-border/50 hover:bg-inbox-hover border-b last:border-b-0"
                >
                  <th scope="row" className="px-4 py-3 font-normal">
                    <button
                      type="button"
                      className="flex min-w-0 items-center gap-3 text-left"
                      onClick={() => {
                        onOpenInvitation(invitation);
                      }}
                    >
                      <span
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand"
                        aria-hidden="true"
                      >
                        {teamMemberInitials(name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium text-neutral-800">
                          {name}
                        </span>
                        <span className="text-inbox-muted mt-0.5 block truncate text-[12px] lg:hidden">
                          {invitation.email}
                        </span>
                      </span>
                    </button>
                  </th>
                  <td className="text-inbox-muted hidden max-w-[240px] truncate px-3 py-3 text-[13px] lg:table-cell">
                    {invitation.email}
                  </td>
                  <td className="px-3 py-3 text-[13px] text-neutral-800">
                    {roleLabel(invitation.role)}
                  </td>
                  <td className="px-3 py-3">
                    <TeamStatusBadge status="invited" />
                  </td>
                  <td className="text-inbox-muted hidden px-3 py-3 text-[13px] md:table-cell">
                    —
                  </td>
                  <td className="text-inbox-muted hidden px-3 py-3 text-[13px] md:table-cell">
                    {formatTeamDate(invitation.created_at)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {canManage ? (
                      <ActionMenu
                        label={`Actions for ${invitation.email}`}
                        items={[
                          {
                            key: "view",
                            label: messages.viewMember,
                            onSelect: () => {
                              onOpenInvitation(invitation);
                            },
                          },
                          {
                            key: "revoke",
                            label: messages.revokeInvite,
                            destructive: true,
                            separatorBefore: true,
                            onSelect: () => {
                              onRevoke(invitation);
                            },
                          },
                        ]}
                      />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={messages.viewMember}
                        onClick={() => {
                          onOpenInvitation(invitation);
                        }}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            }

            const member = row.member;
            const name = teamMemberDisplayName(member.email);
            const isSelf = member.member_id === callerMemberId;
            const roleOptions = roleOptionsForMember({
              callerRole,
              target: member,
              callerMemberId,
              activeOwnerCount,
            });
            const canRole = canChangeMemberRole({
              callerRole,
              target: member,
              callerMemberId,
              activeOwnerCount,
            });
            const busy = busyMemberId === member.member_id;

            return (
              <tr
                key={row.id}
                data-testid={`team-row-member-${member.member_id}`}
                className={cn(
                  "border-inbox-border/50 hover:bg-inbox-hover border-b last:border-b-0",
                  member.status === "deactivated" && "opacity-80",
                )}
              >
                <th scope="row" className="px-4 py-3 font-normal">
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-3 text-left"
                    onClick={() => {
                      onOpenMember(member);
                    }}
                  >
                    <span
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-200/80 text-[11px] font-semibold text-neutral-600"
                      aria-hidden="true"
                    >
                      {teamMemberInitials(name)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14px] font-medium text-neutral-800">
                          {name}
                        </span>
                        {isSelf ? (
                          <span className="text-inbox-muted shrink-0 text-[11px] font-medium">
                            {messages.youLabel}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-inbox-muted mt-0.5 block truncate text-[12px] lg:hidden">
                        {member.email}
                      </span>
                    </span>
                  </button>
                </th>
                <td className="text-inbox-muted hidden max-w-[240px] truncate px-3 py-3 text-[13px] lg:table-cell">
                  {member.email}
                </td>
                <td className="px-3 py-3">
                  {canRole ? (
                    <select
                      aria-label={`${messages.changeRole} for ${member.email}`}
                      data-testid={`team-role-${member.member_id}`}
                      className="border-inbox-border bg-inbox-surface focus-visible:ring-ring h-8 max-w-[140px] rounded-md border px-2 text-[13px] shadow-none focus-visible:ring-1 focus-visible:outline-none"
                      value={member.role}
                      disabled={busy}
                      onChange={(event) => {
                        onChangeRole(
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
                    <span className="text-[13px] text-neutral-800">
                      {roleLabel(member.role)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <TeamStatusBadge status={member.status} />
                </td>
                <td className="text-inbox-muted hidden px-3 py-3 text-[13px] md:table-cell">
                  {assignedLabel(member.assigned_conversation_count)}
                </td>
                <td className="text-inbox-muted hidden px-3 py-3 text-[13px] md:table-cell">
                  {formatTeamDate(member.joined_at)}
                </td>
                <td className="px-3 py-3 text-right">
                  <ActionMenu
                    label={`Actions for ${member.email}`}
                    items={[
                      {
                        key: "view",
                        label: messages.viewMember,
                        onSelect: () => {
                          onOpenMember(member);
                        },
                      },
                      {
                        key: "deactivate",
                        label: messages.deactivate,
                        hidden: !canDeactivateMember({
                          callerRole,
                          target: member,
                          callerMemberId,
                          activeOwnerCount,
                        }),
                        separatorBefore: true,
                        onSelect: () => {
                          onDeactivate(member);
                        },
                      },
                      {
                        key: "remove",
                        label: messages.remove,
                        destructive: true,
                        hidden: !canRemoveMember({
                          callerRole,
                          target: member,
                          callerMemberId,
                          activeOwnerCount,
                        }),
                        separatorBefore: !canDeactivateMember({
                          callerRole,
                          target: member,
                          callerMemberId,
                          activeOwnerCount,
                        }),
                        onSelect: () => {
                          onRemove(member);
                        },
                      },
                    ]}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
