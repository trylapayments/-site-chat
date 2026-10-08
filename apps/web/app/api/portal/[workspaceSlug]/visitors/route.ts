import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { fetchAllActiveVisitors } from "@/lib/visitors/queries";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceSlug: string }> },
) {
  const client = await createClient();
  const { user } = await requireUser(client);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceSlug } = await params;
  try {
    await requireInboxWorkspace(workspaceSlug);
  } catch {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const result = await (async () => {
      return await fetchAllActiveVisitors(client);
    })();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
}
