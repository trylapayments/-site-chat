import { describe, expect, it } from "vitest";

import { TeamError, parseTeamErrorMessage } from "./errors.js";
import { teamMemberDisplayName, teamMemberInitials } from "./display.js";
import {
  buildTeamTableRows,
  canChangeMemberRole,
  canDeactivateMember,
  canManageWorkspaceMembers,
  canRemoveMember,
  canRevokeInvitation,
  canViewInvitations,
  countActiveOwners,
  inviteRolesFor,
  isLastActiveOwner,
  memberActionBlockReason,
  resolveRoleMutationRpc,
  roleOptionsForMember,
} from "./policy.js";
import type { TeamInvitation, TeamMember } from "../schemas/team.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const VIEWER_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_B_ID = "55555555-5555-4555-8555-555555555555";

function member(partial: Partial<TeamMember> & Pick<TeamMember, "member_id" | "role">): TeamMember {
  return {
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: `${partial.role}@local.test`,
    display_label: `${partial.role}@local.test`,
    status: "active",
    joined_at: "2026-01-01T00:00:00.000Z",
    assigned_conversation_count: 0,
    ...partial,
  };
}

const owner = member({ member_id: OWNER_ID, role: "owner", email: "owner@local.test" });
const admin = member({ member_id: ADMIN_ID, role: "admin", email: "admin@local.test" });
const agent = member({ member_id: AGENT_ID, role: "agent", email: "agent@local.test" });
const viewer = member({ member_id: VIEWER_ID, role: "viewer", email: "viewer@local.test" });
const ownerB = member({ member_id: OWNER_B_ID, role: "owner", email: "owner-b@local.test" });

describe("team capabilities", () => {
  it("lets every role view members and only owner/admin manage", () => {
    expect(canManageWorkspaceMembers("owner")).toBe(true);
    expect(canManageWorkspaceMembers("admin")).toBe(true);
    expect(canManageWorkspaceMembers("agent")).toBe(false);
    expect(canManageWorkspaceMembers("viewer")).toBe(false);
    expect(canViewInvitations("agent")).toBe(false);
    expect(canViewInvitations("admin")).toBe(true);
    expect(inviteRolesFor("owner")).toEqual(["admin", "agent", "viewer"]);
    expect(inviteRolesFor("agent")).toEqual([]);
    expect(canRevokeInvitation("viewer")).toBe(false);
  });
});

