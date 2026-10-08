import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Crypto from "expo-crypto";
import type { InternalNote, ListInternalNotesResult } from "@site-chat/shared";
import { api } from "../lib/client";
import { Avatar, Button, ErrorBanner, useTheme } from "./ui";
import { mergeNotes, noteEditInput } from "../core/notes";

export function InternalNotesPanel({
  workspaceId,
  conversationId,
  userId,
  onClose,
}: {
  workspaceId: string;
  conversationId: string;
  userId: string;
  onClose: () => void;
}) {
  const { colors, styles } = useTheme();
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [before, setBefore] = useState<ListInternalNotesResult["next_before"]>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<InternalNote | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<FlatList<InternalNote>>(null);
  const locked = useRef(false);
  const loadingRef = useRef(false);
  const alive = useRef(true);
  const version = useRef(0);
  const attempt = useRef<{ body: string; id: string } | null>(null);

  async function load(cursor?: ListInternalNotesResult["next_before"]) {
    if (loadingRef.current || locked.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError("");
    const revision = version.current;
    try {
      const result = await api<ListInternalNotesResult>(
        "notes",
        workspaceId,
        {
          conversationId,
          query: { limit: 50, ...(cursor ? { before: cursor } : {}) },
        },
        userId,
      );
      if (!alive.current || revision !== version.current) return;
      setNotes((current) =>
        mergeNotes(cursor ? current : [], [...result.items, ...(result.tombstones ?? [])]),
      );
      setBefore(result.has_more ? result.next_before : null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Unable to load notes.");
    } finally {
      loadingRef.current = false;
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (alive.current) return load();
    });
    return () => {
      alive.current = false;
    };
    // This panel mounts separately for each conversation and account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate(operation: string, payload: unknown) {
    if (locked.current) return false;
    locked.current = true;
    version.current++;
    setBusy(true);
    setError("");
    try {
      const saved = await api<InternalNote>(operation, workspaceId, payload, userId);
      if (!alive.current) return false;
      setNotes((current) => mergeNotes(current, [saved]));
      return true;
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Unable to save the note.");
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    const text = body.trim();
    if (!text || locked.current || loadingRef.current) return;
    if (!editing && attempt.current?.body !== text)
      attempt.current = { body: text, id: Crypto.randomUUID() };
    const saved = await mutate(
      editing ? "updateNote" : "note",
      editing
        ? noteEditInput(editing, text)
        : { conversationId, body: text, clientNoteId: attempt.current!.id },
    );
    if (saved) {
      setBody("");
      setEditing(null);
      attempt.current = null;
      Keyboard.dismiss();
      requestAnimationFrame(() => list.current?.scrollToOffset({ offset: 0, animated: true }));
    }
  }
  function remove(item: InternalNote) {
    Alert.alert("Delete note?", "This note will be removed for your team.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void mutate("deleteNote", { noteId: item.id }).then((saved) => {
            if (saved && editing?.id === item.id) {
              setEditing(null);
              setBody("");
            }
          });
        },
      },
    ]);
  }
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.row, { justifyContent: "space-between", padding: 20 }]}>
          <Text style={styles.heading}>Internal notes</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close internal notes"
            disabled={busy}
            onPress={onClose}
            style={{ padding: 8 }}
          >
            <Text style={{ color: colors.blue }}>Done</Text>
          </Pressable>
        </View>
        <ErrorBanner message={error} />
        <FlatList
          ref={list}
          style={{ flex: 1 }}
          data={notes}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 16,
            gap: 12,
          }}
          ListHeaderComponent={
            <Text style={[styles.caption, { marginBottom: 14 }]}>
              Only your team can see these notes.
            </Text>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.blue} />
            ) : (
              <Text style={styles.caption}>No notes yet.</Text>
            )
          }
          ListFooterComponent={
            before || error ? (
              <Button
                title={loading ? "Loading…" : before ? "Load earlier notes" : "Retry loading"}
                subtle
                disabled={loading || busy}
                onPress={() => void load(before)}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <View style={[styles.card, { backgroundColor: colors.note, gap: 12 }]}>
              <View style={[styles.row, { gap: 10 }]}>
                <Avatar name={item.author_display_label} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11, color: colors.muted }}>Written by</Text>
                  <Text style={{ fontWeight: "600", color: colors.ink }}>
                    {item.author_display_label}
                  </Text>
                </View>
              </View>
              <Text selectable style={{ color: colors.ink, lineHeight: 22 }}>
                {item.body}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted }}>
                {new Date(item.created_at).toLocaleString("en-US")}
                {item.updated_at !== item.created_at ? " · Edited" : ""}
              </Text>
              <View style={[styles.row, { gap: 24 }]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit note by ${item.author_display_label}`}
                  disabled={busy}
                  onPress={() => {
                    setEditing(item);
                    setBody(item.body);
                    setError("");
                    input.current?.focus();
                  }}
                  style={{ paddingVertical: 8 }}
                >
                  <Text style={{ color: colors.blue, fontWeight: "600" }}>Edit</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete note by ${item.author_display_label}`}
                  disabled={busy}
                  onPress={() => remove(item)}
                  style={{ paddingVertical: 8 }}
                >
                  <Text style={{ color: "#9C3E43" }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
        <View
          style={{
            padding: 16,
            gap: 10,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.canvas,
          }}
        >
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={{ color: colors.ink, fontWeight: "600" }}>
              {editing ? "Edit note" : "New note"}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => Keyboard.dismiss()}
              style={{ padding: 6 }}
            >
              <Text style={{ color: colors.blue }}>Hide keyboard</Text>
            </Pressable>
          </View>
          <TextInput
            ref={input}
            accessibilityLabel="Internal note"
            value={body}
            editable={!busy}
            onChangeText={setBody}
            multiline
            maxLength={4000}
            placeholder="Add a note for your team…"
            textAlignVertical="top"
            style={[styles.input, { height: 88, paddingVertical: 12 }]}
          />
          <View style={[styles.row, { gap: 10 }]}>
            {editing && (
              <Button
                title="Cancel"
                subtle
                disabled={busy}
                onPress={() => {
                  setEditing(null);
                  setBody("");
                  Keyboard.dismiss();
                }}
              />
            )}
            <View style={{ flex: 1 }}>
              <Button
                title={busy ? "Saving…" : editing ? "Save changes" : "Add note"}
                disabled={busy || loading || !body.trim()}
                onPress={() => void save()}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
