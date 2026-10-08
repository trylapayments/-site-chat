import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import { Button, ErrorBanner, useTheme } from "../components/ui";
type Preview = {
  email: string;
  personalCompanies: { id: string; name: string }[];
  sharedCompanies: { id: string; name: string }[];
  blockers: { code: string; message: string; workspaceId?: string }[];
};
type Result = { deleted: true } | { deleted: false; preview: Preview };
export default function DeleteAccount() {
  const { styles, colors } = useTheme();
  const { session, finishAccountDeletion } = useMill();
  const userId = session?.user.id;
  const [preview, setPreview] = useState<(Preview & { userId: string }) | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(userId);
  useEffect(() => {
    current.current = userId;
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void api<Preview>("accountDeletionPreview", undefined, {}, userId)
      .then((data) => {
        if (!cancelled) setPreview({ ...data, userId });
      })
      .catch((failure) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : "Unable to load account details.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  async function remove() {
    if (
      !userId ||
      current.current !== userId ||
      !preview ||
      preview.userId !== userId ||
      preview.blockers.length ||
      busy
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Result>(
        "deleteOwnAccount",
        undefined,
        { confirmation, password },
        userId,
      );
      setPassword("");
      if (current.current !== userId) return;
      if (!result.deleted) {
        setPreview({ ...result.preview, userId });
        setError("Account details have changed. Review them before continuing.");
        return;
      }
      await finishAccountDeletion(userId);
      router.replace("/login");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Unable to delete the account.");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  if (!session) return <Redirect href="/login" />;
  const details = preview?.userId === userId ? preview : null;
  const enabled =
    !!details && !details.blockers.length && confirmation === details.email && !!password && !busy;
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ padding: 22, gap: 20 }}
        >
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={styles.heading}>Delete account</Text>
            <Pressable disabled={busy} onPress={() => router.back()} style={{ padding: 12 }}>
              <Text style={{ color: colors.blue }}>Cancel</Text>
            </Pressable>
          </View>
          <Text style={{ color: colors.ink, lineHeight: 23 }}>
            Deleting your account is permanent. Your profile and access will be removed. Personal
            companies and their conversation data will be deleted. Your team’s history in shared
            companies is preserved.
          </Text>
          <ErrorBanner message={error} />
          {!details && !error && <Text style={styles.caption}>Checking account details…</Text>}
          {details && (
            <>
              {!!details.personalCompanies.length && (
                <View style={[styles.card, { gap: 10 }]}>
                  <Text style={{ color: colors.ink, fontWeight: "600" }}>
                    Personal companies to delete
                  </Text>
                  {details.personalCompanies.map((company) => (
                    <Text key={company.id} style={{ color: colors.ink }}>
                      {company.name}
                    </Text>
                  ))}
                </View>
              )}
              {!!details.sharedCompanies.length && (
                <View style={[styles.card, { gap: 10 }]}>
                  <Text style={{ color: colors.ink, fontWeight: "600" }}>Shared companies</Text>
                  <Text style={styles.caption}>
                    Your access is removed. Other team members keep their company and conversation
                    history.
                  </Text>
                  {details.sharedCompanies.map((company) => (
                    <Text key={company.id} style={{ color: colors.ink }}>
                      {company.name}
                    </Text>
                  ))}
                </View>
              )}
              {details.blockers.map((blocker, index) => (
                <View style={styles.card} key={`${blocker.code}:${index}`}>
                  <Text style={{ color: colors.ink }}>{blocker.message}</Text>
                </View>
              ))}
              <Text style={styles.caption}>Type {details.email} to confirm</Text>
              <TextInput
                editable={!busy}
                style={styles.input}
                placeholder="Account email"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Confirm account email"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                value={confirmation}
                onChangeText={setConfirmation}
              />
              <Text style={styles.caption}>Confirm your current password</Text>
              <TextInput
                editable={!busy}
                style={styles.input}
                placeholder="Current password"
                placeholderTextColor={colors.muted}
                accessibilityLabel="Current password"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                value={password}
                onChangeText={setPassword}
              />
              <Button
                title={busy ? "Deleting…" : "Delete my account"}
                disabled={!enabled}
                onPress={() =>
                  Alert.alert("Permanently delete your account?", "This cannot be undone.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete account", style: "destructive", onPress: () => void remove() },
                  ])
                }
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
