import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { File } from "expo-file-system";
import type { Session } from "@supabase/supabase-js";
import type { AccessibleWorkspace, ListAccessibleWorkspacesResult } from "@site-chat/shared";
import { api, ApiError, configured, supabase } from "./client";
import { storage } from "./storage";
import { eligible, failedAttempt, type PendingMessage } from "../core/outbox";
import { removeLocalFile } from "./files";

type Context = {
  session: Session | null;
  ready: boolean;
  workspaces: AccessibleWorkspace[];
  workspace: AccessibleWorkspace | null;
  online: boolean;
  active: boolean;
  error: string;
  pending: PendingMessage[];
  revision: number;
  selectWorkspace: (id: string) => void;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  send: (conversationId: string, body: string, file?: PendingMessage["file"]) => Promise<void>;
  retry: (id: string) => Promise<void>;
  discard: (id: string) => Promise<void>;
};
const SessionContext = createContext<Context | null>(null);
export function useMill() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("Missing session");
  return context;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!configured);
  const [workspaces, setWorkspaces] = useState<AccessibleWorkspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [revision, setRevision] = useState(0);
  const items = useRef<PendingMessage[]>([]);
  const currentUser = useRef<string | null>(null);
  const busy = useRef(false);
  const writeChain = useRef(Promise.resolve());
  const hydrated = useRef(false);
  function save(change: (previous: PendingMessage[]) => PendingMessage[]) {
    const userId = currentUser.current;
    if (!userId) return Promise.reject(new Error("Сессия завершена."));
    const operation = writeChain.current
      .catch(() => {})
      .then(async () => {
        if (currentUser.current !== userId) throw new Error("Сессия изменилась.");
        const next = change(items.current);
        await storage.setItem(`mill.outbox.${userId}`, JSON.stringify(next));
        if (currentUser.current === userId) {
          items.current = next;
          setPending(next);
        }
      });
    writeChain.current = operation;
    return operation;
  }
  const reload = useCallback(async () => {
    const userId = currentUser.current;
    if (!userId) return;
    try {
      const result = await api<ListAccessibleWorkspacesResult>("workspaces");
      if (currentUser.current !== userId) return;
      setWorkspaces(result.accessible_workspaces);
      setSelected((id) =>
        result.accessible_workspaces.some((w) => w.workspace_id === id)
          ? id
          : (result.accessible_workspaces[0]?.workspace_id ?? null),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить рабочие пространства.");
    }
  }, []);
  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, value) => {
      setSession(value);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const userId = session?.user.id ?? null;
    currentUser.current = userId;
    hydrated.current = false;
    items.current = [];
    void Promise.resolve().then(() => {
      if (currentUser.current === userId) {
        setPending([]);
        setWorkspaces([]);
        setSelected(null);
      }
    });
    if (!userId) return;
    storage
      .getItem(`mill.outbox.${userId}`)
      .then((value) => {
        if (currentUser.current !== userId) return;
        items.current = value ? JSON.parse(value) : [];
        setPending(items.current);
        hydrated.current = true;
      })
      .catch(() => setError("Не удалось восстановить очередь сообщений."));
    void Promise.resolve().then(reload);
    void storage.getItem(`mill.workspace.${userId}`).then((id) => {
      if (id && currentUser.current === userId) setSelected(id);
    });
  }, [session?.user.id, reload]);
  useEffect(() => {
    const updateNetwork = () =>
      Network.getNetworkStateAsync().then((n) =>
        setOnline(n.isInternetReachable ?? n.isConnected ?? false),
      );
    void updateNetwork();
    const network = Network.addNetworkStateListener((n) =>
      setOnline(n.isInternetReachable ?? n.isConnected ?? false),
    );
    const app = AppState.addEventListener("change", (state) => {
      const foreground = state === "active";
      setActive(foreground);
      if (foreground) {
        supabase.auth.startAutoRefresh();
        void updateNetwork();
        setRevision((v) => v + 1);
      } else supabase.auth.stopAutoRefresh();
    });
    return () => {
      network.remove();
      app.remove();
    };
  }, []);
  useEffect(() => {
    async function flush() {
      const userId = currentUser.current;
      if (!userId || !online || !active || busy.current || !hydrated.current) return;
      busy.current = true;
      try {
        for (const item of eligible(items.current, userId, Date.now())) {
          if (currentUser.current !== userId) break;
          try {
            if (item.file) {
              let upload = item.upload;
              if (!upload) {
                upload = await api<NonNullable<PendingMessage["upload"]>>(
                  "initiateUpload",
                  item.workspaceId,
                  {
                    conversationId: item.conversationId,
                    body: item.body,
                    clientMessageId: item.id,
                    files: [
                      {
                        localId: item.id,
                        filename: item.file.filename,
                        mimeType: item.file.mimeType,
                        sizeBytes: item.file.sizeBytes,
                      },
                    ],
                  },
                  userId,
                );
                if (currentUser.current !== userId) break;
                await save((previous) =>
                  previous.map((m) => (m.id === item.id ? { ...m, upload } : m)),
                );
              }
              for (const target of upload.uploads) {
                const response = await fetch(target.uploadUrl, {
                  method: "PUT",
                  headers: target.headers ?? { "Content-Type": item.file.mimeType },
                  body: await new File(item.file.uri).arrayBuffer(),
                });
                // Existing signed object after interrupted upload is validated on server finalize.
                if (!response.ok && response.status !== 409 && response.status !== 400)
                  throw new ApiError(
                    response.status,
                    "UPLOAD_FAILED",
                    "Не удалось загрузить файл.",
                  );
              }
              await api(
                "completeUpload",
                item.workspaceId,
                {
                  conversationId: item.conversationId,
                  batchId: upload.batchId,
                  uploadIds: upload.uploads.map((u) => u.uploadId),
                  body: item.body,
                  clientMessageId: item.id,
                },
                userId,
              );
            } else
              await api(
                "send",
                item.workspaceId,
                {
                  conversationId: item.conversationId,
                  body: item.body,
                  clientMessageId: item.id,
                },
                userId,
              );
            if (currentUser.current !== userId) break;
            await save((previous) => previous.filter((m) => m.id !== item.id));
            try {
              removeLocalFile(item);
            } catch {}
            setRevision((v) => v + 1);
          } catch (e) {
            if (currentUser.current !== userId) break;
            const next = {
              ...failedAttempt(item, e instanceof ApiError ? e.status : 0, Date.now()),
              error: e instanceof Error ? e.message : "Нет соединения",
            };
            await save((previous) => previous.map((m) => (m.id === item.id ? next : m)));
            if (e instanceof ApiError && e.status === 401) break;
          }
        }
      } finally {
        busy.current = false;
      }
    }
    void flush();
    const timer = setInterval(() => void flush(), 1500);
    return () => clearInterval(timer);
  }, [online, active, session?.user.id]);
  const selectWorkspace = useCallback((id: string) => {
    setSelected(id);
  }, []);
  const workspace = workspaces.find((w) => w.workspace_id === selected) ?? null;
  useEffect(() => {
    if (workspace && session)
      void storage.setItem(`mill.workspace.${session.user.id}`, workspace.workspace_id);
  }, [workspace, session]);
  useEffect(() => {
    if (!workspace || !active || !online || workspace.role === "viewer") return;
    const heartbeat = () => void api("availability", workspace.workspace_id, {}).catch(() => {});
    heartbeat();
    const timer = setInterval(heartbeat, 45000);
    return () => clearInterval(timer);
  }, [workspace, active, online]);
  return (
    <SessionContext.Provider
      value={{
        session,
        ready,
        workspaces,
        workspace,
        online,
        active,
        error,
        pending,
        revision,
        selectWorkspace,
        reload,
        logout: async () => {
          const installationId = await storage.getItem("mill.installation");
          const registered = await storage.getItem(`mill.push.${session?.user.id}`);
          if (installationId && registered) {
            await api("unregisterPush", undefined, { installationId });
            await storage.removeItem(`mill.push.${session?.user.id}`);
          }
          await writeChain.current;
          await supabase.auth.signOut({ scope: "local" });
          setSession(null);
        },
        send: async (conversationId, body, file) => {
          if (!session || !workspace || !hydrated.current)
            throw new Error("Сессия ещё загружается.");
          if (items.current.length >= 100)
            throw new Error("В очереди 100 сообщений. Дождитесь отправки.");
          await save((previous) => [
            ...previous,
            {
              id: Crypto.randomUUID(),
              userId: session.user.id,
              workspaceId: workspace.workspace_id,
              conversationId,
              body,
              file,
              createdAt: new Date().toISOString(),
              attempts: 0,
              nextAttempt: 0,
              state: "queued",
            },
          ]);
        },
        retry: async (id) => {
          await save((previous) =>
            previous.map((m) =>
              m.id === id
                ? {
                    ...m,
                    state: "queued",
                    upload: m.upload?.uploads.some(
                      (u) => u.expiresAt && Date.parse(u.expiresAt) < Date.now(),
                    )
                      ? undefined
                      : m.upload,
                    attempts: 0,
                    nextAttempt: 0,
                    error: undefined,
                  }
                : m,
            ),
          );
        },
        discard: async (id) => {
          const item = items.current.find((m) => m.id === id);
          await save((previous) => previous.filter((m) => m.id !== id));
          if (item) removeLocalFile(item);
        },
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
