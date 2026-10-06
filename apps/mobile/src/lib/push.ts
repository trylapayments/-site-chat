import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { router } from "expo-router";
import { api, supabase } from "./client";
import { storage } from "./storage";
import { withPushRegistrationLock } from "./push-lock";
import { useMill } from "./session";
import { pushDestination } from "../core/outbox";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
export async function pushWorkspaces(userId: string): Promise<string[]> {
  try {
    return JSON.parse((await storage.getItem(`mill.push.scopes.${userId}`)) || "[]");
  } catch {
    return [];
  }
}
async function registerToken(workspaceId: string, userId: string, token: string) {
  return withPushRegistrationLock(async () => {
    let installationId = await storage.getItem("mill.installation");
    if (!installationId) {
      installationId = Crypto.randomUUID();
      await storage.setItem("mill.installation", installationId);
    }
    await api("registerPush", workspaceId, { token, installationId }, userId);
    await storage.setItem(`mill.push.${userId}`, "registered");
    const scopes = await pushWorkspaces(userId);
    await storage.setItem(
      `mill.push.scopes.${userId}`,
      JSON.stringify([...new Set([...scopes, workspaceId])]),
    );
  });
}
export async function registerPush(workspaceId: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const userId = data.session.user.id;
  if (!Device.isDevice || Platform.OS === "web")
    throw new Error("Push notifications are available on a physical iPhone.");
  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Notifications are not configured yet.");
  const permission = await Notifications.requestPermissionsAsync();
  if (
    !permission.granted &&
    permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error("Allow notifications for Mill in your iPhone settings.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerToken(workspaceId, userId, token);
}
export function usePushNavigation() {
  const { session, workspaces, selectWorkspace, active, online } = useMill();
  useEffect(() => {
    if (!session || !Device.isDevice || Platform.OS === "web" || !active || !online) return;
    let cancelled = false;
    let refreshing = false;
    const userId = session.user.id;
    async function refreshToken() {
      if (refreshing) return;
      refreshing = true;
      try {
        const scopes = (await pushWorkspaces(userId)).filter((id) =>
          workspaces.some((workspace) => workspace.workspace_id === id),
        );
        if (!scopes.length || cancelled) return;
        const permission = await Notifications.getPermissionsAsync();
        if (
          !permission.granted &&
          permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
        )
          return;
        const projectId =
          Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) return;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        for (const workspaceId of scopes) {
          if (cancelled) return;
          await registerToken(workspaceId, userId, token);
        }
      } catch {
        /* Retry on next foreground/network restoration; never request permission here. */
      } finally {
        refreshing = false;
      }
    }
    void refreshToken();
    const listener = Notifications.addPushTokenListener(() => void refreshToken());
    return () => {
      cancelled = true;
      listener.remove();
    };
  }, [session, workspaces, active, online]);
  const consumed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!session || Platform.OS === "web") return;
    function navigate(response: Notifications.NotificationResponse | null) {
      if (!response || consumed.current === response.notification.request.identifier) return;
      const target = pushDestination(response.notification.request.content.data);
      if (!target || !workspaces.some((w) => w.workspace_id === target.workspaceId)) return;
      consumed.current = response.notification.request.identifier;
      selectWorkspace(target.workspaceId);
      router.push({
        pathname: "/chat/[id]",
        params: { id: target.conversationId, workspaceId: target.workspaceId },
      });
    }
    void Notifications.getLastNotificationResponseAsync().then(navigate);
    const listener = Notifications.addNotificationResponseReceivedListener(navigate);
    return () => listener.remove();
  }, [session, workspaces, selectWorkspace]);
}
