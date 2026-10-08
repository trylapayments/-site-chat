import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { can } from "@site-chat/shared";
import { CompanyChoices } from "../components/CompanyChoices";
import { useCompanyInboxes } from "../lib/company-inboxes";
import { useMill } from "../lib/session";
import { api } from "../lib/client";
import { Avatar, Button, ErrorBanner, useTheme } from "../components/ui";
import { LegalLinks } from "../components/LegalLinks";
import { getMobileCapabilities } from "../lib/capabilities";
export default function Settings() {
  const { colors, styles, mode, setMode } = useTheme();
  const {
    session,
    workspace,
    workspaces,
    selectWorkspace,
    selectAllWebsites,
    allWebsites,
    logout,
    pending,
    active,
  } = useMill();
  const { companies } = useCompanyInboxes();
  const [status, setStatus] = useState("offline");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletion, setDeletion] = useState<{ userId: string; enabled: boolean } | null>(null);
  useEffect(() => {
    const userId = session?.user.id;
    if (!userId) return;
    let cancelled = false;
    void getMobileCapabilities(userId)
      .then((value) => {
        if (!cancelled) setDeletion({ userId, enabled: value.accountDeletion === true });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);
  const enabled = !!workspace && can(workspace.role, "send_messages");
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
      setError(e instanceof Error ? e.message : "Unable to update your status.");
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <Redirect href="/login" />;
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: 22, gap: 20 }}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={styles.heading}>Your Mill</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={{ padding: 10, color: colors.blue }}>Done</Text>
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
            <Text style={{ color: colors.ink, fontWeight: "600" }}>Operator status</Text>
            {[
              { key: "available", label: "Available", color: colors.green },
              { key: "away", label: "Away", color: "#DFA447" },
              { key: "offline", label: "Offline", color: colors.muted },
            ].map((item) => (
              <Pressable
                key={item.key}
                disabled={busy}
                onPress={() => void change(item.key)}
                style={[styles.row, { minHeight: 46, gap: 12 }]}
              >
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 5,
                    backgroundColor: item.color,
                  }}
                />
                <Text style={{ flex: 1, color: colors.ink }}>{item.label}</Text>
                {status === item.key && <Text style={{ color: colors.blue }}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}
        <View style={[styles.card, { gap: 15 }]}>
          <Text style={{ color: colors.ink, fontWeight: "600" }}>Companies</Text>
          <CompanyChoices
            workspaces={workspaces}
            counts={Object.fromEntries(
              companies.map((company) => [company.workspace_id, company.unread_total]),
            )}
            selected={allWebsites ? "all" : (workspace?.workspace_id ?? null)}
            onSelect={(id) => {
              if (id === "all") {
                selectAllWebsites();
                router.replace("/(tabs)/inbox");
              } else selectWorkspace(id);
            }}
          />
        </View>
        <Button title="Notification Center" subtle onPress={() => router.push("/notifications")} />
        <View style={[styles.card, { gap: 15 }]}>
          <Text style={styles.heading}>Appearance</Text>
          <View style={[styles.row, { gap: 8 }]}>
            {(["system", "light", "dark"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked: mode === value }}
                onPress={() => setMode(value)}
                style={{
                  flex: 1,
                  paddingVertical: 13,
                  borderRadius: 12,
                  alignItems: "center",
                  backgroundColor: mode === value ? colors.pale : colors.canvas,
                  borderWidth: 1,
                  borderColor: mode === value ? colors.blue : colors.line,
                }}
              >
                <Text
                  style={{ color: mode === value ? colors.blue : colors.ink, fontWeight: "600" }}
                >
                  {value[0].toUpperCase() + value.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Text style={styles.caption}>
          Manage your subscription and access in the Mill web portal.
        </Text>
        <LegalLinks />
        {deletion?.userId === session.user.id && deletion.enabled && (
          <Button title="Delete account" subtle onPress={() => router.push("/delete-account")} />
        )}
        <Button
          title="Sign out"
          subtle
          onPress={() =>
            Alert.alert(
              "Sign out of Mill?",
              pending.length
                ? "Unsent messages will be saved for this account. Push notifications will be disabled."
                : "Push notifications will be disabled on this device.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Sign out",
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
