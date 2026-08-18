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

  it("restricts manage_internal_notes to owner, admin, and agent", () => {
    expect(can("owner", "manage_internal_notes")).toBe(true);
    expect(can("admin", "manage_internal_notes")).toBe(true);
    expect(can("agent", "manage_internal_notes")).toBe(true);
    expect(can("viewer", "manage_internal_notes")).toBe(false);
  });

  it("restricts assign_conversations to owner, admin, and agent", () => {
    expect(can("owner", "assign_conversations")).toBe(true);
    expect(can("admin", "assign_conversations")).toBe(true);
    expect(can("agent", "assign_conversations")).toBe(true);
    expect(can("viewer", "assign_conversations")).toBe(false);
  });

  it("restricts update_conversation_status to owner, admin, and agent", () => {
    expect(can("owner", "update_conversation_status")).toBe(true);
    expect(can("admin", "update_conversation_status")).toBe(true);
    expect(can("agent", "update_conversation_status")).toBe(true);
    expect(can("viewer", "update_conversation_status")).toBe(false);
  });

  it("restricts update_visitor_profile to owner, admin, and agent", () => {
    expect(can("owner", "update_visitor_profile")).toBe(true);
    expect(can("admin", "update_visitor_profile")).toBe(true);
    expect(can("agent", "update_visitor_profile")).toBe(true);
    expect(can("viewer", "update_visitor_profile")).toBe(false);
  });

  it("allows all roles to view contact profiles", () => {
    expect(can("owner", "view_contact_profile")).toBe(true);
    expect(can("admin", "view_contact_profile")).toBe(true);
    expect(can("agent", "view_contact_profile")).toBe(true);
    expect(can("viewer", "view_contact_profile")).toBe(true);
  });

  it("restricts manage_crm_definitions to owner and admin", () => {
    expect(can("owner", "manage_crm_definitions")).toBe(true);
    expect(can("admin", "manage_crm_definitions")).toBe(true);
    expect(can("agent", "manage_crm_definitions")).toBe(false);
    expect(can("viewer", "manage_crm_definitions")).toBe(false);
  });

  it("allows all roles to view canned responses", () => {
    expect(can("owner", "view_canned_responses")).toBe(true);
    expect(can("admin", "view_canned_responses")).toBe(true);
    expect(can("agent", "view_canned_responses")).toBe(true);
    expect(can("viewer", "view_canned_responses")).toBe(true);
  });

  it("restricts use_canned_responses to owner, admin, and agent", () => {
    expect(can("owner", "use_canned_responses")).toBe(true);
    expect(can("admin", "use_canned_responses")).toBe(true);
    expect(can("agent", "use_canned_responses")).toBe(true);
    expect(can("viewer", "use_canned_responses")).toBe(false);
  });

  it("restricts manage_workspace_canned_responses to owner and admin", () => {
    expect(can("owner", "manage_workspace_canned_responses")).toBe(true);
    expect(can("admin", "manage_workspace_canned_responses")).toBe(true);
    expect(can("agent", "manage_workspace_canned_responses")).toBe(false);
    expect(can("viewer", "manage_workspace_canned_responses")).toBe(false);
  });
});
