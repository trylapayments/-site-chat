import { AgentProfileEditor } from "@/components/settings/AgentProfileEditor";
import { getMyAgentProfileAction } from "@/lib/agent-profile/actions";
export default async function AgentProfilePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return (
    <AgentProfileEditor
      slug={workspaceSlug}
      initial={await getMyAgentProfileAction(workspaceSlug)}
    />
  );
}
