import { useEffect, useRef } from "react";
import { supabase } from "./client";
import { useMill } from "./session";

export function useRealtime(
  workspaceId: string | undefined,
  refresh: () => void,
  conversationId?: string,
  workspaceIds?: string[],
) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  const { active, online, revision } = useMill();
  const scopeKey = workspaceIds?.join(",") ?? workspaceId;
  useEffect(() => {
    if (!scopeKey || !active || !online) return;
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!cancelled) callback.current();
      }, 150);
    };
    const channel = supabase.channel(`mobile:${scopeKey}:${Math.random()}`);
    for (const scopedWorkspaceId of scopeKey.split(",")) {
      for (const table of [
        "messages",
        "conversations",
        "conversation_member_reads",
        "internal_notes",
      ]) {
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: conversationId
              ? `${table === "conversations" ? "id" : "conversation_id"}=eq.${conversationId}`
              : `workspace_id=eq.${scopedWorkspaceId}`,
          },
          invalidate,
        );
      }
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") invalidate();
    });
    // Reconcile from the source of truth even when CDC was missed or disconnected.
    const timer = setInterval(invalidate, 15000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [scopeKey, active, online, conversationId]);
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    callback.current();
  }, [revision]);
}
