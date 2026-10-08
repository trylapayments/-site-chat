import React, { useEffect, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { NotificationPreferences } from "@site-chat/shared";
import { Button, ErrorBanner, useTheme } from "../components/ui";
import { useMill } from "../lib/session";
import { api } from "../lib/client";
import { alertSound, type AlertEvent } from "../core/alert-sound";
import {
  changePushPreferences,
  changePushSound,
  disablePush,
  getPushPreferences,
  getPushSound,
  previewSystemSound,
  voiceAlertsAvailable,
  pushWorkspaces,
  registerPush,
  type PushPreferences,
  type PushSoundMode,
} from "../lib/push";
export default function NotificationsSettings() {
  const { session, workspace } = useMill();
  return <NotificationsSettingsContent key={`${session?.user.id}:${workspace?.workspace_id}`} />;
}
function NotificationsSettingsContent() {
  const { colors, styles } = useTheme();
  const { session, workspace, online, active } = useMill();
  const [permission, setPermission] = useState<Notifications.NotificationPermissionsStatus | null>(
    null,
  );
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Notifications.getPermissionsAsync()
      .then((result) => {
        if (!cancelled) setPermission(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active]);
  const [enabled, setEnabled] = useState(false);
  const [preferences, setPreferences] = useState<PushPreferences>({
    pushNewChat: true,
    pushNewVisitor: false,
    pushMessages: true,
  });
  const [email, setEmail] = useState<boolean>();
  const [sound, setSound] = useState<PushSoundMode>(voiceAlertsAvailable ? "voice" : "mill");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [preferencesLoading, setPreferencesLoading] = useState(true);
  const chatPlayer = useAudioPlayer(require("../../assets/sounds/mill-conversation.wav"));
  const messagePlayer = useAudioPlayer(require("../../assets/sounds/mill-message.wav"));
  const voiceChatPlayer = useAudioPlayer(
    require("../../assets/sounds/mill-voice-conversation.wav"),
  );
  const voiceVisitorPlayer = useAudioPlayer(require("../../assets/sounds/mill-voice-visitor.wav"));
  const identity = `${session?.user.id}:${workspace?.workspace_id}`;
  const current = useRef(identity);
  useEffect(() => {
    current.current = identity;
  }, [identity]);
  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: false }).catch(
      () => {},
    );
  }, []);
  useEffect(() => {
    if (!session || !workspace) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setEmail(undefined);
        setEnabled(false);
        setError("");
        setSaving(false);
      }
    });
    void Promise.all([
      pushWorkspaces(session.user.id),
      getPushPreferences(session.user.id, workspace.workspace_id),
      getPushSound(session.user.id, workspace.workspace_id),
    ])
      .then(([scopes, prefs, mode]) => {
        if (!cancelled) {
          setEnabled(scopes.includes(workspace.workspace_id));
          setPreferences(prefs);
          setSound(mode);
          setPreferencesLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setPreferencesLoading(false);
        }
      });
    void api<NotificationPreferences>(
      "notificationPreferences",
      workspace.workspace_id,
      {},
      session.user.id,
    )
      .then((p) => {
        if (!cancelled) setEmail(p.email_conversation_new);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [session, workspace]);
  async function update(action: () => Promise<unknown>, rollback: () => void) {
    const key = current.current;
    setSaving(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (current.current !== key) return;
      rollback();
      setError(e instanceof Error ? e.message : "Unable to save notification settings.");
    } finally {
      if (current.current === key) setSaving(false);
    }
  }
  function togglePreference(key: keyof PushPreferences, value: boolean) {
    if (!workspace) return;
    const old = preferences;
    const next = { ...old, [key]: value };
    setPreferences(next);
    void update(
      () => changePushPreferences(workspace.workspace_id, next),
      () => setPreferences(old),
    );
  }
  function stopPreviews() {
    chatPlayer.pause();
    messagePlayer.pause();
    voiceChatPlayer.pause();
    voiceVisitorPlayer.pause();
  }
  async function preview(which: AlertEvent) {
    try {
      stopPreviews();
      const selectedSound = alertSound(sound, which);
      if (!selectedSound) {
        setError("");
        return;
      }
      if (selectedSound === "default") {
        if (session) await previewSystemSound(session.user.id);
        setError("");
        return;
      }
      const player = {
        "mill-message.wav": messagePlayer,
        "mill-conversation.wav": chatPlayer,
        "mill-voice-message.wav": messagePlayer,
        "mill-voice-conversation.wav": voiceChatPlayer,
        "mill-voice-visitor.wav": voiceVisitorPlayer,
      }[selectedSound];
      await player.seekTo(0);
      player.play();
      setError("");
    } catch {
      setError("Unable to play the preview.");
    }
  }
  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.row, { justifyContent: "space-between", padding: 22 }]}>
        <Text style={styles.heading}>Notification Center</Text>
        <Pressable accessibilityLabel="Done" onPress={() => router.back()}>
          <Text style={{ color: colors.blue, padding: 10 }}>Done</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 20 }}>
        <ErrorBanner message={error} />
        {permission &&
          (!permission.granted ||
            permission.ios?.allowsAlert === false ||
            permission.ios?.allowsSound === false) && (
            <View style={[styles.card, { padding: 16, gap: 10 }]}>
              <Text style={{ color: colors.ink, fontWeight: "700" }}>
                Check iPhone notification settings
              </Text>
              <Text style={styles.caption}>
                {!permission.granted
                  ? "Mill notifications are not fully enabled in iPhone settings."
                  : "Banners or sounds are disabled in iPhone settings."}
              </Text>
              {(permission.status === "undetermined" ||
                permission.ios?.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED) &&
                workspace && (
                  <Button
                    title="Enable notifications"
                    disabled={saving || !online}
                    onPress={() =>
                      void update(
                        async () => {
                          await registerPush(workspace.workspace_id, undefined, session?.user.id);
                          setEnabled(true);
                          setPermission(await Notifications.getPermissionsAsync());
                        },
                        () => {},
                      )
                    }
                  />
                )}
              <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}>
                <Text style={{ color: colors.blue, paddingVertical: 8 }}>Open iPhone settings</Text>
              </Pressable>
            </View>
          )}
        <View style={[styles.card, { gap: 6 }]}>
          <NotificationToggle
            title="Push notifications"
            detail="Receive updates on this iPhone."
            value={enabled}
            disabled={saving || preferencesLoading || !online}
            onChange={(value) => {
              if (!workspace) return;
              setEnabled(value);
              void update(
                () =>
                  value
                    ? registerPush(workspace.workspace_id, undefined, session?.user.id)
                    : disablePush(workspace.workspace_id),
                () => setEnabled(!value),
              );
            }}
          />
          <NotificationToggle
            title="New chats"
            detail="When a conversation needs your team."
            value={preferences.pushNewChat}
            disabled={!enabled || preferencesLoading || saving || !online}
            onChange={(value) => togglePreference("pushNewChat", value)}
          />
          <NotificationToggle
            title="New messages"
            detail="Replies, assignments and mentions."
            value={preferences.pushMessages}
            disabled={!enabled || preferencesLoading || saving || !online}
            onChange={(value) => togglePreference("pushMessages", value)}
          />
          <NotificationToggle
            title="New visitors"
            detail="When someone arrives on your website."
            value={preferences.pushNewVisitor}
            disabled={!enabled || preferencesLoading || saving || !online}
            onChange={(value) => togglePreference("pushNewVisitor", value)}
          />
          <Pressable onPress={() => void Linking.openSettings()}>
            <Text style={{ color: colors.blue, paddingVertical: 8 }}>
              Open iPhone notification settings
            </Text>
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Email</Text>
          <NotificationToggle
            title="New chat emails"
            detail="Turn off if you prefer push notifications only."
            value={email ?? false}
            disabled={email === undefined || saving || !online}
            onChange={(value) => {
              if (!workspace || !session) return;
              const old = email;
              const key = identity;
              setEmail(value);
              void update(
                async () => {
                  const next = await api<NotificationPreferences>(
                    "notificationPreferences",
                    workspace.workspace_id,
                    { emailConversationNew: value },
                    session.user.id,
                  );
                  if (current.current === key) setEmail(next.email_conversation_new);
                },
                () => setEmail(old),
              );
            }}
          />
        </View>
        <View style={[styles.card, { gap: 16 }]}>
          <Text style={styles.heading}>Sound</Text>
          <Text style={styles.caption}>
            Tap a sound to select it. Preview plays your selected sound.
          </Text>
          {(
            [
              {
                key: "mill",
                label: "Mill chime",
                detail: "Short, melodic alerts for your conversations.",
              },
              {
                key: "voice",
                label: "Voice alerts",
                detail: "Spoken alerts for new chats and visitors. Messages use the Mill chime.",
              },
              {
                key: "system",
                label: "iPhone default",
                detail: "The real iPhone alert. Silent mode and Focus apply.",
              },
              { key: "silent", label: "Silent", detail: "Show notifications without a sound." },
            ] as const
          )
            .filter((item) => item.key !== "voice" || voiceAlertsAvailable)
            .map((item) => (
              <Pressable
                key={item.key}
                accessibilityRole="radio"
                accessibilityState={{
                  checked: sound === item.key,
                  disabled: saving || preferencesLoading,
                }}
                disabled={saving || preferencesLoading || !online}
                onPress={() => {
                  if (!workspace) return;
                  const old = sound;
                  stopPreviews();
                  setSound(item.key);
                  void update(
                    () => changePushSound(workspace.workspace_id, item.key),
                    () => setSound(old),
                  );
                }}
                style={[
                  styles.row,
                  {
                    gap: 12,
                    borderWidth: 1,
                    borderColor: sound === item.key ? colors.blue : colors.line,
                    backgroundColor: sound === item.key ? colors.pale : colors.surface,
                    borderRadius: 16,
                    padding: 14,
                  },
                ]}
              >
                <Ionicons
                  name={sound === item.key ? "radio-button-on" : "radio-button-off"}
                  size={22}
                  color={sound === item.key ? colors.blue : colors.muted}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.ink, fontWeight: "600" }}>{item.label}</Text>
                  <Text style={styles.caption}>{item.detail}</Text>
                </View>
              </Pressable>
            ))}
          {sound !== "silent" && (
            <View style={{ gap: 10 }}>
              {(
                [
                  { which: "chat", label: "New chat" },
                  { which: "visitor", label: "New visitor" },
                  { which: "message", label: "New message" },
                ] as const
              ).map((item) => (
                <Pressable
                  key={item.which}
                  accessibilityRole="button"
                  accessibilityLabel={`Preview selected ${item.label.toLowerCase()} sound`}
                  onPress={() => void preview(item.which)}
                  style={[styles.subtle, styles.row, { padding: 14, borderRadius: 12, gap: 10 }]}
                >
                  <Ionicons name="play-circle-outline" color={colors.blue} size={26} />
                  <Text style={{ color: colors.blue }}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {sound === "silent" && (
            <Text style={styles.caption}>Silent alerts do not play a sound.</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NotificationToggle({
  title,
  detail,
  value,
  disabled,
  onChange,
}: {
  title: string;
  detail: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors, styles } = useTheme();
  return (
    <View style={[styles.row, { justifyContent: "space-between", gap: 14, minHeight: 66 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 15 }}>{title}</Text>
        <Text style={styles.caption}>{detail}</Text>
      </View>
      <Switch
        accessibilityLabel={title}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: "#1761DF", false: colors.line }}
      />
    </View>
  );
}
