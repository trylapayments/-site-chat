import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { can, createCannedResponseSchema } from "@site-chat/shared";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import { Button, ErrorBanner, useTheme } from "./ui";
export function CreateTemplatePanel({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session, workspace, online } = useMill();
  const { colors, styles } = useTheme();
  const teamAllowed = !!workspace && can(workspace.role, "manage_workspace_canned_responses");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [visibility, setVisibility] = useState<"workspace" | "personal">(
    teamAllowed ? "workspace" : "personal",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function save() {
    if (locked.current || !session || !workspace || !online) return;
    const parsed = createCannedResponseSchema.safeParse({
      title,
      body,
      shortcut: shortcut.trim() || null,
      visibility,
      folderId: null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the template fields.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await api("createTemplate", workspace.workspace_id, parsed.data, session.user.id);
      if (alive.current) onSaved();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Unable to create template.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ padding: 22, gap: 12 }}>
        <Text style={styles.heading}>New template</Text>
        <Button title="Cancel" subtle disabled={busy} onPress={onClose} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 22, gap: 16, paddingBottom: 40 }}
        >
          <ErrorBanner message={error} />
          <TextInput
            accessibilityLabel="Template title"
            placeholder="Title"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            editable={!busy}
            maxLength={200}
          />
          <TextInput
            accessibilityLabel="Template reply"
            placeholder="Write your reply…"
            placeholderTextColor={colors.muted}
            style={[styles.input, { minHeight: 150, textAlignVertical: "top" }]}
            multiline
            value={body}
            onChangeText={setBody}
            editable={!busy}
            maxLength={4000}
          />
          <TextInput
            accessibilityLabel="Template shortcut"
            placeholder="Shortcut (optional)"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={shortcut}
            onChangeText={setShortcut}
            editable={!busy}
            maxLength={64}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.caption}>
            {visibility === "workspace"
              ? "Available to everyone in your workspace."
              : "Only visible to you."}
          </Text>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button
                title={visibility === "workspace" ? "✓ Team" : "Team"}
                subtle
                disabled={busy || !teamAllowed}
                onPress={() => setVisibility("workspace")}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={visibility === "personal" ? "✓ Personal" : "Personal"}
                subtle
                disabled={busy}
                onPress={() => setVisibility("personal")}
              />
            </View>
          </View>
          <Button
            title={busy ? "Creating…" : "Create template"}
            disabled={busy || !online || !title.trim() || !body.trim()}
            onPress={() => void save()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
