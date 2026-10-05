import "server-only";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
export const conversationContextSchema = z.object({
  conversationId: z.string().uuid().nullable(),
  conversationStatus: z
    .enum(["open", "pending", "resolved", "closed"])
    .nullable(),
  rating: z
    .object({ score: z.number().int().min(1).max(5), comment: z.string() })
    .nullable(),
  messageAgents: z.record(
    z.object({ name: z.string(), avatarPath: z.string().nullable() }),
  ),
});
export async function visitorConversationContext(
  workspaceId: string,
  session: string,
) {
  const service = createServiceClient();
  const { data, error } = await service.rpc("widget_conversation_context", {
    p_workspace_id: workspaceId,
    p_session_token: session,
  });
  if (error) throw new Error("Session invalid or expired.");
  return conversationContextSchema.parse(data);
}
export async function publicVisitorConversationContext(
  workspaceId: string,
  session: string,
) {
  const context = await visitorConversationContext(workspaceId, session);
  const storage = createServiceClient().storage.from("agent-avatars");
  const paths = [
    ...new Set(
      Object.values(context.messageAgents)
        .map((a) => a.avatarPath)
        .filter((p): p is string => !!p && p.startsWith(`${workspaceId}/`)),
    ),
  ];
  const urls = new Map<string, string>();
  if (paths.length) {
    const signed = await storage.createSignedUrls(paths, 3600);
    for (const row of signed.data ?? [])
      if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
  }
  return {
    ...context,
    messageAgents: Object.fromEntries(
      Object.entries(context.messageAgents).map(([id, a]) => [
        id,
        {
          name: a.name,
          avatarUrl: a.avatarPath ? (urls.get(a.avatarPath) ?? null) : null,
        },
      ]),
    ),
  };
}
