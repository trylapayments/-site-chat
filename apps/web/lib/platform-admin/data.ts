import "server-only";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { requirePlatformAdministrator } from "./guard";
import { companyProfileSchema } from "@/lib/company/schema";
import { loadChargebeeBilling } from "@/lib/billing/chargebee";
export async function loadPlatformCustomers(query = "", page = 1) {
  await requirePlatformAdministrator();
  const service = createServiceClient();
  let request = service
    .from("workspaces")
    .select("id,name,slug,status,created_at", { count: "exact" })
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .range((page - 1) * 25, page * 25 - 1);
  const search = query.trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      search,
    )
  ) {
    request = request.eq("id", search.toLowerCase());
  } else if (search) {
    request = request.ilike("name", `%${search.replace(/[%_,()]/g, "")}%`);
  }
  const { data, error, count } = await request;
  if (error) throw new Error("Customers could not be loaded.");
  const ids = data.map((w) => w.id);
  const { data: controls, error: controlsError } = ids.length
    ? await service
        .from("workspace_admin_controls")
        .select("workspace_id,access_mode,trial_ends_at")
        .in("workspace_id", ids)
    : { data: [], error: null };
  if (controlsError) throw new Error("Customer access could not be loaded.");
  return {
    customers: data.map((w) => ({
      ...w,
      controls: controls.find((c) => c.workspace_id === w.id) ?? null,
    })),
    count: count ?? 0,
  };
}
export async function loadPlatformCustomer(id: string) {
  const administrator = await requirePlatformAdministrator();
  const service = createServiceClient();
  const { data: workspace, error } = await service
    .from("workspaces")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error("Customer could not be loaded.");
  if (!workspace) notFound();
  const results = await Promise.all([
    service
      .from("workspace_company_profiles")
      .select("profile")
      .eq("workspace_id", id)
      .maybeSingle(),
    service
      .from("workspace_admin_controls")
      .select("*")
      .eq("workspace_id", id)
      .maybeSingle(),
    service
      .from("workspace_members")
      .select("id,user_id,role,status,joined_at")
      .eq("workspace_id", id)
      .order("joined_at"),
    service
      .from("allowed_domains")
      .select("id,domain,verified,created_at")
      .eq("workspace_id", id)
      .order("domain"),
    service
      .from("platform_customer_notes")
      .select("id,body,author_id,created_at")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    service
      .from("platform_audit_log")
      .select("id,actor_id,action,reason,created_at,before_json,after_json")
      .eq("workspace_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    service.rpc("platform_customer_usage", {
      p_actor_id: administrator.user.id,
      p_workspace_id: id,
    }),
    service
      .from("agent_profiles")
      .select("member_id,display_name")
      .eq("workspace_id", id),
    service
      .from("workspace_chargebee_accounts")
      .select("site,customer_id,synced_at")
      .eq("workspace_id", id),
  ]);
  if (results.some((r) => r.error)) {
    console.error(
      "Platform customer queries failed",
      results
        .map((r, index) =>
          r.error
            ? { index, code: r.error.code, message: r.error.message }
            : null,
        )
        .filter(Boolean),
    );
    throw new Error(
      "Some customer data could not be loaded. Refresh to try again.",
    );
  }
  const [
    company,
    controls,
    members,
    domains,
    notes,
    audit,
    usage,
    profiles,
    billingAccounts,
  ] = results;
  if (members.error || profiles.error)
    throw new Error("Member details unavailable.");
  const users = await Promise.all(
    members.data.map(async (m) => {
      const { data, error } = await service.auth.admin.getUserById(m.user_id);
      if (error) throw new Error("Member details could not be loaded.");
      return {
        ...m,
        email: data.user.email ?? "",
        name:
          profiles.data.find((p) => p.member_id === m.id)?.display_name ?? "",
        lastSignIn: data.user.last_sign_in_at ?? null,
      };
    }),
  );
  const stats =
    usage.data && typeof usage.data === "object" && !Array.isArray(usage.data)
      ? usage.data
      : {};
  const raw = company.data?.profile;
  const profile = companyProfileSchema.parse({
    ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}),
    name: workspace.name,
  });
  let billing: Awaited<ReturnType<typeof loadChargebeeBilling>> | null = null;
  let billingError = false;
  if (["owner", "finance"].includes(administrator.role)) {
    try {
      billing = await loadChargebeeBilling(id);
    } catch {
      billingError = true;
    }
  }
  return {
    administratorRole: administrator.role,
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      created_at: workspace.created_at,
      updated_at: workspace.updated_at,
    },
    profile,
    controls: controls.data,
    members: users,
    domains: domains.data ?? [],
    notes: notes.data ?? [],
    audit: audit.data ?? [],
    usage: {
      conversations:
        typeof stats.conversations === "number" ? stats.conversations : 0,
      openConversations:
        typeof stats.openConversations === "number"
          ? stats.openConversations
          : 0,
    },
    billing,
    billingError,
    billingAccounts: billingAccounts.data ?? [],
  };
}
export type PlatformCustomer = Awaited<ReturnType<typeof loadPlatformCustomer>>;
