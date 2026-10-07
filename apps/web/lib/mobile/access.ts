import { createServerClient } from "@supabase/ssr";
import {
  can,
  type Database,
  type DashboardCapability,
} from "@site-chat/shared";
import { clientEnv } from "@/lib/env";
import { fetchAccessibleWorkspaces } from "@/lib/workspace/queries";
import { workspaceBillingAccess } from "@/lib/billing/access";

export class MobileError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function authenticateMobile(request: Request) {
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("authorization") ?? "",
  );
  const token = match?.[1];
  if (!token)
    throw new MobileError(401, "UNAUTHORIZED", "Please sign in again.");
  // Never use a service key to execute operator RPCs: auth.uid() and RLS stay intact.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- Uses getAll/setAll, matching the repository's SSR factory.
  const client = createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user)
    throw new MobileError(401, "UNAUTHORIZED", "Please sign in again.");
  return { client, user: data.user };
}

export async function authorizeMobile(
  context: Awaited<ReturnType<typeof authenticateMobile>>,
  workspaceId: string,
  capability: DashboardCapability = "view_conversations",
) {
  const result = await fetchAccessibleWorkspaces(context.client);
  const workspace = result.accessible_workspaces.find(
    (w) => w.workspace_id === workspaceId,
  );
  if (!workspace || !can(workspace.role, capability))
    throw new MobileError(403, "FORBIDDEN", "Workspace access denied.");
  const access = await workspaceBillingAccess(workspaceId);
  if (!access.enabled)
    throw new MobileError(
      403,
      "WORKSPACE_DISABLED",
      "Workspace access is restricted. Contact your administrator.",
    );
  const { data: member, error } = await context.client
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", context.user.id)
    .eq("status", "active")
    .single<{ id: string }>();
  if (error || !member)
    throw new MobileError(403, "FORBIDDEN", "Workspace access denied.");
  return { workspace, memberId: member.id };
}
