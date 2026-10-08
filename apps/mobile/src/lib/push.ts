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
import { pushPolicy, visitorPushDestination, type PushContext } from "../core/outbox";
import { runPushOnboarding, startPushOnboarding } from "../core/push-consent";
import { getMobileCapabilities } from "./capabilities";

const onboarding = new Set<string>();
let pushContext: PushContext = {
  userId: null,
  workspaceIds: [],
  activeChat: null,
};
export function focusPushConversation(workspaceId: string, conversationId: string) {
  const chat = { workspaceId, conversationId };
  pushContext.activeChat = chat;
  return () => {
    if (pushContext.activeChat === chat) pushContext.activeChat = null;
  };
}
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    if (
      notification.request.trigger === null &&
      notification.request.content.data?.previewUserId === pushContext.userId
    )
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: true,
        shouldSetBadge: false,
      };
    const data = notification.request.content.data ?? {};
    const visitorAllowed = !!visitorPushDestination(data, pushContext);
    const { show: chatShow } = pushPolicy(data, pushContext);
    const show = visitorAllowed || chatShow;
    return {
      shouldShowBanner: show,
      shouldShowList: show,
      shouldPlaySound: show && !!notification.request.content.sound,
      shouldSetBadge: false,
    };
  },
});
export async function pushWorkspaces(userId: string): Promise<string[]> {
  try {
    return JSON.parse((await storage.getItem(`mill.push.scopes.${userId}`)) || "[]");
  } catch {
    return [];
  }
}
export type PushSoundMode = "mill" | "voice" | "silent" | "system";
export const voiceAlertsAvailable = Constants.expoConfig?.extra?.voiceAlertsAvailable === true;
export async function getPushSound(userId: string, workspaceId: string): Promise<PushSoundMode> {
  const value = await storage.getItem(`mill.push.sound.${userId}.${workspaceId}`);
  if (value === "silent" || value === "system" || value === "mill") return value;
  return voiceAlertsAvailable ? "voice" : "mill";
}
export async function changePushSound(workspaceId: string, soundMode: PushSoundMode) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  if (soundMode === "voice" && !voiceAlertsAvailable)
    throw new Error("Voice alerts will be available in the next build.");
  const userId = data.session.user.id;
  if ((await pushWorkspaces(userId)).includes(workspaceId)) {
    const token = await storage.getItem(`mill.push.token.${userId}`);
    if (token) await registerToken(workspaceId, userId, token, soundMode);
    else await registerPush(workspaceId, soundMode);
  } else await storage.setItem(`mill.push.sound.${userId}.${workspaceId}`, soundMode);
}
async function registerToken(
  workspaceId: string,
  userId: string,
  token: string,
  requestedSound?: PushSoundMode,
  refreshOnly = false,
  requestedPreferences?: PushPreferences,
) {
  return withPushRegistrationLock(async () => {
    // Re-read inside the lock: disabling can finish while token refresh awaits iOS.
    if (refreshOnly && !(await pushWorkspaces(userId)).includes(workspaceId)) return;
    let installationId = await storage.getItem("mill.installation");
    if (!installationId) {
      installationId = Crypto.randomUUID();
      await storage.setItem("mill.installation", installationId);
    }
    const soundMode = requestedSound ?? (await getPushSound(userId, workspaceId));
    const preferences =
      requestedPreferences ?? (await readSavedPushPreferences(userId, workspaceId));
    await api(
      "registerPush",
      workspaceId,
      { token, installationId, soundMode, ...(preferences ?? {}) },
      userId,
    );
    await storage.setItem(`mill.push.token.${userId}`, token);
    if (preferences)
      await storage.setItem(
        `mill.push.preferences.${userId}.${workspaceId}`,
        JSON.stringify(preferences),
      );
    await storage.setItem(`mill.push.sound.${userId}.${workspaceId}`, soundMode);
    await storage.setItem(`mill.push.${userId}`, "registered");
    const scopes = await pushWorkspaces(userId);
    await storage.setItem(
      `mill.push.scopes.${userId}`,
      JSON.stringify([...new Set([...scopes, workspaceId])]),
    );
  });
}
export async function disablePush(workspaceId: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const userId = data.session.user.id;
  await withPushRegistrationLock(async () => {
    const installationId = await storage.getItem("mill.installation");
    if (installationId) await api("unregisterPush", workspaceId, { installationId }, userId);
    const remaining = (await pushWorkspaces(userId)).filter((id) => id !== workspaceId);
    await storage.setItem(`mill.push.scopes.${userId}`, JSON.stringify(remaining));
    if (!remaining.length) await storage.removeItem(`mill.push.${userId}`);
  });
}
export async function requestPushPermission() {
  let permission = await Notifications.getPermissionsAsync();
  if (
    permission.status === "undetermined" ||
    permission.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED
  ) {
    permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
  }
  return permission;
}
export async function registerPush(
  workspaceId: string,
  soundMode?: PushSoundMode,
  expectedUserId?: string,
) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const userId = data.session.user.id;
  if (expectedUserId && data.session.user.id !== expectedUserId)
    throw new Error("Account changed. Please try again.");
  if (!Device.isDevice || Platform.OS === "web")
    throw new Error("Push notifications are available on a physical iPhone.");

  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Notifications are not configured yet.");
  if (Platform.OS === "android") {
    const mode = soundMode ?? (await getPushSound(userId, workspaceId));
    await Notifications.setNotificationChannelAsync(`mill-conversations-${mode}`, {
      name: "Conversations",
      importance: Notifications.AndroidImportance.HIGH,
      sound:
        mode === "silent"
          ? null
          : mode === "system"
            ? "default"
            : mode === "voice"
              ? "mill-voice-message.wav"
              : "mill-message.wav",
    });
  }
  const permission = await requestPushPermission();
  if (
    !permission.granted &&
    permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error("Allow notifications for Mill in your iPhone settings.");
  if (!(await getMobileCapabilities(userId)).push)
    throw new Error(
      "Push notifications are not available yet. Your iPhone permission is saved; try again shortly.",
    );
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerToken(workspaceId, userId, token, soundMode);
}
export function usePushNavigation() {
  const { session, workspace, workspaces, selectWorkspace, active, online } = useMill();
  useEffect(() => {
    if (!session || !workspace || !active || !online || !Device.isDevice || Platform.OS === "web")
      return;
    let cancelled = false;
    const userId = session.user.id;
    const stop = startPushOnboarding(async () => {
      const key = `mill.push.onboarding.${userId}`;
      if (onboarding.has(userId)) return "retry";
      onboarding.add(userId);
      try {
        return await runPushOnboarding({
          permission: async () => {
            const value = await Notifications.getPermissionsAsync();
            return {
              undetermined:
                value.status === "undetermined" ||
                value.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED,
              denied: value.status === "denied",
            };
          },
          marker: () => storage.getItem(key),
          register: () => registerPush(workspace.workspace_id, undefined, userId),
          remember: (state) => storage.setItem(key, state),
          clear: () => storage.removeItem(key),
          cancelled: () => cancelled,
        });
      } finally {
        onboarding.delete(userId);
      }
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [session, workspace, active, online]);
  useEffect(() => {
    pushContext.userId = session?.user.id ?? null;
    pushContext.workspaceIds = session ? workspaces.map((w) => w.workspace_id) : [];
    if (!session) pushContext.activeChat = null;
  }, [session, workspaces]);
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
          await registerToken(workspaceId, userId, token, undefined, true);
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
      const payload = response.notification.request.content.data ?? {};
      const visitor = visitorPushDestination(payload, pushContext);
      if (visitor && workspaces.some((w) => w.workspace_id === visitor.workspaceId)) {
        consumed.current = response.notification.request.identifier;
        selectWorkspace(visitor.workspaceId);
        router.push("/visitors");
        return;
      }
      const { target } = pushPolicy(response.notification.request.content.data, pushContext);
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

export type PushPreferences = {
  pushNewChat: boolean;
  pushNewVisitor: boolean;
  pushMessages: boolean;
};
const defaultPushPreferences: PushPreferences = {
  pushNewChat: true,
  pushNewVisitor: false,
  pushMessages: true,
};
async function readSavedPushPreferences(
  userId: string,
  workspaceId: string,
): Promise<PushPreferences | undefined> {
  try {
    const value = JSON.parse(
      (await storage.getItem(`mill.push.preferences.${userId}.${workspaceId}`)) || "null",
    );
    if (
      value &&
      ["pushNewChat", "pushNewVisitor", "pushMessages"].every((k) => typeof value[k] === "boolean")
    )
      return value;
  } catch {}
  return;
}
export async function getPushPreferences(userId: string, workspaceId: string) {
  return withPushRegistrationLock(async () => {
    const saved = (await readSavedPushPreferences(userId, workspaceId)) ?? defaultPushPreferences;
    if (!(await pushWorkspaces(userId)).includes(workspaceId)) return saved;
    const installationId = await storage.getItem("mill.installation");
    if (!installationId) return saved;
    try {
      const preferences = await api<PushPreferences>(
        "pushPreferences",
        workspaceId,
        { installationId },
        userId,
      );
      await storage.setItem(
        `mill.push.preferences.${userId}.${workspaceId}`,
        JSON.stringify(preferences),
      );
      return preferences;
    } catch {
      // Preserve the last known settings while offline; registration retries later.
      return saved;
    }
  });
}
export async function changePushPreferences(workspaceId: string, preferences: PushPreferences) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const userId = data.session.user.id;
  const token = await storage.getItem(`mill.push.token.${userId}`);
  if (token && (await pushWorkspaces(userId)).includes(workspaceId))
    await registerToken(workspaceId, userId, token, undefined, false, preferences);
  else
    await storage.setItem(
      `mill.push.preferences.${userId}.${workspaceId}`,
      JSON.stringify(preferences),
    );
}
export async function previewSystemSound(userId: string) {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("Enable notifications to preview the iPhone alert.");
  await Notifications.scheduleNotificationAsync({
    content: { title: "Mill", sound: "default", data: { previewUserId: userId } },
    trigger: null,
  });
}
