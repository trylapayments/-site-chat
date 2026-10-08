import { fetchAllActiveVisitors } from "@/lib/visitors/queries";
import { headers } from "next/headers";
import { loadOverview } from "@/lib/portal/overview.server";
import { fetchConversations } from "@/lib/inbox/queries";
import {
  loadPortalConversation,
  UUID_RE,
} from "@/lib/portal/conversation.server";
import { workspaceConversationId } from "@/lib/portal/client-route";
import { PortalWorkArea } from "@/components/dashboard/PortalWorkArea";
import { PortalDataProvider } from "@/components/dashboard/PortalDataProvider";
import { Suspense } from "react";
import { WorkspaceBillingBanner } from "@/components/dashboard/WorkspaceBillingBanner";
import { notFound, redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { fetchWorkspaceMemberIdentity } from "@/lib/workspace/member.server";
import { getWorkspaceMembership } from "@/lib/workspace/redirect.server";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const started = performance.now();
  const timings: Record<string, number> = {};
  function measure<T>(name: string, task: PromiseLike<T>): Promise<T> {
    const begin = performance.now();
    return Promise.resolve(task).finally(() => {
      timings[name] = Math.round(performance.now() - begin);
    });
  }
  const { workspaceSlug } = await params;
  const supabase = await createClient();
  const [{ user }, membership] = await Promise.all([
    measure("authentication", requireUser(supabase)),
    measure("membership", getWorkspaceMembership()),
  ]);

  if (!user) {
    redirect(toAppRoute("/login"));
  }

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

  const path = (await headers()).get("x-mill-portal-path") ?? "";
  const base = `/app/${guard.workspace.slug}`;
  const initialResources: { resource: string; data: Promise<unknown> }[] = [];
  if (path === `${base}/visitors`)
    initialResources.push({
      resource: "visitors",
      data: fetchAllActiveVisitors(supabase).catch(() => undefined),
    });
  if (path === base)
    initialResources.push({
      resource: "overview",
      data: loadOverview(guard.workspace).catch(() => undefined),
    });
  if (
    path === `${base}/inbox` ||
    workspaceConversationId(path, guard.workspace.slug)
  ) {
    initialResources.push({
      resource: "inbox",
      data: fetchConversations(supabase, guard.workspace.workspace_id, {
        page: 1,
        pageSize: 25,
        statusGroup: "active",
      }).catch(() => undefined),
    });
    const conversationId = workspaceConversationId(path, guard.workspace.slug);
    if (conversationId && UUID_RE.test(conversationId))
      initialResources.push({
        resource: `conversations/${conversationId}`,
        data: loadPortalConversation(
          supabase,
          guard.workspace,
          user,
          conversationId,
        ).catch(() => undefined),
      });
  }
  // These promise results are scoped to this authenticated render. They stream
  // into the client store, avoiding another auth/data round trip after hydration.
  const [memberRow, { data: platformAdministrator }] = await Promise.all([
    measure(
      "memberIdentity",
      fetchWorkspaceMemberIdentity(
        supabase,
        guard.workspace.workspace_id,
        user.id,
      ),
    ),
    measure<{ data: { role: string } | null }>(
      "platformRole",
      user.email_confirmed_at
        ? createServiceClient()
            .from("platform_administrators")
            .select("role")
            .eq("user_id", user.id)
            .eq("enabled", true)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ),
  ]);
  if (
    platformAdministrator &&
    (await headers()).get("x-mill-startup-profile") === "1"
  ) {
    console.info(
      "mill-startup-profile",
      JSON.stringify({
        ...timings,
        shell: Math.round(performance.now() - started),
      }),
    );
    void Promise.allSettled(
      initialResources.map((resource) => resource.data),
    ).then(() => {
      console.info(
        "mill-startup-profile-data",
        JSON.stringify({
          initialData: Math.round(performance.now() - started),
        }),
      );
    });
  }
  return (
    <PortalDataProvider
      initialResources={initialResources}
      userId={user.id}
      key={`${user.id}:${guard.workspace.workspace_id}:${guard.workspace.role}`}
      slug={guard.workspace.slug}
      workspaceId={guard.workspace.workspace_id}
      memberId={memberRow?.id ?? ""}
      role={guard.workspace.role}
    >
      <DashboardShell
        trialBanner={
          <Suspense fallback={null}>
            <WorkspaceBillingBanner
              workspaceId={guard.workspace.workspace_id}
              slug={guard.workspace.slug}
              role={guard.workspace.role}
            />
          </Suspense>
        }
        canAdministerPlatform={Boolean(platformAdministrator)}
        slug={guard.workspace.slug}
        workspaceName={guard.workspace.name}
        workspaceId={guard.workspace.workspace_id}
        memberId={memberRow?.id ?? ""}
        workspaces={membership.accessible_workspaces}
        email={user.email ?? "Signed in"}
        role={guard.workspace.role}
      >
        <PortalWorkArea>{children}</PortalWorkArea>
      </DashboardShell>
    </PortalDataProvider>
  );
}
