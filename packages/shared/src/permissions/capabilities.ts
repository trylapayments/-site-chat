import type { MemberRole } from "../schemas/workspace";

export const DASHBOARD_CAPABILITIES = [
  "view_conversations",
  "send_messages",
  "manage_internal_notes",
  "assign_conversations",
  "update_conversation_status",
  "update_visitor_profile",
  "view_contact_profile",
  "manage_crm_definitions",
  "view_canned_responses",
  "use_canned_responses",
  "manage_workspace_canned_responses",
  /** Owner/admin: Widget Studio draft/publish and brand assets. */
  "manage_widget_studio",
  /** Any member may view published preview metadata in Studio (read-only). */
  "view_widget_studio",
  /** Any active member may list workspace members (mirrors workspace_members SELECT). */
  "view_workspace_members",
  /** Owner/admin: invite, role change, deactivate, remove (mirrors member RPCs). */
  "manage_workspace_members",
] as const;

export type DashboardCapability = (typeof DASHBOARD_CAPABILITIES)[number];

const CAPABILITY_MATRIX: Record<DashboardCapability, readonly MemberRole[]> = {
  view_conversations: ["owner", "admin", "agent", "viewer"],
  send_messages: ["owner", "admin", "agent"],
  manage_internal_notes: ["owner", "admin", "agent"],
  assign_conversations: ["owner", "admin", "agent"],
  update_conversation_status: ["owner", "admin", "agent"],
  // Profile/tags/companies/custom-field values — messaging roles (RPC write gate).
  update_visitor_profile: ["owner", "admin", "agent"],
  // CRM-lite read: any workspace member (mirrors require_crm_read_access).
  view_contact_profile: ["owner", "admin", "agent", "viewer"],
  // Custom field definitions only — mirrors require_crm_definitions_manage.
  manage_crm_definitions: ["owner", "admin"],
  // Reading a snippet is reference material; inserting one implies sending a
  // reply, which viewers cannot do. Mirrors the RPC gates in
  // supabase/migrations/20260816120000_canned_responses.sql.
  view_canned_responses: ["owner", "admin", "agent", "viewer"],
  use_canned_responses: ["owner", "admin", "agent"],
  manage_workspace_canned_responses: ["owner", "admin"],
  manage_widget_studio: ["owner", "admin"],
  // Agents/viewers can open Studio in read-only mode (no draft mutation).
  view_widget_studio: ["owner", "admin", "agent", "viewer"],
  // T9: agents (and other members) can list members; invitations remain owner/admin.
  view_workspace_members: ["owner", "admin", "agent", "viewer"],
  // create/revoke invitation, role change, deactivate, remove.
  manage_workspace_members: ["owner", "admin"],
};

export function rolesForCapability(capability: DashboardCapability): readonly MemberRole[] {
  return CAPABILITY_MATRIX[capability];
}
