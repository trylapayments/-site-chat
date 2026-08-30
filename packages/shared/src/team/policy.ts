import { can } from "../permissions/can.js";
import type { MemberRole } from "../schemas/workspace.js";
import type { InviteRole, TeamInvitation, TeamMember } from "../schemas/team.js";

export const INVITE_ROLES: readonly InviteRole[] = ["admin", "agent", "viewer"];

export const ALL_MEMBER_ROLES: readonly MemberRole[] = ["owner", "admin", "agent", "viewer"];

export type TeamRowKind = "member" | "invitation";

export type TeamTableRow =
  | {
      kind: "member";
      id: string;
      member: TeamMember;
    }
  | {
      kind: "invitation";
      id: string;
      invitation: TeamInvitation;
    };

export function canViewWorkspaceMembers(role: MemberRole): boolean {
  return can(role, "view_workspace_members");
}

export function canManageWorkspaceMembers(role: MemberRole): boolean {
  return can(role, "manage_workspace_members");
}

export function canViewInvitations(role: MemberRole): boolean {
  return canManageWorkspaceMembers(role);
}

export function inviteRolesFor(callerRole: MemberRole): readonly InviteRole[] {
  return canManageWorkspaceMembers(callerRole) ? INVITE_ROLES : [];
}

export function countActiveOwners(members: readonly TeamMember[]): number {
  return members.filter((member) => member.role === "owner" && member.status === "active").length;
}

export function isLastActiveOwner(
  member: Pick<TeamMember, "role" | "status" | "member_id">,
  activeOwnerCount: number,
): boolean {
  return member.role === "owner" && member.status === "active" && activeOwnerCount <= 1;
}

export function roleOptionsForMember(input: {
  callerRole: MemberRole;
  target: Pick<TeamMember, "role" | "status" | "member_id">;
  callerMemberId: string;
  activeOwnerCount: number;
}): readonly MemberRole[] {
  const { callerRole, target, callerMemberId, activeOwnerCount } = input;

  if (!canManageWorkspaceMembers(callerRole)) {
    return [];
  }
  if (target.status !== "active") {
    return [];
  }
  if (target.member_id === callerMemberId) {
    return [];
  }
  if (target.role === "owner" && callerRole !== "owner") {
    return [];
  }
  if (isLastActiveOwner(target, activeOwnerCount)) {
    return ["owner"];
  }
  if (callerRole === "owner") {
    return ALL_MEMBER_ROLES;
  }
  return ["admin", "agent", "viewer"];
}

export function canChangeMemberRole(input: {
  callerRole: MemberRole;
  target: Pick<TeamMember, "role" | "status" | "member_id">;
  callerMemberId: string;
  activeOwnerCount: number;
}): boolean {
  return roleOptionsForMember(input).some((role) => role !== input.target.role);
}

export function canDeactivateMember(input: {
  callerRole: MemberRole;
  target: Pick<TeamMember, "role" | "status" | "member_id">;
  callerMemberId: string;
  activeOwnerCount: number;
}): boolean {
  const { callerRole, target, callerMemberId, activeOwnerCount } = input;
  if (!canManageWorkspaceMembers(callerRole)) {
    return false;
  }
  if (target.status !== "active") {
    return false;
  }
  if (target.member_id === callerMemberId) {
    return false;
  }
  if (target.role === "owner" && callerRole !== "owner") {
    return false;
  }
  if (isLastActiveOwner(target, activeOwnerCount)) {
    return false;
  }
  return true;
}

export function canRemoveMember(input: {
  callerRole: MemberRole;
  target: Pick<TeamMember, "role" | "status" | "member_id">;
  callerMemberId: string;
  activeOwnerCount: number;
}): boolean {
  const { callerRole, target, callerMemberId, activeOwnerCount } = input;
  if (!canManageWorkspaceMembers(callerRole)) {
    return false;
  }
  if (target.member_id === callerMemberId) {
    return false;
  }
  if (target.role === "owner" && callerRole !== "owner") {
    return false;
  }
  if (isLastActiveOwner(target, activeOwnerCount)) {
    return false;
  }
  return true;
}

export function canRevokeInvitation(callerRole: MemberRole): boolean {
  return canManageWorkspaceMembers(callerRole);
}

export type RoleMutationRpc =
  "update_workspace_member_role" | "promote_workspace_member_to_owner" | "demote_workspace_owner";

export function resolveRoleMutationRpc(input: {
  currentRole: MemberRole;
  nextRole: MemberRole;
}): RoleMutationRpc {
  if (input.currentRole === input.nextRole) {
    return "update_workspace_member_role";
  }
  if (input.nextRole === "owner") {
    return "promote_workspace_member_to_owner";
  }
  if (input.currentRole === "owner") {
    return "demote_workspace_owner";
  }
  return "update_workspace_member_role";
}

export function buildTeamTableRows(
  members: readonly TeamMember[],
  invitations: readonly TeamInvitation[],
): TeamTableRow[] {
  const memberRows: TeamTableRow[] = [...members]
    .sort((a, b) => {
      const statusOrder = statusSort(a.status) - statusSort(b.status);
      if (statusOrder !== 0) {
        return statusOrder;
      }
      const roleOrder = roleSort(a.role) - roleSort(b.role);
      if (roleOrder !== 0) {
        return roleOrder;
      }
      return a.display_label.localeCompare(b.display_label);
    })
    .map((member) => ({
      kind: "member" as const,
      id: member.member_id,
      member,
    }));

  const invitationRows: TeamTableRow[] = [...invitations]
    .sort((a, b) => a.email.localeCompare(b.email))
    .map((invitation) => ({
      kind: "invitation" as const,
      id: invitation.invitation_id,
      invitation,
    }));

  const activeAndInvited = [
    ...memberRows.filter((row) => row.kind === "member" && row.member.status === "active"),
    ...invitationRows,
    ...memberRows.filter((row) => row.kind === "member" && row.member.status === "deactivated"),
  ];

  return activeAndInvited;
}

function roleSort(role: MemberRole): number {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "agent":
      return 2;
    case "viewer":
      return 3;
    default: {
      const exhaustive: never = role;
      return Number(exhaustive);
    }
  }
}

function statusSort(status: TeamMember["status"]): number {
  return status === "active" ? 0 : 1;
}

export function memberActionBlockReason(input: {
  callerRole: MemberRole;
  target: Pick<TeamMember, "role" | "status" | "member_id">;
  callerMemberId: string;
  activeOwnerCount: number;
}): "self" | "last_owner" | "owner_protected" | "deactivated" | "forbidden" | null {
  const { callerRole, target, callerMemberId, activeOwnerCount } = input;
  if (!canManageWorkspaceMembers(callerRole)) {
    return "forbidden";
  }
  if (target.member_id === callerMemberId) {
    return "self";
  }
  if (target.role === "owner" && callerRole !== "owner") {
    return "owner_protected";
  }
  if (isLastActiveOwner(target, activeOwnerCount)) {
    return "last_owner";
  }
  if (target.status === "deactivated") {
    return "deactivated";
  }
  return null;
}