describe("owner/admin safety", () => {
  it("blocks last-owner demotion, deactivation, and removal", () => {
    expect(isLastActiveOwner(owner, 1)).toBe(true);
    expect(
      canDeactivateMember({
        callerRole: "owner",
        target: owner,
        callerMemberId: OWNER_B_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canRemoveMember({
        callerRole: "owner",
        target: owner,
        callerMemberId: OWNER_B_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canChangeMemberRole({
        callerRole: "owner",
        target: owner,
        callerMemberId: OWNER_B_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      memberActionBlockReason({
        callerRole: "owner",
        target: owner,
        callerMemberId: OWNER_B_ID,
        activeOwnerCount: 1,
      }),
    ).toBe("last_owner");
  });

  it("blocks self-demotion, self-deactivate, and self-remove", () => {
    expect(
      canChangeMemberRole({
        callerRole: "admin",
        target: admin,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canDeactivateMember({
        callerRole: "admin",
        target: admin,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canRemoveMember({
        callerRole: "owner",
        target: owner,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(false);
    expect(
      memberActionBlockReason({
        callerRole: "admin",
        target: admin,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 1,
      }),
    ).toBe("self");
  });

  it("prevents admins from mutating owners", () => {
    expect(
      roleOptionsForMember({
        callerRole: "admin",
        target: owner,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 2,
      }),
    ).toEqual([]);
    expect(
      canDeactivateMember({
        callerRole: "admin",
        target: owner,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(false);
    expect(
      canRemoveMember({
        callerRole: "admin",
        target: owner,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(false);
    expect(
      memberActionBlockReason({
        callerRole: "admin",
        target: owner,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 2,
      }),
    ).toBe("owner_protected");
  });

  it("lets an owner change, deactivate, or remove another owner when one remains", () => {
    expect(
      canChangeMemberRole({
        callerRole: "owner",
        target: ownerB,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(true);
    expect(
      canDeactivateMember({
        callerRole: "owner",
        target: ownerB,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(true);
    expect(
      canRemoveMember({
        callerRole: "owner",
        target: ownerB,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 2,
      }),
    ).toBe(true);
  });

  it("lets an admin manage agents and viewers but not invite as owner", () => {
    expect(
      roleOptionsForMember({
        callerRole: "admin",
        target: agent,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 1,
      }),
    ).toEqual(["admin", "agent", "viewer"]);
    expect(
      canDeactivateMember({
        callerRole: "admin",
        target: viewer,
        callerMemberId: ADMIN_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(true);
    expect(inviteRolesFor("admin").includes("owner" as never)).toBe(false);
  });

  it("denies agent and viewer mutations", () => {
    expect(
      canChangeMemberRole({
        callerRole: "agent",
        target: viewer,
        callerMemberId: AGENT_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canDeactivateMember({
        callerRole: "viewer",
        target: agent,
        callerMemberId: VIEWER_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      memberActionBlockReason({
        callerRole: "agent",
        target: admin,
        callerMemberId: AGENT_ID,
        activeOwnerCount: 1,
      }),
    ).toBe("forbidden");
  });

  it("allows remove of deactivated members and blocks reactivate-style role edits", () => {
    const deactivated = member({
      member_id: AGENT_ID,
      role: "agent",
      status: "deactivated",
    });
    expect(
      canChangeMemberRole({
        callerRole: "owner",
        target: deactivated,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canDeactivateMember({
        callerRole: "owner",
        target: deactivated,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(false);
    expect(
      canRemoveMember({
        callerRole: "owner",
        target: deactivated,
        callerMemberId: OWNER_ID,
        activeOwnerCount: 1,
      }),
    ).toBe(true);
  });
});

describe("role mutation RPC mapping", () => {
  it("routes owner promotion and demotion to dedicated RPCs", () => {
    expect(resolveRoleMutationRpc({ currentRole: "agent", nextRole: "owner" })).toBe(
      "promote_workspace_member_to_owner",
    );
    expect(resolveRoleMutationRpc({ currentRole: "owner", nextRole: "admin" })).toBe(
      "demote_workspace_owner",
    );
    expect(resolveRoleMutationRpc({ currentRole: "agent", nextRole: "viewer" })).toBe(
      "update_workspace_member_role",
    );
  });
});

describe("team table rows", () => {
  it("places pending invites among actives and deactivated last", () => {
    const deactivated = member({
      member_id: AGENT_ID,
      role: "agent",
      status: "deactivated",
      display_label: "agent@local.test",
    });
    const invitation: TeamInvitation = {
      invitation_id: "66666666-6666-4666-8666-666666666666",
      email: "invitee@local.test",
      role: "viewer",
      created_at: "2026-01-02T00:00:00.000Z",
      expires_at: "2026-01-09T00:00:00.000Z",
    };
    const rows = buildTeamTableRows([owner, deactivated], [invitation]);
    expect(rows.map((row) => row.kind)).toEqual(["member", "invitation", "member"]);
    expect(countActiveOwners([owner, ownerB, deactivated])).toBe(2);
  });
});

describe("team display", () => {
  it("derives a compact name and initials from email", () => {
    expect(teamMemberDisplayName("ada.lovelace@local.test")).toBe("Ada Lovelace");
    expect(teamMemberInitials("Ada Lovelace")).toBe("AL");
    expect(teamMemberDisplayName("")).toBe("Unknown member");
  });
});

describe("parseTeamErrorMessage", () => {
  it("maps last-owner, forbidden, and invite-conflict messages", () => {
    expect(parseTeamErrorMessage("Workspace must have at least one active owner")?.code).toBe(
      "LAST_OWNER",
    );
    expect(parseTeamErrorMessage("Only owners and admins can create invitations")?.code).toBe(
      "FORBIDDEN",
    );
    expect(parseTeamErrorMessage("An active invitation already exists for this email")?.code).toBe(
      "INVITATION_EXISTS",
    );
    expect(parseTeamErrorMessage("Member not found")?.code).toBe("MEMBER_NOT_FOUND");
    const parsed = parseTeamErrorMessage("Workspace not accessible");
    expect(parsed).toBeInstanceOf(TeamError);
    expect(parsed?.code).toBe("FORBIDDEN");
  });
});
