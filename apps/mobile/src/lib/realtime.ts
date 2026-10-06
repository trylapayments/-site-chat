import { useEffect, useRef } from "react";
import { supabase } from "./client";
import { useMill } from "./session";

export function useRealtime(workspaceId: string | undefined, refresh: () => void) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  const { active, online, revision } = useMill();
  useEffect(() => {
    if (!workspaceId || !active || !online) return;
    let cancelled = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (!cancelled) callback.current();
      }, 150);
    };
    const channel = supabase.channel(`mobile:${workspaceId}:${Math.random()}`);
    for (const table of [
      "messages",
      "conversations",
      "conversation_member_reads",
      "internal_notes",
    ]) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` },
        invalidate,
      );
    }
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") invalidate();
    });
    // Reconcile from the source of truth even when CDC was missed or disconnected.
    const timer = setInterval(invalidate, 15000);
    invalidate();
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [workspaceId, active, online]);
  useEffect(() => {
    callback.current();
  }, [revision]);
}
