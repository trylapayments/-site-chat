import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { api } from "./client";
import { startPolling } from "../core/poll";
import { useMill } from "./session";
import { cacheKey, cached, remember } from "./cache";
export function useDirectory<T>(operation: string, input: unknown, interval?: number, allWorkspaces = false) {
  const { session, workspace, online, active } = useMill();
  const userId = session?.user.id;
  const workspaceId = allWorkspaces ? undefined : workspace?.workspace_id;
  const key =
    session && (allWorkspaces || workspace)
      ? cacheKey(
          session.user.id,
          allWorkspaces ? "all-websites" : workspace!.workspace_id,
          `${operation === "contacts" ? "contacts:saved-v1" : operation}:${JSON.stringify(input)}`,
        )
      : "";
  const [result, setResult] = useState<{ key: string; data: T }>();
  const [loading, setLoading] = useState(false);
  const [settledKey, setSettledKey] = useState("");
  const [error, setError] = useState("");
  const serial = useRef(0);
  const currentKey = useRef(key);
  useEffect(() => {
    currentKey.current = key;
  }, [key]);
  const inputRef = useRef(input);
  useEffect(() => {
    inputRef.current = input;
  }, [input]);
  const refresh = useCallback(async () => {
    if (!key || (!allWorkspaces && !workspaceId) || !userId || !online || !active) return;
    const sequence = ++serial.current;
    setLoading(true);
    try {
      const data = await api<T>(operation, workspaceId, inputRef.current, userId);
      if (sequence === serial.current && currentKey.current === key) {
        remember(key, data);
        setResult({ key, data });
        setError("");
      }
    } catch (e) {
      if (sequence === serial.current && currentKey.current === key)
        setError(e instanceof Error ? e.message : "Unable to load. Pull down to retry.");
    } finally {
      if (sequence === serial.current) {
        setLoading(false);
        setSettledKey(key);
      }
    }
  }, [key, workspaceId, userId, online, active, operation, allWorkspaces]);
  useEffect(() => {
    const data = cached<T>(key);
    void Promise.resolve().then(() => {
      if (currentKey.current === key) {
        setResult(data ? { key, data } : undefined);
        setError("");
      }
    });
  }, [key]);
  useFocusEffect(
    useCallback(() => {
      const stop = startPolling(refresh, interval);
      return () => {
        stop();
        serial.current++;
      };
    }, [refresh, interval]),
  );
  const data = result?.key === key ? result.data : cached<T>(key);
  const initialLoading = !!key && !data && settledKey !== key && online && active;
  return { data, loading: online && active && (loading || initialLoading), error, refresh };
}
