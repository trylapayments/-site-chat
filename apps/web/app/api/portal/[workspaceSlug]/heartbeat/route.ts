import { z } from "zod";
import { updateOperatorAvailability } from "@/lib/operators/actions";

const heartbeat = z.object({ active: z.boolean() }).strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceSlug: string }> },
) {
  // Cookie-authenticated mutation: require the browser's same-origin POST.
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const input = heartbeat.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "Invalid heartbeat" }, { status: 400 });
  try {
    const { workspaceSlug } = await context.params;
    const result = await updateOperatorAvailability(workspaceSlug, input.data);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Status unavailable" }, { status: 503 });
  }
}
