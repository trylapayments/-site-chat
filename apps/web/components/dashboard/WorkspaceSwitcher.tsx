"use client";

import type { AccessibleWorkspace } from "@site-chat/shared";

import { switchWorkspaceAction } from "@/lib/workspace/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher({
  workspaces,
  currentWorkspaceId,
  currentPath,
}: {
  workspaces: AccessibleWorkspace[];
  currentWorkspaceId: string;
  currentPath: string;
}) {
  const currentWorkspace = workspaces.find(
    (workspace) => workspace.workspace_id === currentWorkspaceId,
  );

  if (workspaces.length <= 1) {
    return (
      <div className="max-w-[12rem] truncate text-sm font-medium">
        {currentWorkspace?.name ?? "Workspace"}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[12rem] justify-start truncate"
          aria-label="Switch workspace"
        >
          <span className="truncate">
            {currentWorkspace?.name ?? "Workspace"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.workspace_id} asChild>
            <form action={switchWorkspaceAction} className="w-full">
              <input
                type="hidden"
                name="workspaceId"
                value={workspace.workspace_id}
              />
              <input type="hidden" name="currentPath" value={currentPath} />
              <button type="submit" className="w-full cursor-pointer text-left">
                <span className="block truncate font-medium">
                  {workspace.name}
                </span>
                <span className="text-muted-foreground block truncate text-xs">
                  /app/{workspace.slug}
                </span>
              </button>
            </form>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
