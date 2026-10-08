import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { workspaceInboxesResultSchema, type AccessibleWorkspace } from "@site-chat/shared";
import { api } from "./client";
import { useMill } from "./session";
import { startPolling } from "../core/poll";
export type CompanyInbox = AccessibleWorkspace & { member_id: string; unread_total: number };
export function useCompanyInboxes() {
  const { session, active, online } = useMill();
  const userId = session?.user.id;
  const [result, setResult] = useState<{ userId: string; workspaces: CompanyInbox[] } | null>(null);
  const refresh = useCallback(async () => {
    if (!userId || !active || !online) return;
    const value = await api<{ workspaces: CompanyInbox[] }>(
      "workspaceInboxes",
      undefined,
      {},
      userId,
    );
    setResult({ userId, workspaces: workspaceInboxesResultSchema.parse(value).workspaces });
  }, [userId, active, online]);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const stop = startPolling(async () => {
        if (!userId || !active || !online) return;
        try {
          const value = await api<{ workspaces: CompanyInbox[] }>(
            "workspaceInboxes",
            undefined,
            {},
            userId,
          );
          if (!cancelled) setResult({ userId, workspaces: workspaceInboxesResultSchema.parse(value).workspaces });
        } catch {
          /* Retain the last badge counts through a transient disconnection. */
        }
      }, 5000);
      return () => {
        cancelled = true;
        stop();
      };
    }, [userId, active, online]),
  );
  return { companies: result && result.userId === userId ? result.workspaces : [], refresh };
}
