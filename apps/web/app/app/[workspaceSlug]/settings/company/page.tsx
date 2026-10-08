import { DeleteCompany } from "@/components/settings/DeleteCompany";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { CompanyProfileEditor } from "@/components/settings/CompanyProfileEditor";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { createClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { companyProfileSchema } from "@/lib/company/schema";
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const { data, error } = await callPublicRpc(
    await createClient(),
    "get_workspace_company",
    { p_workspace_id: workspace.workspace_id },
  );
  if (error) throw new Error("Unable to load company details.");
  return (
    <div className="space-y-6" data-testid="company-page">
      <PageHeader
        title="Company"
        description="Manage the details of the company behind this workspace."
      />
      <CompanyProfileEditor
        slug={workspaceSlug}
        initial={companyProfileSchema.parse(data)}
        canManage={["owner", "admin"].includes(workspace.role)}
      />
      {workspace.role==="owner" ? <DeleteCompany slug={workspaceSlug} name={workspace.name} /> : null}
    </div>
  );
}
