import { clearCache, clearAccountCache } from "./cache";
import { reusableUpload, duplicateUpload } from "../core/uploads";
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { File } from "expo-file-system";
import type { Session } from "@supabase/supabase-js";
import {
  sendOperatorMessageResultSchema,
  type AccessibleWorkspace,
  type ListAccessibleWorkspacesResult,
  type MessageItem,
} from "@site-chat/shared";
import { api, ApiError, configured, supabase } from "./client";
import { storage } from "./storage";
import { withPushRegistrationLock } from "./push-lock";
import { eligible, failedAttempt, type PendingMessage } from "../core/outbox";
import { removeLocalFile, removeAccountFiles } from "./files";

type DeliveredMessage = {
  userId: string;
  workspaceId: string;
  conversationId: string;
  message: MessageItem;
};

type Context = {
  session: Session | null;
  ready: boolean;
  workspaces: AccessibleWorkspace[];
  workspace: AccessibleWorkspace | null;
  allWebsites: boolean;
  selectAllWebsites: () => void;
  online: boolean;
  active: boolean;
  error: string;
  pending: PendingMessage[];
  delivered: DeliveredMessage[];
  revision: number;
  selectWorkspace: (id: string) => void;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
  finishAccountDeletion: (userId: string) => Promise<void>;
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
  const [allWebsites, setAllWebsites] = useState(true);
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [delivered, setDelivered] = useState<DeliveredMessage[]>([]);
  const [revision, setRevision] = useState(0);
  const items = useRef<PendingMessage[]>([]);
  const currentUser = useRef<string | null>(null);
  const busy = useRef(false);
  const deliveryAllowed = useRef(online && active);
  useEffect(() => {
    deliveryAllowed.current = online && active;
  }, [online, active]);
  const flushNow = useRef<() => Promise<void>>(async () => {});
  const writeChain = useRef(Promise.resolve());
  const hydrated = useRef(false);
  function save(change: (previous: PendingMessage[]) => PendingMessage[]) {
    const userId = currentUser.current;
    if (!userId) return Promise.reject(new Error("Your session has ended."));
    const operation = writeChain.current
      .catch(() => {})
      .then(async () => {
        if (currentUser.current !== userId) throw new Error("Your account has changed.");
        const next = change(items.current);
        // Show the queued state immediately; delivery still waits for durable storage.
        setPending(next);
        try {
          await storage.setItem(`mill.outbox.${userId}`, JSON.stringify(next));
        } catch (error) {
          if (currentUser.current === userId) setPending(items.current);
          throw error;
        }
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
      setError(e instanceof Error ? e.message : "Unable to load workspaces.");
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
        setDelivered([]);
        setWorkspaces([]);
        setSelected(null);
        setAllWebsites(true);
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
        void flushNow.current();
      })
      .catch(() => setError("Unable to restore queued messages."));
    void Promise.resolve().then(reload);
    void storage.getItem(`mill.inboxScope.${userId}`).then((scope) => {
      if (currentUser.current === userId) setAllWebsites(scope !== "workspace");
    });
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
        while (currentUser.current === userId && deliveryAllowed.current) {
          // Include messages queued while the previous delivery was in flight.
          const item = eligible(items.current, userId, Date.now())[0];
          if (!item) break;
          try {
            let response: unknown;
            if (item.file) {
              let upload = reusableUpload(item.upload, Date.now());
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
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 60000);
                try {
                  const response = await fetch(target.uploadUrl, {
                    method: "PUT",
                    headers: target.headers ?? { "Content-Type": item.file.mimeType },
                    body: await new File(item.file.uri).arrayBuffer(),
                    signal: controller.signal,
                  });
                  if (!response.ok) {
                    const payload = await response.json().catch(() => null);
                    // Finalize verifies an existing object; unrelated 400 errors must fail.
                    if (!duplicateUpload(response.status, payload))
                      throw new ApiError(
                        response.status,
                        "UPLOAD_FAILED",
                        "Unable to upload the file.",
                      );
                  }
                } finally {
                  clearTimeout(timeout);
                }
              }
              response = await api(
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
              response = await api(
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
            const acknowledged = sendOperatorMessageResultSchema.safeParse(response);
            if (acknowledged.success) {
              const message: MessageItem = {
                ...acknowledged.data.message,
                sender_type: "agent",
                sender_label: "You",
                is_internal: false,
                client_message_id: item.id,
              };
              setDelivered((previous) => [
                ...previous.filter((row) => row.message.id !== message.id).slice(-99),
                {
                  userId,
                  workspaceId: item.workspaceId,
                  conversationId: item.conversationId,
                  message,
                },
              ]);
            }
            await save((previous) => previous.filter((m) => m.id !== item.id));
            try {
              removeLocalFile(item);
            } catch {}
            setRevision((v) => v + 1);
          } catch (e) {
            if (currentUser.current !== userId) break;
            await save((previous) =>
              previous.map((m) =>
                m.id === item.id
                  ? {
                      ...failedAttempt(m, e instanceof ApiError ? e.status : 0, Date.now()),
                      error: e instanceof Error ? e.message : "No connection",
                    }
                  : m,
              ),
            );
            if (e instanceof ApiError && e.status === 401) break;
          }
        }
      } finally {
        busy.current = false;
      }
    }
    flushNow.current = flush;
    void flush();
    const timer = setInterval(() => void flush(), 1500);
    return () => clearInterval(timer);
  }, [online, active, session?.user.id]);
  const selectWorkspace = useCallback((id: string) => {
    setSelected(id);
    setAllWebsites(false);
    if (currentUser.current)
      void storage.setItem(`mill.inboxScope.${currentUser.current}`, "workspace");
  }, []);
  const selectAllWebsites = useCallback(() => {
    setAllWebsites(true);
    if (currentUser.current) void storage.setItem(`mill.inboxScope.${currentUser.current}`, "all");
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
        allWebsites,
        selectAllWebsites,
        online,
        active,
        error,
        pending,
        delivered,
        revision,
        selectWorkspace,
        reload,
        logout: () =>
          withPushRegistrationLock(async () => {
            const installationId = await storage.getItem("mill.installation");
            const registered = await storage.getItem(`mill.push.${session?.user.id}`);
            if (installationId && registered) {
              await api("unregisterPush", undefined, { installationId }, session?.user.id);
              await storage.removeItem(`mill.push.${session?.user.id}`);
              await storage.removeItem(`mill.push.scopes.${session?.user.id}`);
            }
            await writeChain.current;
            await supabase.auth.signOut({ scope: "local" });
            clearCache();
            setSession(null);
          }),
        finishAccountDeletion: (userId) =>
          withPushRegistrationLock(async () => {
            if (currentUser.current !== userId || session?.user.id !== userId)
              throw new Error("Your account has changed. Please sign in again.");
            // The server has already deleted this account and its push tokens.
            // Stop delivery before waiting for any queued storage writes.
            hydrated.current = false;
            currentUser.current = null;
            try {
              await writeChain.current.catch(() => undefined);
              let savedScopes: string[] = [];
              try {
                const value: unknown = JSON.parse(
                  (await storage.getItem(`mill.push.scopes.${userId}`)) || "[]",
                );
                if (Array.isArray(value))
                  savedScopes = value.filter((item): item is string => typeof item === "string");
              } catch {
                // Invalid old preferences must not keep a deleted account signed in.
              }
              const scopes = new Set([
                ...savedScopes,
                ...workspaces.map((company) => company.workspace_id),
              ]);
              await Promise.all(
                [
                  ...[
                    "outbox",
                    "workspace",
                    "inboxScope",
                    "push",
                    "push.scopes",
                    "push.token",
                    "push.onboarding",
                    "review",
                  ].map((key) => `mill.${key}.${userId}`),
                  ...[...scopes].flatMap((companyId) => [
                    `mill.push.sound.${userId}.${companyId}`,
                    `mill.push.preferences.${userId}.${companyId}`,
                  ]),
                ].map((key) => storage.removeItem(key)),
              );
              removeAccountFiles(userId);
              clearAccountCache(userId);
              items.current = [];
              setPending([]);
              setDelivered([]);
            } finally {
              items.current = [];
              setPending([]);
              setDelivered([]);
              clearAccountCache(userId);
              try {
                await supabase.auth.signOut({ scope: "local" });
              } finally {
                setSession(null);
              }
            }
          }),
        send: async (conversationId, body, file) => {
          if (!session || !workspace || !hydrated.current)
            throw new Error("Your session is still loading.");
          if (items.current.length >= 100)
            throw new Error("You have 100 queued messages. Wait for them to send.");
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
          void flushNow.current();
        },
        retry: async (id) => {
          await save((previous) =>
            previous.map((m) =>
              m.id === id
                ? {
                    ...m,
                    state: "queued",
                    upload: reusableUpload(m.upload, Date.now()),
                    attempts: 0,
                    nextAttempt: 0,
                    error: undefined,
                  }
                : m,
            ),
          );
          void flushNow.current();
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
