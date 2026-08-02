import { describe, expect, it } from "vitest";

import { can } from "@site-chat/shared";

describe("can", () => {
  it("allows all roles to view conversations", () => {
    expect(can("owner", "view_conversations")).toBe(true);
    expect(can("admin", "view_conversations")).toBe(true);
    expect(can("agent", "view_conversations")).toBe(true);
    expect(can("viewer", "view_conversations")).toBe(true);
  });

  it("restricts send_messages to owner, admin, and agent", () => {
    expect(can("owner", "send_messages")).toBe(true);
    expect(can("admin", "send_messages")).toBe(true);
    expect(can("agent", "send_messages")).toBe(true);
    expect(can("viewer", "send_messages")).toBe(false);
  });

  it("restricts assign_conversations to owner, admin, and agent", () => {
    expect(can("owner", "assign_conversations")).toBe(true);
    expect(can("admin", "assign_conversations")).toBe(true);
    expect(can("agent", "assign_conversations")).toBe(true);
    expect(can("viewer", "assign_conversations")).toBe(false);
  });
});
