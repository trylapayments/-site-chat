import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { router } from "expo-router";
import { api, supabase } from "./client";
import { storage } from "./storage";
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
export async function registerPush(workspaceId: string) {
  if (!Device.isDevice || Platform.OS === "web")
    throw new Error("Push проверяется на физическом iPhone в сборке приложения.");
  const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Сначала привяжите приложение к Expo EAS.");
  const permission = await Notifications.requestPermissionsAsync();
  if (
    !permission.granted &&
    permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL
  )
    throw new Error("Разрешите уведомления для Mill в настройках iPhone.");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  let installationId = await storage.getItem("mill.installation");
  if (!installationId) {
    installationId = Crypto.randomUUID();
    await storage.setItem("mill.installation", installationId);
  }
  await api("registerPush", workspaceId, { token, installationId });
  const { data } = await supabase.auth.getSession();
  if (data.session) await storage.setItem(`mill.push.${data.session.user.id}`, "registered");
}
export function usePushNavigation() {
  const { session, workspaces, selectWorkspace } = useMill();
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
