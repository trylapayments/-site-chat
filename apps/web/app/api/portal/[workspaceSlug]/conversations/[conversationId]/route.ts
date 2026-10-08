import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { loadPortalConversation, loadPortalConversationTools, UUID_RE } from "@/lib/portal/conversation.server";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request, { params }: { params: Promise<{workspaceSlug: string; conversationId: string}> }) {
 const { workspaceSlug, conversationId } = await params;
 const url = new URL(request.url);
 const message = url.searchParams.get("message") ?? undefined;
 const note = url.searchParams.get("note") ?? undefined;
 if (!UUID_RE.test(conversationId) || (message && !UUID_RE.test(message)) || (note && !UUID_RE.test(note)))
   return Response.json({error: "Invalid identifier"}, {status: 400, headers});
 const client = await createClient();
 const { user } = await requireUser(client);
 if (!user) return Response.json({error: "Unauthorized"}, {status: 401, headers});
 let workspace;
 try { ({workspace} = await requireInboxWorkspace(workspaceSlug)); }
 catch { return Response.json({error: "Forbidden"}, {status: 403, headers}); }
 try {
   const result = url.searchParams.get("part") === "tools"
     ? await loadPortalConversationTools(client, workspace, conversationId, note)
     : await loadPortalConversation(client, workspace, user, conversationId, message);
   return Response.json(result, {headers});
 } catch (error) {
   const code = error && typeof error === "object" && "code" in error ? error.code : null;
   if (code === "42501") return Response.json({error: "Forbidden"}, {status: 403, headers});
   if (code === "P0002") return Response.json({error: "Conversation not found"}, {status: 404, headers});
   return Response.json({error: "Temporarily unavailable"}, {status: 503, headers});
 }
}
