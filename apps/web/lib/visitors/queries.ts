import { can, type Database, type Json } from "@site-chat/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAccessibleWorkspaces } from "@/lib/workspace/queries";
import { workspaceBillingAccess } from "@/lib/billing/access";
type VisitorsDB = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      list_all_active_visitors: {
        Args: { p_workspace_ids: string[] };
        Returns: Json;
      };
    };
  };
};
import { z } from "zod";
import { callPublicRpc } from "@/lib/workspace/rpc";
import type { AppSupabaseClient } from "@/lib/supabase/server";
export const visitorSchema = z.object({
  canSend: z.boolean().optional(),
  workspace: z
    .object({ id: z.string().uuid(), name: z.string(), slug: z.string() })
    .optional(),
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  ip: z.string().nullable(),
  city: z.string().max(128).nullable().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  browser: z.string().nullable(),
  device: z.string().nullable(),
  startedAt: z.string(),
  lastSeenAt: z.string(),
  conversationId: z.string().uuid().nullable(),
  status: z.enum(["browsing", "waiting", "chatting", "invited"]),
});
export type ActiveVisitor = z.infer<typeof visitorSchema>;
export async function fetchActiveVisitors(
  client: AppSupabaseClient,
  workspaceId: string,
): Promise<ActiveVisitor[]> {
  const { data, error } = await callPublicRpc(client, "list_active_visitors", {
    p_workspace_id: workspaceId,
  });
  if (error) throw new Error("Unable to load visitors.");
  return z.array(visitorSchema).parse(data);
}

export async function fetchAllActiveVisitors(
  client: AppSupabaseClient,
): Promise<ActiveVisitor[]> {
  const { accessible_workspaces } = await fetchAccessibleWorkspaces(client);
  const permitted = await Promise.all(
    accessible_workspaces
      .filter((w) => can(w.role, "view_conversations"))
      .map(async (w) =>
        (await workspaceBillingAccess(w.workspace_id)).enabled
          ? w.workspace_id
          : null,
      ),
  );
  const { data, error } = await (
    client as unknown as SupabaseClient<VisitorsDB>
  ).rpc("list_all_active_visitors", {
    p_workspace_ids: permitted.filter((id): id is string => id !== null),
  });
  if (error) throw new Error("Unable to load visitors.");
  return z
    .array(
      visitorSchema.extend({
        workspace: z.object({
          id: z.string().uuid(),
          name: z.string(),
          slug: z.string(),
        }),
      }),
    )
    .parse(data)
    .map((visitor) => ({
      ...visitor,
      canSend: can(
        accessible_workspaces.find(
          (w) => w.workspace_id === visitor.workspace.id,
        )?.role ?? "viewer",
        "send_messages",
      ),
    }));
}
