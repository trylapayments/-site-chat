import { getWorkspaceContext } from "@/lib/workspace/redirect.server";
import { selectWorkspaceAction } from "@/lib/workspace/actions";
import { redirect } from "next/navigation";
import { toAppRoute } from "@/lib/auth/redirect";
import { Button } from "@/components/ui/button";

export default async function SelectWorkspacePage() {
  const { membership, lastWorkspaceId } = await getWorkspaceContext();

  if (membership.accessible_workspaces.length <= 1) {
    redirect(toAppRoute("/app"));
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Select a workspace
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl text-base">
          Choose which workspace you want to open.
        </p>
      </div>

      <div className="grid gap-3">
        {membership.accessible_workspaces.map((workspace) => (
          <form key={workspace.workspace_id} action={selectWorkspaceAction}>
            <input
              type="hidden"
              name="workspaceId"
              value={workspace.workspace_id}
            />
            <Button
              type="submit"
              variant={
                workspace.workspace_id === lastWorkspaceId
                  ? "default"
                  : "outline"
              }
              className="h-auto w-full justify-start px-4 py-4 text-left"
            >
              <span>
                <span className="block font-medium">{workspace.name}</span>
                <span className="text-muted-foreground block text-sm">
                  /app/{workspace.slug} · {workspace.role}
                </span>
              </span>
            </Button>
          </form>
        ))}
      </div>
    </div>
  );
}
