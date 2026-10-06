import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { can } from "@site-chat/shared";
import { useMill } from "../lib/session";
import { api } from "../lib/client";
import { registerPush, pushWorkspaces } from "../lib/push";
import { Avatar, Button, ErrorBanner, colors, styles } from "../components/ui";
export default function Settings() {
  const { session, workspace, workspaces, selectWorkspace, logout, pending, active } = useMill();
  const [status, setStatus] = useState("offline");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushScope, setPushScope] = useState<string | null>(null);
  const push = !!workspace && pushScope === workspace.workspace_id;
  const enabled = !!workspace && can(workspace.role, "send_messages");
  useEffect(() => {
    let cancelled = false;
    if (session && workspace)
      void pushWorkspaces(session.user.id).then((scopes) => {
        if (!cancelled)
          setPushScope(scopes.includes(workspace.workspace_id) ? workspace.workspace_id : null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, workspace]);
  useEffect(() => {
    if (!enabled || !active) return;
    const update = () =>
      api<{ status: string }>("availability", workspace!.workspace_id, {})
        .then((data) => setStatus(data.status))
        .catch(() => {});
    void update();
    const timer = setInterval(() => void update(), 45000);
    return () => clearInterval(timer);
  }, [workspace, enabled, active]);
  async function change(value: string) {
    if (!workspace) return;
    setBusy(true);
    try {
      const result = await api<{ status: string }>("availability", workspace.workspace_id, {
        status: value,
        active: true,
      });
      setStatus(result.status);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус.");
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <Redirect href="/login" />;
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: 22, gap: 20 }}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={styles.heading}>Ваш Mill</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={{ padding: 10, color: colors.blue }}>Готово</Text>
          </Pressable>
        </View>
        <View style={[styles.card, styles.row, { gap: 16 }]}>
          <Avatar name={session.user.email || "Mill"} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>{session.user.email}</Text>
            <Text style={styles.caption}>{workspace?.name}</Text>
          </View>
        </View>
        <ErrorBanner message={error} />
        {enabled && (
          <View style={[styles.card, { gap: 12 }]}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>Статус оператора</Text>
            {[
              { key: "available", label: "Доступен", color: colors.green },
              { key: "away", label: "Отошёл", color: "#DFA447" },
              { key: "offline", label: "Offline", color: colors.muted },
            ].map((item) => (
              <Pressable
                key={item.key}
                disabled={busy}
                onPress={() => void change(item.key)}
                style={[styles.row, { minHeight: 46, gap: 12 }]}
              >
                <View
                  style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: item.color }}
                />
                <Text style={{ flex: 1, color: colors.ink }}>{item.label}</Text>
                {status === item.key && <Text style={{ color: colors.blue }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}
        <View style={[styles.card, { gap: 15 }]}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>Рабочие пространства</Text>
          {workspaces.map((w) => (
            <Pressable
              key={w.workspace_id}
              onPress={() => selectWorkspace(w.workspace_id)}
              style={[styles.row, { minHeight: 42, justifyContent: "space-between" }]}
            >
              <Text style={{ color: colors.ink }}>{w.name}</Text>
              <Text style={{ color: colors.blue }}>
                {workspace?.workspace_id === w.workspace_id ? "✓" : w.role}
              </Text>
            </Pressable>
          ))}
        </View>
        {enabled && (
          <Button
            title={push ? "Уведомления подключены" : "Включить push-уведомления"}
            subtle
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void registerPush(workspace!.workspace_id)
                .then(() => {
                  setPushScope(workspace!.workspace_id);
                  setError("");
                })
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          />
        )}
        <Text style={styles.caption}>Подписка и доступ управляются в веб-портале Mill.</Text>
        <Button
          title="Выйти из аккаунта"
          subtle
          onPress={() =>
            Alert.alert(
              "Выйти из Mill?",
              pending.length
                ? "Неотправленные сообщения сохранятся для этого аккаунта. Push-уведомления будут отключены."
                : "Push-уведомления на этом устройстве будут отключены.",
              [
                { text: "Отмена", style: "cancel" },
                {
                  text: "Выйти",
                  style: "destructive",
                  onPress: () => void logout().catch((e) => setError(e.message)),
                },
              ],
            )
          }
        />
      </ScrollView>
    </SafeAreaView>
  );
}
