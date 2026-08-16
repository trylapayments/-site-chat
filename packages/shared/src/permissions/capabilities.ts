import type { MemberRole } from "../schemas/workspace";

export const DASHBOARD_CAPABILITIES = [
  "view_conversations",
  "send_messages",
  "manage_internal_notes",
  "assign_conversations",
  "update_conversation_status",
  "update_visitor_profile",
] as const;

export type DashboardCapability = (typeof DASHBOARD_CAPABILITIES)[number];

const CAPABILITY_MATRIX: Record<DashboardCapability, readonly MemberRole[]> = {
  view_conversations: ["owner", "admin", "agent", "viewer"],
  send_messages: ["owner", "admin", "agent"],
  manage_internal_notes: ["owner", "admin", "agent"],
  assign_conversations: ["owner", "admin", "agent"],
  update_conversation_status: ["owner", "admin", "agent"],
  update_visitor_profile: ["owner", "admin", "agent"],
};

export function rolesForCapability(capability: DashboardCapability): readonly MemberRole[] {
  return CAPABILITY_MATRIX[capability];
}
