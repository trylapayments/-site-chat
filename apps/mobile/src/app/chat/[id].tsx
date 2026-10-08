import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { conversationLayout } from "../../core/conversation-layout";
import InboxScreen from "../../components/InboxScreen";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { fetchChatBootstrap } from "../../lib/chat-cache";
import { attachmentUrl } from "../../lib/downloads";
import { cacheKey, cached, remember } from "../../lib/cache";
import * as Haptics from "expo-haptics";
import * as Crypto from "expo-crypto";
import {
  can,
  type ConversationDetail,
  type CannedResponse,
  type ListCannedResponsesResult,
  type ListMessagesResult,
  type MessageItem,
  type WorkspaceMemberOption,
  type MessageAttachmentView,
} from "@site-chat/shared";
import { SaveContact } from "../../components/SaveContact";
import { CustomerFeedback } from "../../components/CustomerFeedback";
import { TranscriptPanel } from "../../components/TranscriptPanel";
import { InternalNotesPanel } from "../../components/InternalNotesPanel";
import { TranslationPreviewPanel } from "../../components/TranslationPreviewPanel";
import {
  previewReplyTranslation,
  translateMessage,
  translationCapabilities,
} from "../../lib/translation";
import { api } from "../../lib/client";
import { useMill } from "../../lib/session";
import { noteSuccessfulClose } from "../../lib/app-review";
import { focusPushConversation } from "../../lib/push";
import { useRealtime } from "../../lib/realtime";
import { mergeMessages, type PendingMessage } from "../../core/outbox";
import { pickFile } from "../../lib/files";
import { Avatar, Button, ErrorBanner, useTheme } from "../../components/ui";

function Attachment({
  attachment,
  workspaceId,
}: {
  attachment: MessageAttachmentView;
  workspaceId: string;
}) {
  const { colors } = useTheme();
  const { session } = useMill();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      if (!session) return null;
      const url = await attachmentUrl(session.user.id, workspaceId, attachment.id);
      setUrl(url);
      setError("");
      return url;
    } catch {
      setError("Unable to open the file");
      return null;
    }
  }, [workspaceId, attachment.id, session]);
  useEffect(() => {
    if (attachment.kind === "image") void Promise.resolve().then(load);
  }, [load, attachment.kind]);
  return (
    <Pressable
      onPress={() =>
        void (
          session
            ? attachmentUrl(session.user.id, workspaceId, attachment.id, "full")
            : Promise.resolve(null)
        )
          .then((value) => {
            if (value) return Linking.openURL(value);
          })
          .catch(() => setError("Unable to open the file."))
      }
      style={{ paddingVertical: 6 }}
      accessibilityLabel={`Open ${attachment.filename}`}
    >
      {attachment.kind === "image" && url ? (
        <Image
          source={{ uri: url }}
          style={{ width: 210, height: 160, borderRadius: 12 }}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={attachment.id}
          onError={() => setError("This link has expired. Tap to refresh.")}
        />
      ) : (
        <Text style={{ color: colors.blue, fontWeight: "600" }}>↗ {attachment.filename}</Text>
      )}
      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>
        {error || `${Math.ceil(attachment.size_bytes / 1024)} KB`}
      </Text>
    </Pressable>
  );
}

export default function Chat() {
  const { width, fontScale } = useWindowDimensions();
  const { colors } = useTheme();
  const { session, workspace } = useMill();
  const params = useLocalSearchParams<{ id: string; workspaceId: string }>();
  const layout = conversationLayout(width, fontScale);
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.canvas }}>
      <View style={{ width: layout.sidebarWidth, display: layout.split ? "flex" : "none", borderRightWidth: 1, borderColor: colors.line }}>
        {layout.split && <InboxScreen embedded selectedId={params.id} selectedWorkspaceId={params.workspaceId || workspace?.workspace_id} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ChatContent key={`${session?.user.id}:${params.workspaceId || workspace?.workspace_id}:${params.id}`} />
      </View>
    </View>
  );
}

