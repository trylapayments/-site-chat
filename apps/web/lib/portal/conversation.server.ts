import "server-only";
import { can, type CannedResponse, type ContactTagSummary, type InternalNote } from "@site-chat/shared";
import { countryForStoredIp } from "@/lib/visitors/ip-country";
import { loadWorkspaceAIConfig } from "@/lib/ai/config";
import { fetchCannedResponses } from "@/lib/canned/queries";
import { fetchContactProfile } from "@/lib/crm/queries";
import { fetchAssignableMembers, fetchConversation, fetchInternalNote, fetchInternalNotes, fetchMessages } from "@/lib/inbox/queries";
import { fetchWorkspaceMemberIdentity } from "@/lib/workspace/member.server";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import type { requireInboxWorkspace } from "@/lib/inbox/guards";

type Workspace = Awaited<ReturnType<typeof requireInboxWorkspace>>["workspace"];
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function loadPortalConversation(supabase: AppSupabaseClient, workspace: Workspace, user: {id: string; email?: string}, conversationId: string, focusMessageId?: string) {
 const [member, conversation, messages] = await Promise.all([
   fetchWorkspaceMemberIdentity(supabase, workspace.workspace_id, user.id),
   fetchConversation(supabase, workspace.workspace_id, conversationId),
   (async () => {
     try { return await fetchMessages(supabase, workspace.workspace_id, conversationId, {limit: 50, ...(focusMessageId ? {around_message_id: focusMessageId} : {})}); }
     catch (error) { if (!focusMessageId) throw error; return fetchMessages(supabase, workspace.workspace_id, conversationId, {limit: 50}); }
   })(),
 ]);
 conversation.ip_country_code ??= countryForStoredIp(conversation.visitor_ip);
 return {workspace, conversation, messages, memberId: member?.id ?? "", memberDisplayLabel: user.email ?? null};
}
export type PortalConversationData = Awaited<ReturnType<typeof loadPortalConversation>>;
export async function loadPortalConversationTools(supabase: AppSupabaseClient, workspace: Workspace, conversationId: string, focusNoteId?: string) {
 const conversation = await fetchConversation(supabase, workspace.workspace_id, conversationId);
 const canManageNotes = can(workspace.role, "manage_internal_notes");
 const canAssign = can(workspace.role, "assign_conversations");
 const canUseCannedResponses = can(workspace.role, "send_messages") && can(workspace.role, "use_canned_responses");
  const [
    members,
    initialNotes,
    initialCannedResponses,
    { flags: aiFlags },
    contactTags,
  ] = await Promise.all([
    canManageNotes || canAssign
      ? fetchAssignableMembers(supabase, workspace.workspace_id)
      : Promise.resolve([]),
    (async (): Promise<InternalNote[]> => {
      if (!canManageNotes) return [];
      let notes: InternalNote[] = [];
      try {
        notes = (
          await fetchInternalNotes(
            supabase,
            workspace.workspace_id,
            conversationId,
            { limit: 100 },
          )
        ).items;
      } catch {
        // Client catch-up can recover an unavailable optional panel.
      }
      if (focusNoteId && !notes.some((note) => note.id === focusNoteId)) {
        try {
          const focused = await fetchInternalNote(
            supabase,
            workspace.workspace_id,
            focusNoteId,
          );
          if (
            focused.conversation_id === conversationId &&
            !focused.deleted_at
          ) {
            notes = [...notes, focused];
          }
        } catch {
          // Keep available notes; client catch-up may recover the focused note.
        }
      }
      return notes;
    })(),
    (async (): Promise<CannedResponse[]> => {
      if (!canUseCannedResponses) return [];
      try {
        return (
          await fetchCannedResponses(supabase, workspace.workspace_id, {
            limit: 200,
            include_folders: false,
          })
        ).items;
      } catch {
        return [];
      }
    })(),
    loadWorkspaceAIConfig(supabase, workspace.workspace_id),
    (async (): Promise<ContactTagSummary[]> => {
      if (
        !conversation.contact?.id ||
        !can(workspace.role, "view_contact_profile")
      )
        return [];
      try {
        return (
          await fetchContactProfile(
            supabase,
            workspace.workspace_id,
            conversation.contact.id,
          )
        ).tags;
      } catch {
        return [];
      }
    })(),
  ]);
  const aiSuggestedRepliesEnabled =
    can(workspace.role, "send_messages") && aiFlags.suggestedReplies;
  return { members, notes: initialNotes, cannedResponses: initialCannedResponses, contactTags, aiSuggestedRepliesEnabled };

}
