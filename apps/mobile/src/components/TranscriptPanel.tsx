import React, { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import { api } from "../lib/client";
import { Button, ErrorBanner, useTheme } from "./ui";
export function TranscriptPanel({
  workspaceId,
  conversationId,
  userId,
  initialEmail,
  onClose,
}: {
  workspaceId: string;
  conversationId: string;
  userId: string;
  initialEmail?: string | null;
  onClose: () => void;
}) {
  const { colors, styles } = useTheme();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const alive = useRef(true);
  const attempt = useRef<{ email: string; id: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (locked.current) return;
    const recipient = email.trim().toLowerCase();
    if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError("Enter a valid email address.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    if (attempt.current?.email !== recipient)
      attempt.current = { email: recipient, id: Crypto.randomUUID() };
    try {
      await api(
        "transcript",
        workspaceId,
        { conversationId, email: recipient, requestId: attempt.current.id },
        userId,
      );
      if (alive.current) setSent(true);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Unable to send transcript.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.screen}>
      <View style={{ padding: 22, gap: 12 }}>
        <Text style={styles.heading}>Email transcript</Text>
        <Button title="Done" subtle onPress={onClose} />
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ padding: 22, gap: 18 }}
        >
          <Text style={styles.caption}>
            Send this conversation to any email address. Internal notes are excluded.
          </Text>
          <ErrorBanner message={error} />
          <TextInput
            accessibilityLabel="Transcript recipient email"
            placeholder="name@example.com"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={email}
            editable={!busy}
            onChangeText={(value) => {
              setEmail(value);
              setSent(false);
            }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
          />
          {sent ? (
            <Text style={{ color: colors.green }}>
              Transcript sent to {email.trim().toLowerCase()}.
            </Text>
          ) : (
            <Button
              title={busy ? "Sending…" : "Send transcript"}
              disabled={busy || !email.trim()}
              onPress={() => void send()}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