function ChatContent() {
  const { colors, styles } = useTheme();
  const params = useLocalSearchParams<{ id: string; workspaceId: string }>();
  const id = params.id;
  const {
    session,
    workspace,
    selectWorkspace,
    workspaces,
    online,
    pending,
    delivered,
    send,
    retry,
    discard,
    active,
  } = useMill();
  const workspaceId = params.workspaceId || workspace?.workspace_id;
  const role = workspaces.find((w) => w.workspace_id === workspaceId)?.role;
  const writable = !!role && can(role, "send_messages");
  const chatCacheKey =
    session && workspaceId ? cacheKey(session.user.id, workspaceId, `chat:${id}`) : "";
  const [cacheScope, setCacheScope] = useState(chatCacheKey);
  const [storedDetail, setDetail] = useState<ConversationDetail | null>(null);
  const [storedMessages, setMessages] = useState<MessageItem[]>([]);
  const [older, setOlder] = useState(false);
  const [body, setBody] = useState("");
  const [translation, setTranslation] = useState<
    | { kind: "draft"; scope: string }
    | { kind: "message"; scope: string; message: MessageItem }
    | null
  >(null);
  const [translationAccess, setTranslationAccess] = useState<{
    scope: string;
    enabled: boolean;
  } | null>(null);
  const translationRequest = useRef<{ binding: string; id: string } | null>(null);
  useEffect(() => {
    if (!session || !workspaceId) return;
    let cancelled = false;
    const identity = chatCacheKey;
    void translationCapabilities(session.user.id, workspaceId)
      .then((access) => {
        if (!cancelled) setTranslationAccess({ scope: identity, enabled: access.enabled });
      })
      .catch(() => {
        if (!cancelled) setTranslationAccess(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, workspaceId, chatCacheKey]);
  const canTranslate = translationAccess?.scope === chatCacheKey && translationAccess.enabled;
  async function openTranslation(selection: NonNullable<typeof translation>) {
    if (!session || !workspaceId) return;
    const identity = `${session.user.id}:${workspaceId}:${id}`;
    try {
      const enabled =
        translationAccess?.scope === chatCacheKey
          ? translationAccess.enabled
          : (await translationCapabilities(session.user.id, workspaceId)).enabled;
      if (scope.current !== identity) return;
      if (!enabled) {
        Alert.alert(
          "Unlock AI translation",
          "AI translation is available on Professional, Business and Enterprise. Ask your company owner to upgrade your Mill plan in the web portal.",
          [{ text: "Got it" }],
        );
        return;
      }
      setTranslationAccess({ scope: chatCacheKey, enabled: true });
      setTranslation(selection);
    } catch {
      if (scope.current === identity)
        Alert.alert(
          "Translation unavailable",
          "We couldn’t check your translation access. Please try again.",
        );
    }
  }
  const [file, setFile] = useState<PendingMessage["file"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<
    "actions" | "profile" | "notes" | "templates" | "transcript" | null
  >(null);
  const [templates, setTemplates] = useState<CannedResponse[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [members, setMembers] = useState<WorkspaceMemberOption[]>([]);
  const scope = useRef("");
  useEffect(() => {
    scope.current = `${session?.user.id}:${workspaceId}:${id}`;
  }, [workspaceId, id, session?.user.id]);
  const latest = useRef(0);
  const list = useRef<FlatList>(null);
  const atBottom = useRef(true);
  const initialPositioned = useRef(false);
  // The inverted list anchors the latest message at zero, independent of history height.
  const scrollToLatest = useCallback(() => {
    requestAnimationFrame(() => {
      list.current?.scrollToOffset({ offset: 0, animated: false });
    });
  }, []);
  const detail = cacheScope === chatCacheKey ? storedDetail : null;
  const messages = useMemo(
    () => (cacheScope === chatCacheKey ? storedMessages : []),
    [cacheScope, chatCacheKey, storedMessages],
  );
  const oldestSequence = messages[0]?.sequence_number;
  const newestSequence = messages[messages.length - 1]?.sequence_number;
  const refresh = useCallback(
    async (history = false) => {
      if (!workspaceId || !id) return;
      if (history) atBottom.current = false;
      const identity = `${session?.user.id}:${workspaceId}:${id}`;
      try {
        let result: ListMessagesResult;
        if (!history) {
          const bootstrap = await fetchChatBootstrap(session!.user.id, workspaceId, id);
          if (scope.current !== identity) return;
          setDetail(bootstrap.conversation);
          result = bootstrap.messages;
          setMessages((previous) => mergeMessages(previous, result.items));
        } else {
          const [, page] = await Promise.all([
            history
              ? Promise.resolve()
              : api<ConversationDetail>(
                  "conversation",
                  workspaceId,
                  { conversationId: id },
                  session?.user.id,
                ).then((conversation) => {
                  if (scope.current === identity) setDetail(conversation);
                }),
            api<ListMessagesResult>(
              "messages",
              workspaceId,
              {
                conversationId: id,
                query:
                  history && oldestSequence
                    ? { before_sequence: oldestSequence, limit: 50 }
                    : { limit: 30 },
              },
              session?.user.id,
            ).then((page) => {
              if (scope.current === identity)
                setMessages((previous) => mergeMessages(previous, page.items));
              return page;
            }),
          ]);
          result = page;
        }
        if (scope.current !== identity) return;
        if (history || latest.current === 0) setOlder(result.has_older);
        // Resume catches every gap, including more than one page of messages.
        const oldCursor = latest.current;
        if (
          !history &&
          oldCursor > 0 &&
          result.items.length > 0 &&
          result.items[0].sequence_number > oldCursor + 1
        ) {
          let cursor = oldCursor;
          for (let page = 0; page < 100; page++) {
            const catchup = await api<ListMessagesResult>("messages", workspaceId, {
              conversationId: id,
              query: { after_sequence: cursor, limit: 50 },
            });
            if (scope.current !== identity) return;
            setMessages((previous) => mergeMessages(previous, catchup.items));
            if (!catchup.items.length) break;
            const next = Math.max(...catchup.items.map((m) => m.sequence_number));
            if (next <= cursor) break;
            cursor = next;
            if (catchup.items.length < 50) break;
          }
        }
        latest.current = Math.max(latest.current, ...result.items.map((m) => m.sequence_number));
        setError("");
      } catch (e) {
        if (scope.current === identity)
          setError(e instanceof Error ? e.message : "Unable to load this conversation.");
      }
    },
    [workspaceId, id, oldestSequence, session],
  );
  const initialRefresh = useRef(refresh);
  useEffect(() => {
    initialRefresh.current = refresh;
  }, [refresh]);
  useEffect(() => {
    const identity = `${session?.user.id}:${workspaceId}:${id}`;
    void Promise.resolve().then(() => {
      if (scope.current !== identity) return;
      setCacheScope(chatCacheKey);
      const warm = cached<{
        detail: ConversationDetail;
        messages: MessageItem[];
      }>(chatCacheKey);
      setDetail(warm?.detail ?? null);
      setMessages(warm?.messages ?? []);
      latest.current = 0;
      atBottom.current = true;
      initialPositioned.current = false;
      if (workspaceId) selectWorkspace(workspaceId);
      void initialRefresh.current();
    });
    return () => {
      scope.current = "";
    };
  }, [workspaceId, id, selectWorkspace, chatCacheKey, session?.user.id]);
  useEffect(() => {
    if (detail && messages.length && chatCacheKey) remember(chatCacheKey, { detail, messages });
  }, [detail, messages, chatCacheKey]);
  useRealtime(workspaceId, () => void refresh(), id);
  useFocusEffect(
    useCallback(() => {
      if (!active || !workspaceId) return;
      return focusPushConversation(workspaceId, id);
    }, [active, workspaceId, id]),
  );
  useFocusEffect(
    useCallback(() => {
      if (!active || !workspaceId || newestSequence === undefined) return;
      void api("read", workspaceId, {
        conversationId: id,
        throughSequence: newestSequence,
      }).catch(() => {});
    }, [active, workspaceId, id, newestSequence]),
  );
  async function action(operation: string, input: unknown) {
    if (!workspaceId || busy) return false;
    setBusy(true);
    try {
      await api(operation, workspaceId, input);
      if (
        operation === "status" &&
        (input as { status?: string }).status === "closed" &&
        detail?.status !== "closed" &&
        detail?.status !== "resolved" &&
        session
      )
        void noteSuccessfulClose(session.user.id, workspaceId, id);
      await refresh();
      void Haptics.selectionAsync();
      setPanel(null);
      setError("");
      return true;
    } catch (e) {
      await refresh();
      setError(e instanceof Error ? e.message : "Unable to complete this action.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openPanel(next: typeof panel) {
    setPanel(next);
    if (!workspaceId) return;
    try {
      if (next === "templates") {
        const identity = scope.current;
        setTemplatesLoading(true);
        try {
          const result = await api<ListCannedResponsesResult>(
            "templates",
            workspaceId,
            { limit: 100 },
            session?.user.id,
          );
          if (scope.current === identity) setTemplates(result.items);
        } finally {
          if (scope.current === identity) setTemplatesLoading(false);
        }
      }
      if (next === "actions")
        setMembers(await api<WorkspaceMemberOption[]>("members", workspaceId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load data.");
    }
  }
  async function submit() {
    if (busy || (!body.trim() && !file) || !workspaceId) return;
    setBusy(true);
    atBottom.current = true;
    try {
      await send(id, body.trim(), file);
      scrollToLatest();
      setBody("");
      setFile(undefined);
      void Haptics.selectionAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save your message.");
    } finally {
      setBusy(false);
    }
  }
  async function choose(photo: boolean) {
    if (!session) return;
    try {
      const value = await pickFile(photo, session.user.id);
      if (value) setFile(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to select the file.");
    }
  }
  if (!session) return <Redirect href="/login" />;
  const name = detail?.contact?.name || detail?.contact?.email || "Visitor";
  const visibleMessages = mergeMessages(
    messages,
    delivered
      .filter(
        (row) =>
          row.userId === session.user.id &&
          row.workspaceId === workspaceId &&
          row.conversationId === id,
      )
      .map((row) => row.message),
  );
  const local = pending.filter(
    (m) =>
      m.workspaceId === workspaceId &&
      m.conversationId === id &&
      !visibleMessages.some((row) => row.client_message_id === m.id),
  );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 12,
            borderBottomWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Back to inbox"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox"))}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: colors.pale,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.blue} />
        </Pressable>
        <Avatar name={name} size={38} />
        <Pressable onPress={() => void openPanel("profile")} style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
            {name}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            {detail?.assigned_to?.display_label || "Unassigned"} ·{" "}
            {detail?.status
              ? {
                  open: "Open",
                  pending: "Pending",
                  resolved: "Resolved",
                  closed: "Closed",
                }[detail.status]
              : "Loading"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Conversation actions"
          onPress={() => void openPanel("actions")}
          style={{ padding: 10 }}
        >
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.blue} />
        </Pressable>
      </View>
      <ErrorBanner message={error} />
      {!online && (
        <Text style={{ textAlign: "center", color: colors.muted, padding: 8 }}>
          Offline · messages saved in the queue
        </Text>
      )}
      {workspaceId && session && (
        <CustomerFeedback
          key={`${workspaceId}:${id}:${session.user.id}`}
          workspaceId={workspaceId}
          conversationId={id}
          userId={session.user.id}
        />
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={list}
          inverted
          data={[...visibleMessages].reverse()}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 18, gap: 12, flexGrow: 1 }}
          onLayout={() => {
            if (atBottom.current) scrollToLatest();
          }}
          onContentSizeChange={() => {
            if (!initialPositioned.current && visibleMessages.length) {
              initialPositioned.current = true;
              atBottom.current = true;
              scrollToLatest();
            } else if (atBottom.current) scrollToLatest();
          }}
          onScroll={(event) => {
            if (!initialPositioned.current) return;
            atBottom.current = event.nativeEvent.contentOffset.y <= 80;
          }}
          scrollEventThrottle={100}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: 80,
          }}
          ListFooterComponent={
            older ? (
              <Button title="Load earlier messages" subtle onPress={() => void refresh(true)} />
            ) : null
          }
          ListEmptyComponent={
            !detail ? (
              <View style={{ paddingVertical: 48, alignItems: "center", gap: 12 }}>
                <ActivityIndicator color={colors.blue} />
                <Text style={{ color: colors.muted }}>Loading messages…</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.sender_type === "system")
              return (
                <Text
                  style={{
                    textAlign: "center",
                    fontSize: 11,
                    color: colors.muted,
                    padding: 8,
                  }}
                >
                  {item.body}
                </Text>
              );
            const mine = item.sender_type === "agent";
            return (
              <View
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  backgroundColor: mine ? "#0866FF" : colors.surface,
                  borderRadius: 20,
                  borderBottomRightRadius: mine ? 6 : 20,
                  borderBottomLeftRadius: mine ? 20 : 6,
                  paddingHorizontal: 17,
                  paddingVertical: 14,
                  borderWidth: mine ? 0 : 1,
                  borderColor: colors.line,
                }}
              >
                {!mine && (
                  <Text
                    style={{
                      fontSize: 10,
                      color: colors.muted,
                      marginBottom: 4,
                    }}
                  >
                    {item.sender_label}
                  </Text>
                )}
                {!!item.body && (
                  <Text
                    selectable
                    style={{
                      color: mine ? "#FFF" : colors.ink,
                      fontSize: 16,
                      lineHeight: 23,
                    }}
                  >
                    {item.body}
                  </Text>
                )}
                {!!item.body && (
                  <Pressable
                    accessibilityLabel="Translate message"
                    onPress={() =>
                      void openTranslation({
                        kind: "message",
                        scope: chatCacheKey,
                        message: item,
                      })
                    }
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Text
                      style={{
                        color: mine ? "#FFF" : colors.blue,
                        fontSize: 12,
                      }}
                    >
                      Translate
                    </Text>
                  </Pressable>
                )}
                {item.attachments?.map((attachment: MessageAttachmentView) => (
                  <Attachment
                    key={attachment.id}
                    attachment={attachment}
                    workspaceId={workspaceId!}
                  />
                ))}
                <Text
                  style={{
                    color: mine ? "#D8E5FF" : colors.muted,
                    fontSize: 10,
                    marginTop: 6,
                    alignSelf: "flex-end",
                  }}
                >
                  {new Date(item.created_at).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {mine
                    ? item.sequence_number <= (detail?.visitor_last_read_sequence || 0)
                      ? " · Read"
                      : " · Sent"
                    : ""}
                </Text>
              </View>
            );
          }}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              {(detail?.status === "closed" || detail?.status === "resolved") && (
                <Text
                  accessibilityRole="text"
                  style={{
                    textAlign: "center",
                    color: colors.muted,
                    fontSize: 12,
                    paddingVertical: 14,
                  }}
                >
                  Chat Closed
                </Text>
              )}
              {local.map((item) => (
                <View
                  key={item.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    backgroundColor: colors.pale,
                    borderRadius: 18,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: colors.ink, fontSize: 16 }}>
                    {item.body || item.file?.filename}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 7 }}>
                    {item.state === "failed"
                      ? "Not sent"
                      : online
                        ? "Sending…"
                        : "Waiting for connection"}
                    {item.file ? ` · ${item.file.filename}` : ""}
                  </Text>
                  {item.state === "failed" && (
                    <View style={{ gap: 8, marginTop: 10 }}>
                      <Text style={{ color: "#9C3E43", fontSize: 12 }}>{item.error}</Text>
                      <Button title="Retry" subtle onPress={() => void retry(item.id)} />
                      <Pressable onPress={() => void discard(item.id)}>
                        <Text
                          style={{
                            color: colors.muted,
                            textAlign: "center",
                            padding: 8,
                          }}
                        >
                          Remove from queue
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          }
        />
        {writable ? (
          <View
            style={{
              padding: 12,
              borderTopWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
              gap: 8,
            }}
          >
            {!!body.trim() && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void openTranslation({ kind: "draft", scope: chatCacheKey })}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  alignSelf: "flex-start",
                }}
              >
                <Text style={{ color: colors.blue, fontWeight: "600" }}>Translate reply</Text>
              </Pressable>
            )}
            {file && (
              <View
                style={[
                  styles.row,
                  {
                    justifyContent: "space-between",
                    padding: 10,
                    backgroundColor: colors.pale,
                    borderRadius: 12,
                  },
                ]}
              >
                <Text numberOfLines={1} style={{ flex: 1, color: colors.ink }}>
                  {file.filename}
                </Text>
                <Pressable onPress={() => setFile(undefined)}>
                  <Text style={{ color: colors.blue, padding: 5 }}>✕</Text>
                </Pressable>
              </View>
            )}
            <View style={[styles.row, { gap: 7, alignItems: "flex-end" }]}>
              <Pressable
                accessibilityLabel="Attach photo"
                onPress={() => void choose(true)}
                style={{
                  minWidth: 44,
                  minHeight: 46,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="image-outline" size={23} color={colors.blue} />
              </Pressable>
              <Pressable
                accessibilityLabel="Attach file"
                onPress={() => void choose(false)}
                style={{
                  minWidth: 40,
                  minHeight: 46,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="attach-outline" size={24} color={colors.blue} />
              </Pressable>
              <Pressable
                accessibilityLabel="Choose a reply template"
                onPress={() => void openPanel("templates")}
                style={{
                  minWidth: 40,
                  minHeight: 46,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="document-text-outline" size={22} color={colors.blue} />
              </Pressable>
              <TextInput
                placeholderTextColor={colors.muted}
                accessibilityLabel="Message to customer"
                multiline
                maxLength={4000}
                placeholder="Write a reply…"
                value={body}
                onChangeText={setBody}
                style={[
                  styles.input,
                  {
                    flex: 1,
                    minHeight: 46,
                    maxHeight: 140,
                    paddingVertical: 12,
                  },
                ]}
              />
              <Pressable
                accessibilityLabel="Send message"
                onPress={() => void submit()}
                disabled={busy || (!body.trim() && !file)}
                style={{
                  width: 44,
                  height: 46,
                  backgroundColor: body.trim() || file ? colors.blue : colors.pale,
                  borderRadius: 15,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="arrow-up"
                  size={23}
                  color={body.trim() || file ? "#FFF" : colors.muted}
                />
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={{ padding: 20, textAlign: "center", color: colors.muted }}>
            Your role has read-only access.
          </Text>
        )}
      </KeyboardAvoidingView>
      {translation && session && workspaceId && (
        <TranslationPreviewPanel
          visible={translation.scope === chatCacheKey && !!canTranslate}
          scope={chatCacheKey}
          draft={translation.kind === "message" ? translation.message.body || "" : body}
          readOnly={translation.kind === "message"}
          onClose={() => setTranslation(null)}
          onUse={setBody}
          translate={(text, target) => {
            if (translation.kind === "message")
              return translateMessage(
                session.user.id,
                workspaceId,
                id,
                translation.message.id,
                target,
              );
            const binding = JSON.stringify([chatCacheKey, text, target]);
            if (translationRequest.current?.binding !== binding)
              translationRequest.current = { binding, id: Crypto.randomUUID() };
            return previewReplyTranslation(
              session.user.id,
              workspaceId,
              id,
              text,
              target,
              translationRequest.current!.id,
            );
          }}
        />
      )}
      <Modal
        visible={!!panel}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPanel(null)}
      >
        {panel === "transcript" && workspaceId && session ? (
          <TranscriptPanel
            key={`${workspaceId}:${id}:${session.user.id}`}
            workspaceId={workspaceId}
            conversationId={id}
            userId={session.user.id}
            initialEmail={detail?.contact?.email}
            onClose={() => setPanel(null)}
          />
        ) : panel === "notes" && workspaceId && session ? (
          <InternalNotesPanel
            key={`${workspaceId}:${id}:${session.user.id}`}
            workspaceId={workspaceId}
            conversationId={id}
            userId={session.user.id}
            onClose={() => setPanel(null)}
          />
        ) : (
          <SafeAreaView style={styles.screen}>
            <View style={[styles.row, { justifyContent: "space-between", padding: 22 }]}>
              <Text style={styles.heading}>
                {panel === "profile"
                  ? "Customer"
                  : panel === "notes"
                    ? "Internal notes"
                    : panel === "templates"
                      ? "Templates"
                      : "Manage conversation"}
              </Text>
              <Pressable onPress={() => setPanel(null)}>
                <Text style={{ color: colors.blue, padding: 8 }}>Done</Text>
              </Pressable>
            </View>
            <ErrorBanner message={error} />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ padding: 22, gap: 14 }}
            >
              {panel === "templates" && (
                <>
                  {templatesLoading && <ActivityIndicator color={colors.blue} />}
                  {!templatesLoading && templates.length === 0 && (
                    <Text style={styles.caption}>No saved replies yet.</Text>
                  )}
                  {templates.map((template) => (
                    <Pressable
                      key={template.id}
                      style={[styles.card, { gap: 8 }]}
                      onPress={() => {
                        setBody((previous) =>
                          [previous.trim(), template.body]
                            .filter(Boolean)
                            .join("\n\n")
                            .slice(0, 4000),
                        );
                        setPanel(null);
                      }}
                    >
                      <Text style={{ color: colors.ink, fontWeight: "700" }}>{template.title}</Text>
                      <Text style={styles.caption}>{template.body}</Text>
                      <Text style={{ color: colors.blue }}>Insert reply</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {panel === "profile" && (
                <View style={[styles.card, { gap: 16 }]}>
                  <Avatar name={name} size={64} />
                  <Text style={styles.heading}>{name}</Text>
                  {[
                    ["Email", detail?.contact?.email],
                    ["Phone", detail?.contact?.phone],
                    ["Page", detail?.source_url],
                    [
                      "Created",
                      detail?.created_at && new Date(detail.created_at).toLocaleDateString("en-US"),
                    ],
                  ].map(([label, value]) => (
                    <View key={label}>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
                      <Text selectable style={{ color: colors.ink, marginTop: 5 }}>
                        {value || "Not provided"}
                      </Text>
                    </View>
                  ))}
                  {detail?.visitor_session_id && (
                    <SaveContact visitorSessionId={detail.visitor_session_id} />
                  )}
                </View>
              )}
              {panel === "actions" && (
                <>
                  <Button
                    title="Customer profile"
                    subtle
                    onPress={() => void openPanel("profile")}
                  />
                  {role && can(role, "manage_internal_notes") && (
                    <Button title="Internal notes" subtle onPress={() => void openPanel("notes")} />
                  )}
                  {writable && (
                    <>
                      <Button
                        title="Email transcript"
                        subtle
                        onPress={() => void openPanel("transcript")}
                      />
                      <Button
                        title="Assign to me"
                        disabled={busy || !detail}
                        onPress={() =>
                          void action("take", {
                            conversationId: id,
                            expectedVersion: detail?.assignment_version,
                          })
                        }
                      />
                      <Button
                        title={
                          detail?.status === "closed" || detail?.status === "resolved"
                            ? "Reopen conversation"
                            : "Close conversation"
                        }
                        disabled={busy || !detail}
                        subtle
                        onPress={() =>
                          void action("status", {
                            conversationId: id,
                            status:
                              detail?.status === "closed" || detail?.status === "resolved"
                                ? "open"
                                : "closed",
                          })
                        }
                      />
                      <Text style={[styles.caption, { marginTop: 12 }]}>Assign to an operator</Text>
                      {members.map((member) => (
                        <Pressable
                          key={member.member_id}
                          disabled={busy}
                          onPress={() =>
                            void action("assign", {
                              conversationId: id,
                              assigneeMemberId: member.member_id,
                              expectedVersion: detail?.assignment_version,
                            })
                          }
                          style={[styles.card, styles.row, { gap: 12, padding: 14 }]}
                        >
                          <Avatar name={member.display_label} size={36} />
                          <Text style={{ color: colors.ink }}>{member.display_label}</Text>
                        </Pressable>
                      ))}
                      <Button
                        title="Unassign"
                        subtle
                        disabled={busy}
                        onPress={() =>
                          void action("assign", {
                            conversationId: id,
                            assigneeMemberId: null,
                            expectedVersion: detail?.assignment_version,
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}
