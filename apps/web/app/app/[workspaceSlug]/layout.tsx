import { notFound, redirect } from "next/navigation";

import { getWorkspaceContext } from "@/lib/workspace/redirect.server";
import { resolveWorkspaceBySlug } from "@/lib/workspace/guards";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { toAppRoute } from "@/lib/auth/redirect";

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

  const membership = (await getWorkspaceContext()).membership;
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

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <p className="text-sm font-semibold">{guard.workspace.name}</p>
        <p className="text-muted-foreground text-sm">/{guard.workspace.slug}</p>
      </div>
      {children}
    </div>
  );
}
