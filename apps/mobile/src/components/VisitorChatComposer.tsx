import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { can } from "@site-chat/shared";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import { Button, ErrorBanner, useTheme } from "./ui";
export function VisitorChatComposer({
  visitorId,
  workspaceId,
  onStarted,
}: {
  visitorId: string;
  workspaceId?: string;
  onStarted: (id: string) => void;
}) {
  const { session, workspace: currentWorkspace, workspaces, online } = useMill();
  const workspace = workspaceId ? workspaces.find((w) => w.workspace_id === workspaceId) : currentWorkspace;
  const { colors, styles } = useTheme();
  const [greeting, setGreeting] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const attempt = useRef<{ message: string; id: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (session && workspace)
      void api<{ invitationMessage: string }>(
        "visitorGreeting",
        workspace.workspace_id,
        {},
        session.user.id,
      )
        .then((result) => {
          if (alive.current) {
            setGreeting(result.invitationMessage);
            setMessage((current) => current || result.invitationMessage);
          }
        })
        .catch(() => {
          /* A custom greeting remains available if settings cannot load. */
        });
    return () => {
      alive.current = false;
    };
  }, [session, workspace]);
  if (!session || !workspace || !can(workspace.role, "send_messages")) return null;
  async function start() {
    if (locked.current || !session || !workspace || !message.trim() || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const body = message.trim();
    if (attempt.current?.message !== body)
      attempt.current = { message: body, id: Crypto.randomUUID() };
    try {
      const result = await api<{ conversationId: string }>(
        "startVisitorChat",
        workspace.workspace_id,
        { visitorId, message: body, requestId: attempt.current.id },
        session.user.id,
      );
      if (alive.current) onStarted(result.conversationId);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Unable to start chat.");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: "700" }}>
        Start a conversation
      </Text>
      <Text style={styles.caption}>Send a greeting while this visitor is online.</Text>
      <ErrorBanner message={error} />
      <TextInput
        accessibilityLabel="Greeting message"
        placeholder="Write a greeting…"
        placeholderTextColor={colors.muted}
        style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
        multiline
        maxLength={1000}
        value={message}
        editable={!busy}
        onChangeText={setMessage}
      />
      {greeting && (
        <Button
          title="Use standard greeting"
          subtle
          disabled={busy}
          onPress={() => setMessage(greeting)}
        />
      )}
      <Button
        title={busy ? "Starting chat…" : "Start chat"}
        disabled={busy || !online || !message.trim()}
        onPress={() => void start()}
      />
    </View>
  );
}
