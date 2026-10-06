import Link from "next/link";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    redirect(toAppRoute("/login"));
  }

  const { membership } = await getWorkspaceContext();
  const guard = resolveWorkspaceBySlug(
    workspaceSlug,
    membership.accessible_workspaces,
  );

  if (!guard.ok) {
    if (
      membership.total_membership_count > 0 &&
      membership.accessible_workspaces.length === 0
    ) {
      redirect(toAppRoute("/app/unavailable"));
    }

    notFound();
  }

  const [{ data: memberRow }, { data: platformAdministrator }, access] =
    await Promise.all([
      supabase
        .from("workspace_members")
        .select("id")
        .eq("workspace_id", guard.workspace.workspace_id)
        .eq("user_id", user.id)
        .maybeSingle<{ id: string }>(),
      user.email_confirmed_at
        ? createServiceClient()
            .from("platform_administrators")
            .select("role")
            .eq("user_id", user.id)
            .eq("enabled", true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      workspaceBillingAccess(guard.workspace.workspace_id),
    ]);
  const remaining =
    access.source === "trial" && !access.hasPaidSubscription && access.expiresAt
      ? Math.max(
          1,
          Math.ceil((Date.parse(access.expiresAt) - Date.now()) / 86400000),
        )
      : 0;
  const billingLink = toAppRoute(`/app/${guard.workspace.slug}/billing`);
  const billingBanner = ["grace", "payment_overdue"].includes(access.source) ? (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e1d6bf] bg-[#fbf6e9] px-4 py-2 text-sm text-[#594b32]"
    >
      <span>
        {access.source === "grace"
          ? `Payment overdue · your chat stays active until ${new Date(access.expiresAt ?? "").toLocaleDateString("en-US", { timeZone: "UTC" })}`
          : "Payment overdue · chat access is paused. Your conversations are preserved."}
      </span>
      {["owner", "admin"].includes(guard.workspace.role) ? (
        <Link
          className="font-semibold underline underline-offset-4"
          href={billingLink}
        >
          Resolve payment
        </Link>
      ) : (
        <span>Contact your workspace owner.</span>
      )}
    </div>
  ) : null;
  const addOnBanner = access.addOnDebts.length ? (
    <span>
      Additional service payment overdue · unpaid add-ons are paused. Your base
      chat is unaffected by add-on debt.{" "}
      {["owner", "admin"].includes(guard.workspace.role) ? (
        <a className="ml-3 underline" href={`/app/${workspaceSlug}/billing`}>
          Resolve payment
        </a>
      ) : (
        " Contact your workspace owner."
      )}
    </span>
  ) : null;
  const trialBanner = remaining ? (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#e1d6bf] bg-[#fbf6e9] px-4 py-2 text-sm text-[#594b32]"
      role="status"
    >
      <span>
        Your Mill trial · {remaining} {remaining === 1 ? "day" : "days"}{" "}
        remaining
      </span>
      {["owner", "admin"].includes(guard.workspace.role) ? (
        <Link
          className="font-semibold underline underline-offset-4"
          href={toAppRoute(`/app/${guard.workspace.slug}/billing`)}
        >
          Choose a plan
        </Link>
      ) : (
        <span>Contact your workspace owner to upgrade.</span>
      )}
    </div>
  ) : null;
  return (
    <DashboardShell
      trialBanner={billingBanner ?? addOnBanner ?? trialBanner}
      canAdministerPlatform={Boolean(platformAdministrator)}
      slug={guard.workspace.slug}
      workspaceName={guard.workspace.name}
      workspaceId={guard.workspace.workspace_id}
      memberId={memberRow?.id ?? ""}
      workspaces={membership.accessible_workspaces}
      email={user.email ?? "Signed in"}
      role={guard.workspace.role}
    >
      {children}
    </DashboardShell>
  );
}
