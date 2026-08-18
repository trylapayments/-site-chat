/**
 * Generation guard for Global Search palette requests.
 * Server Actions are not abortable; bumping generation drops stale responses.
 */

export type GlobalSearchRequestToken = {
  requestId: number;
  workspaceSlug: string;
};

export type GlobalSearchRequestGuard = {
  begin: (workspaceSlug: string) => GlobalSearchRequestToken;
  isCurrent: (token: GlobalSearchRequestToken) => boolean;
  invalidate: () => void;
  resetWorkspace: (workspaceSlug: string) => void;
  current: () => GlobalSearchRequestToken | null;
};

export function createGlobalSearchRequestGuard(): GlobalSearchRequestGuard {
  let latestRequestId = 0;
  let activeWorkspaceSlug: string | null = null;

  return {
    begin(workspaceSlug: string): GlobalSearchRequestToken {
      latestRequestId += 1;
      activeWorkspaceSlug = workspaceSlug;
      return { requestId: latestRequestId, workspaceSlug };
    },
    isCurrent(token: GlobalSearchRequestToken): boolean {
      return (
        token.requestId === latestRequestId &&
        token.workspaceSlug === activeWorkspaceSlug
      );
    },
    invalidate(): void {
      latestRequestId += 1;
    },
    resetWorkspace(workspaceSlug: string): void {
      latestRequestId += 1;
      activeWorkspaceSlug = workspaceSlug;
    },
    current(): GlobalSearchRequestToken | null {
      if (!activeWorkspaceSlug || latestRequestId === 0) {
        return null;
      }
      return {
        requestId: latestRequestId,
        workspaceSlug: activeWorkspaceSlug,
      };
    },
  };
}
