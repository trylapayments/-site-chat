"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { afterPortalReady } from "@/lib/portal/startup";
import {
  recordPortalMounted,
  recordStartupStage,
} from "@/lib/performance/interactions";
import type { MemberRole } from "@site-chat/shared";
import {
  createResourceStore,
  type ResourceSnapshot,
} from "@/lib/portal/resource-store";
import { createClient } from "@/lib/supabase/client";
type Workspace = {
  userId: string;
  slug: string;
  workspaceId: string;
  memberId: string;
  role: MemberRole;
};
const Context = createContext<
  (Workspace & { store: ReturnType<typeof createResourceStore> }) | null
>(null);
export function PortalDataProvider({
  children,
  initialResources = [],
  ...workspace
}: Workspace & {
  children: React.ReactNode;
  initialResources?: { resource: string; data: Promise<unknown> }[];
}) {
  const [store] = useState(() => {
    const resources = createResourceStore();
    for (const initial of initialResources)
      resources.prime(
        `/api/portal/${encodeURIComponent(workspace.slug)}/${initial.resource}`,
        Promise.resolve(initial.data).then((data) => {
          recordStartupStage(
            data === undefined
              ? "Initial data unavailable"
              : "Initial data ready",
          );
          return data;
        }),
      );
    return resources;
  });
  useEffect(() => {
    recordPortalMounted();
    const {
      data: { subscription },
    } = createClient().auth.onAuthStateChange((event, session) => {
      if (
        event === "SIGNED_OUT" ||
        (session?.user && session.user.id !== workspace.userId)
      )
        store.clear();
    });
    return () => {
      subscription.unsubscribe();
      store.clear();
    };
  }, [store, workspace.userId]);
  useEffect(() => {
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection;
    if (connection?.saveData) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const stopWaiting = afterPortalReady(() => {
      timers = ["overview", "inbox", "visitors", "visitor-settings"].map(
        (resource, index) =>
          setTimeout(
            () => {
              if (document.visibilityState === "visible") {
                const key = `/api/portal/${encodeURIComponent(workspace.slug)}/${resource}`;
                if (store.snapshot(key).data === undefined)
                  void store.refresh(key);
              }
            },
            1000 + index * 300,
          ),
      );
    });
    return () => {
      stopWaiting();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [store, workspace.slug]);
  return (
    <Context.Provider value={{ ...workspace, store }}>
      {children}
    </Context.Provider>
  );
}
export function usePortalWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error("Workspace context missing");
  return context;
}
export function usePortalResource<T>(
  resource: string,
  intervalMs = 30000,
): ResourceSnapshot<T> & { refresh: () => Promise<void> } {
  const { store, slug } = usePortalWorkspace();
  const key = `/api/portal/${encodeURIComponent(slug)}/${resource}`;
  const state = useSyncExternalStore(
    store.subscribe,
    () => store.snapshot<T>(key),
    () => store.serverSnapshot<T>(),
  );
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh(key);
    };
    refresh();
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer =
      intervalMs > 0 ? window.setInterval(refresh, intervalMs) : null;
    return () => {
      if (timer !== null) clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key, store, intervalMs]);
  return { ...state, refresh: () => store.refresh(key) };
}

export function useOptionalPortalWorkspace() {
  return useContext(Context);
}
