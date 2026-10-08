import "server-only";
import {
  can,
  allConversationsQuerySchema,
  allConversationsResultSchema,
  workspaceInboxesResultSchema,
  deleteCompanyInputSchema,
  deleteCompanyResultSchema,
  type Database,
  type Json,
} from "@site-chat/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSupabaseClient } from "@/lib/supabase/server";
import { fetchAccessibleWorkspaces } from "@/lib/workspace/queries";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { loadChargebeeBilling } from "@/lib/billing/chargebee";
type CompanyDB = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      list_all_conversations: {
        Args: { p_workspace_ids: string[]; p_query: Json };
        Returns: Json;
      };
      workspace_inboxes: { Args: { p_workspace_ids: string[] }; Returns: Json };
      delete_own_company: {
        Args: { p_workspace_id: string; p_confirmation: string };
        Returns: Json;
      };
    };
  };
};
async function accessible(client: AppSupabaseClient) {
  const { accessible_workspaces: workspaces } =
    await fetchAccessibleWorkspaces(client);
  const result = await Promise.all(
    workspaces
      .filter((w) => can(w.role, "view_conversations"))
      .map(async (w) => ({
        w,
        enabled: (await workspaceBillingAccess(w.workspace_id)).enabled,
      })),
  );
  return result.filter((r) => r.enabled).map((r) => r.w.workspace_id);
}
export async function allConversations(
  client: AppSupabaseClient,
  input: unknown,
  workspaceId?: string | null,
) {
  const query = allConversationsQuerySchema.parse(input ?? {});
  const { data, error } = await (
    client as unknown as SupabaseClient<CompanyDB>
  ).rpc("list_all_conversations", {
    p_workspace_ids: (await accessible(client)).filter(
      (id) => !workspaceId || id === workspaceId,
    ),
    p_query: query as Json,
  });
  if (error) throw error;
  return allConversationsResultSchema.parse(data);
}
export async function workspaceInboxes(client: AppSupabaseClient) {
  const { data, error } = await (
    client as unknown as SupabaseClient<CompanyDB>
  ).rpc("workspace_inboxes", { p_workspace_ids: await accessible(client) });
  if (error) throw error;
  return workspaceInboxesResultSchema.parse(data);
}
export async function deleteCompany(
  client: AppSupabaseClient,
  workspaceId: string,
  input: unknown,
) {
  const { confirmation } = deleteCompanyInputSchema.parse(input);
  const { accessible_workspaces } = await fetchAccessibleWorkspaces(client);
  const company = accessible_workspaces.find(
    (w) => w.workspace_id === workspaceId,
  );
  if (company?.role !== "owner")
    throw new Error("Only the owner can delete this company.");
  if (confirmation !== company.name)
    throw new Error("Type the exact company name.");
  await loadChargebeeBilling(workspaceId);
  const { data, error } = await (
    client as unknown as SupabaseClient<CompanyDB>
  ).rpc("delete_own_company", {
    p_workspace_id: workspaceId,
    p_confirmation: confirmation,
  });
  if (error) throw error;
  return deleteCompanyResultSchema.parse(data);
}
