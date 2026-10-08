import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { allConversations, workspaceInboxes } from "@/lib/company/inboxes";
export async function GET(request: Request) {
  const client = await createClient();
  const { user } = await requireUser(client);
  if (!user)
    return Response.json({ error: "Sign in required" }, { status: 401 });
  const url = new URL(request.url);
  try {
    const data =
      url.searchParams.get("part") === "counts"
        ? await workspaceInboxes(client)
        : await allConversations(
            client,
            {
              page: Number(url.searchParams.get("page") ?? 1),
              pageSize: 25,
              statusGroup: url.searchParams.get("statusGroup") ?? "active",
              assignment: url.searchParams.get("assignment") ?? "all",
              ...(url.searchParams.get("q")
                ? { q: url.searchParams.get("q") }
                : {}),
            },
            url.searchParams.get("workspaceId"),
          );
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Unable to load company inboxes" },
      { status: 400 },
    );
  }
}
