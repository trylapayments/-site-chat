import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { fetchConversations } from "@/lib/inbox/queries";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  const client = await createClient();
  const { user } = await requireUser(client);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceSlug } = await params;
  let workspace;
  try {
    ({ workspace } = await requireInboxWorkspace(workspaceSlug));
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await (async () => {
      return await fetchConversations(client, workspace.workspace_id, {
        page: 1,
        pageSize: 25,
        statusGroup: "active",
      });
    })();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
}
