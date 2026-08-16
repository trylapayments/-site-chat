import type { MemberRole } from "../schemas/workspace";

export const DASHBOARD_CAPABILITIES = [
  "view_conversations",
  "send_messages",
  "manage_internal_notes",
  "assign_conversations",
  "update_conversation_status",
  "update_visitor_profile",
  "view_canned_responses",
  "use_canned_responses",
  "manage_workspace_canned_responses",
] as const;

export type DashboardCapability = (typeof DASHBOARD_CAPABILITIES)[number];

const CAPABILITY_MATRIX: Record<DashboardCapability, readonly MemberRole[]> = {
  view_conversations: ["owner", "admin", "agent", "viewer"],
  send_messages: ["owner", "admin", "agent"],
  manage_internal_notes: ["owner", "admin", "agent"],
  assign_conversations: ["owner", "admin", "agent"],
  update_conversation_status: ["owner", "admin", "agent"],
  update_visitor_profile: ["owner", "admin", "agent"],
  // Reading a snippet is reference material; inserting one implies sending a
  // reply, which viewers cannot do. Mirrors the RPC gates in
  // supabase/migrations/20260816120000_canned_responses.sql.
  view_canned_responses: ["owner", "admin", "agent", "viewer"],
  use_canned_responses: ["owner", "admin", "agent"],
  manage_workspace_canned_responses: ["owner", "admin"],
};

export function rolesForCapability(capability: DashboardCapability): readonly MemberRole[] {
  return CAPABILITY_MATRIX[capability];
}
