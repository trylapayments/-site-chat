import { describe, expect, it } from "vitest";

import { AssignmentError, parseAssignmentErrorMessage } from "./errors.js";
import {
  classifyAssignmentMutation,
  conversationMatchesAssignmentFilter,
  evaluateTakeDecision,
  filterAssignableMembers,
  reconcileOptimisticAssignee,
} from "./state.js";
import { assignmentMessagesEn } from "./messages.js";

describe("assignment filters", () => {
  const mine = {
    assigned_to: { member_id: "11111111-1111-1111-1111-111111111111", display_label: "Ada" },
  };
  const other = {
    assigned_to: { member_id: "22222222-2222-2222-2222-222222222222", display_label: "Bob" },
  };
  const open = { assigned_to: null };

  it("matches Mine / Unassigned / All", () => {
    expect(
      conversationMatchesAssignmentFilter(mine, "assigned_to_me", mine.assigned_to.member_id),
    ).toBe(true);
    expect(
      conversationMatchesAssignmentFilter(other, "assigned_to_me", mine.assigned_to.member_id),
    ).toBe(false);
    expect(conversationMatchesAssignmentFilter(open, "unassigned", undefined)).toBe(true);
    expect(conversationMatchesAssignmentFilter(mine, "unassigned", undefined)).toBe(false);
    expect(conversationMatchesAssignmentFilter(other, "all", undefined)).toBe(true);
  });
});

describe("take semantics", () => {
  const me = "11111111-1111-1111-1111-111111111111";
  const other = "22222222-2222-2222-2222-222222222222";

  it("takes unassigned, no-ops self, conflicts with other", () => {
    expect(evaluateTakeDecision(null, me)).toEqual({ action: "take" });
    expect(evaluateTakeDecision(me, me)).toEqual({ action: "noop" });
    expect(evaluateTakeDecision(other, me)).toEqual({
      action: "conflict",
      assigneeMemberId: other,
    });
  });
});

describe("mutation classification", () => {
  it("classifies assigned / transferred / unassigned / noop", () => {
    expect(classifyAssignmentMutation(null, "a")).toBe("assigned");
    expect(classifyAssignmentMutation("a", "b")).toBe("transferred");
    expect(classifyAssignmentMutation("a", null)).toBe("unassigned");
    expect(classifyAssignmentMutation("a", "a")).toBe("noop");
    expect(classifyAssignmentMutation(null, null)).toBe("noop");
  });
});

describe("member picker filtering", () => {
  const members = [
    {
      member_id: "11111111-1111-1111-1111-111111111111",
      display_label: "Ada Agent",
      role: "agent" as const,
    },
    {
      member_id: "22222222-2222-2222-2222-222222222222",
      display_label: "Vera Viewer",
      role: "viewer" as const,
    },
    {
      member_id: "33333333-3333-3333-3333-333333333333",
      display_label: "Owen Owner",
      role: "owner" as const,
    },
  ];

  it("excludes viewers and supports search", () => {
    expect(filterAssignableMembers(members).map((m) => m.display_label)).toEqual([
      "Ada Agent",
      "Owen Owner",
    ]);
    expect(filterAssignableMembers(members, { search: "ada" })).toHaveLength(1);
    expect(filterAssignableMembers(members, { search: "zzz" })).toHaveLength(0);
  });
});

describe("optimistic rollback", () => {
  it("reverts to authoritative state on conflict", () => {
    const optimistic = { member_id: "a", display_label: "Me" };
    const authoritative = { member_id: "b", display_label: "Them" };
    expect(reconcileOptimisticAssignee(optimistic, authoritative, true)).toEqual(authoritative);
    expect(reconcileOptimisticAssignee(optimistic, null, false)).toEqual(optimistic);
  });
});

describe("typed errors", () => {
  it("parses prefixed Postgres messages", () => {
    const err = parseAssignmentErrorMessage(
      "ASSIGNMENT_CONFLICT: Conversation is already assigned",
    );
    expect(err).toBeInstanceOf(AssignmentError);
    expect(err?.code).toBe("ASSIGNMENT_CONFLICT");
  });

  it("maps insufficient permissions to FORBIDDEN", () => {
    expect(parseAssignmentErrorMessage("Insufficient permissions")?.code).toBe("FORBIDDEN");
  });
});

describe("messages catalog", () => {
  it("exposes Mine / Take / Unassigned strings", () => {
    expect(assignmentMessagesEn.filterMine).toBe("Mine");
    expect(assignmentMessagesEn.take).toBe("Take");
    expect(assignmentMessagesEn.filterUnassigned).toBe("Unassigned");
  });
});
