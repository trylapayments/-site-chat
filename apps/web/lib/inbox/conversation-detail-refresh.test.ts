import type { ConversationDetail } from "@site-chat/shared";
import { describe, expect, it } from "vitest";

import { conversationChangeNeedsDetailRefresh } from "./conversation-detail-refresh";

const current: Pick<
  ConversationDetail,
  "status" | "assigned_to" | "assignment_version"
> = {
  status: "open",
  assigned_to: null,
  assignment_version: 3,
};
const unchanged = { status: "open", assigned_to: null, assignment_version: 3 };

describe("conversation detail invalidation", () => {
  it("ignores message and visitor-profile updates with unchanged assignment/status", () => {
    expect(
      conversationChangeNeedsDetailRefresh(current, {
        ...unchanged,
        updated_at: "2026-10-04T00:00:00Z",
        message_count: 4,
      }),
    ).toBe(false);
  });

  it("refreshes assignment, revision and status changes", () => {
    expect(
      conversationChangeNeedsDetailRefresh(current, {
        ...unchanged,
        assigned_to: "new-member",
      }),
    ).toBe(true);
    expect(
      conversationChangeNeedsDetailRefresh(current, {
        ...unchanged,
        assignment_version: 4,
      }),
    ).toBe(true);
    expect(
      conversationChangeNeedsDetailRefresh(current, {
        ...unchanged,
        status: "closed",
      }),
    ).toBe(true);
  });

  it("compares assignee ids rather than display labels or object identity", () => {
    expect(
      conversationChangeNeedsDetailRefresh(
        {
          ...current,
          assigned_to: { member_id: "same-member", display_label: "You" },
        },
        { ...unchanged, assigned_to: "same-member" },
      ),
    ).toBe(false);
  });

  it("falls back to authoritative refresh when CDC shape is incomplete", () => {
    expect(
      conversationChangeNeedsDetailRefresh(current, { updated_at: "now" }),
    ).toBe(true);
  });
});
