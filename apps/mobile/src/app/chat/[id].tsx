import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import {
  can,
  type ConversationDetail,
  type InternalNote,
  type ListInternalNotesResult,
  type ListMessagesResult,
  type MessageItem,
  type WorkspaceMemberOption,
  type MessageAttachmentView,
} from "@site-chat/shared";
import { api } from "../../lib/client";
import { useMill } from "../../lib/session";
import { useRealtime } from "../../lib/realtime";
import { mergeMessages, type PendingMessage } from "../../core/outbox";
import { pickFile } from "../../lib/files";
import { Avatar, Button, Empty, ErrorBanner, colors, styles } from "../../components/ui";

function Attachment({
  attachment,
  workspaceId,
}: {
  attachment: MessageAttachmentView;
  workspaceId: string;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const data = await api<{ url: string }>("download", workspaceId, {
        attachmentId: attachment.id,
      });
      setUrl(data.url);
      setError("");
      return data.url;
    } catch {
      setError("Не удалось открыть файл");
      return null;
    }
  }, [workspaceId, attachment.id]);
  useEffect(() => {
    if (attachment.kind === "image") void Promise.resolve().then(load);
  }, [load, attachment.kind]);
  return (
    <Pressable
      onPress={() =>
        void load().then((value) => {
          if (value) void Linking.openURL(value);
        })
      }
      style={{ paddingVertical: 6 }}
      accessibilityLabel={`Открыть ${attachment.filename}`}
    >
      {attachment.kind === "image" && url ? (
        <Image
          source={{ uri: url }}
          style={{ width: 210, height: 160, borderRadius: 12 }}
          resizeMode="cover"
          onError={() => setError("Ссылка истекла. Нажмите для обновления.")}
        />
      ) : (
        <Text style={{ color: colors.blue, fontWeight: "600" }}>↗ {attachment.filename}</Text>
      )}
      <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>
        {error || `${Math.ceil(attachment.size_bytes / 1024)} КБ`}
      </Text>
    </Pressable>
  );
}

export default function Chat() {
  const params = useLocalSearchParams<{ id: string; workspaceId: string }>();
  const id = params.id;
  const {
    session,
    workspace,
    selectWorkspace,
    workspaces,
    online,
    pending,
    send,
    retry,
    discard,
    active,
  } = useMill();
  const workspaceId = params.workspaceId || workspace?.workspace_id;
  const role = workspaces.find((w) => w.workspace_id === workspaceId)?.role;
  const writable = !!role && can(role, "send_messages");
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [older, setOlder] = useState(false);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<PendingMessage["file"]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"actions" | "profile" | "notes" | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberOption[]>([]);
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [note, setNote] = useState("");
  const scope = useRef("");
  useEffect(() => {
    scope.current = `${workspaceId}:${id}`;
  }, [workspaceId, id]);
  const latest = useRef(0);
  const list = useRef<FlatList>(null);
  const atBottom = useRef(true);
  const noteId = useRef(Crypto.randomUUID());
  const oldestSequence = messages[0]?.sequence_number;
  const newestSequence = messages[messages.length - 1]?.sequence_number;
  const refresh = useCallback(
    async (history = false) => {
      if (!workspaceId || !id) return;
      if (history) atBottom.current = false;
      const identity = `${workspaceId}:${id}`;
      try {
        const conversation = await api<ConversationDetail>("conversation", workspaceId, {
          conversationId: id,
        });
        const result = await api<ListMessagesResult>("messages", workspaceId, {
          conversationId: id,
          query:
            history && oldestSequence
              ? { before_sequence: oldestSequence, limit: 50 }
              : { limit: 50 },
        });
        if (scope.current !== identity) return;
        setDetail(conversation);
        setMessages((previous) => mergeMessages(previous, result.items));
        if (history || latest.current === 0) setOlder(result.has_older);
        // Resume catches every gap, including more than one page of messages.
        const oldCursor = latest.current;
        if (!history && oldCursor > 0) {
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
          setError(e instanceof Error ? e.message : "Не удалось загрузить разговор.");
      }
    },
    [workspaceId, id, oldestSequence],
  );
  const initialRefresh = useRef(refresh);
  useEffect(() => {
    initialRefresh.current = refresh;
  }, [refresh]);
  useEffect(() => {
    const identity = `${workspaceId}:${id}`;
    void Promise.resolve().then(() => {
      if (scope.current !== identity) return;
      setDetail(null);
      setMessages([]);
      latest.current = 0;
      if (workspaceId) selectWorkspace(workspaceId);
      void initialRefresh.current();
    });
    return () => {
      scope.current = "";
    };
  }, [workspaceId, id, selectWorkspace]);
  useRealtime(workspaceId, () => void refresh());
  useFocusEffect(
    useCallback(() => {
      if (!active || !workspaceId || newestSequence === undefined) return;
      void api("read", workspaceId, { conversationId: id, throughSequence: newestSequence }).catch(
        () => {},
      );
    }, [active, workspaceId, id, newestSequence]),
  );
  async function action(operation: string, input: unknown) {
    if (!workspaceId || busy) return false;
    setBusy(true);
    try {
      await api(operation, workspaceId, input);
      await refresh();
      void Haptics.selectionAsync();
      setPanel(null);
      setError("");
      return true;
    } catch (e) {
      await refresh();
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function openPanel(next: typeof panel) {
    setPanel(next);
    if (!workspaceId) return;
    try {
      if (next === "actions")
        setMembers(await api<WorkspaceMemberOption[]>("members", workspaceId));
      if (next === "notes")
        setNotes(
          (await api<ListInternalNotesResult>("notes", workspaceId, { conversationId: id })).items,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить данные.");
    }
  }
  async function submit() {
    if (busy || (!body.trim() && !file) || !workspaceId) return;
    setBusy(true);
    try {
      await send(id, body.trim(), file);
      setBody("");
      setFile(undefined);
      void Haptics.selectionAsync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить сообщение.");
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
      setError(e instanceof Error ? e.message : "Не удалось выбрать файл.");
    }
  }
  if (!session) return <Redirect href="/login" />;
  const name = detail?.contact?.name || detail?.contact?.email || "Посетитель";
  const local = pending.filter(
    (m) =>
      m.workspaceId === workspaceId &&
      m.conversationId === id &&
      !messages.some((row) => row.client_message_id === m.id),
  );
  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View
        style={[
          styles.row,
          {
            paddingHorizontal: 16,
            paddingVertical: 12,
            gap: 12,
            borderBottomWidth: 1,
            borderColor: colors.line,
            backgroundColor: "#FFF",
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Назад к диалогам"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/inbox"))}
          style={{ width: 32, height: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.blue, fontSize: 32 }}>‹</Text>
        </Pressable>
        <Avatar name={name} size={38} />
        <Pressable onPress={() => void openPanel("profile")} style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>
            {name}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
            {detail?.assigned_to?.display_label || "Без оператора"} ·{" "}
            {detail?.status
              ? { open: "Открыт", pending: "В ожидании", resolved: "Завершён", closed: "Закрыт" }[
                  detail.status
                ]
              : "Загрузка"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Действия с диалогом"
          onPress={() => void openPanel("actions")}
          style={{ padding: 10 }}
        >
          <Text style={{ fontSize: 25, color: colors.blue }}>•••</Text>
        </Pressable>
      </View>
      <ErrorBanner message={error} />
      {!online && (
        <Text style={{ textAlign: "center", color: colors.muted, padding: 8 }}>
          Нет сети · сообщения сохранены в очереди
        </Text>
      )}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 18, gap: 12, flexGrow: 1 }}
          onContentSizeChange={() => {
            if (atBottom.current) list.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
            atBottom.current =
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
          }}
          scrollEventThrottle={100}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={
            older ? (
              <Button
                title="Загрузить предыдущие сообщения"
                subtle
                onPress={() => void refresh(true)}
              />
            ) : null
          }
          ListEmptyComponent={
            !detail ? <Empty title="Открываем разговор" detail="Загружаем историю Mill." /> : null
          }
          renderItem={({ item }) => {
            if (item.sender_type === "system")
              return (
                <Text
                  style={{ textAlign: "center", fontSize: 11, color: colors.muted, padding: 8 }}
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
                  backgroundColor: mine ? colors.blue : "#FFF",
                  borderRadius: 20,
                  borderBottomRightRadius: mine ? 6 : 20,
                  borderBottomLeftRadius: mine ? 20 : 6,
                  paddingHorizontal: 15,
                  paddingVertical: 12,
                }}
              >
                {!mine && (
                  <Text style={{ fontSize: 10, color: colors.muted, marginBottom: 4 }}>
                    {item.sender_label}
                  </Text>
                )}
                {!!item.body && (
                  <Text
                    selectable
                    style={{ color: mine ? "#FFF" : colors.ink, fontSize: 16, lineHeight: 23 }}
                  >
                    {item.body}
                  </Text>
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
                  {new Date(item.created_at).toLocaleTimeString("ru", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {mine
                    ? item.sequence_number <= (detail?.visitor_last_read_sequence || 0)
                      ? " · Прочитано"
                      : " · Отправлено"
                    : ""}
                </Text>
              </View>
            );
          }}
          ListFooterComponent={
            <View style={{ gap: 12 }}>
              {local.map((item) => (
                <View
                  key={item.id}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "85%",
                    backgroundColor: "#E8EEFC",
                    borderRadius: 18,
                    padding: 14,
                  }}
                >
                  <Text style={{ color: colors.ink, fontSize: 16 }}>
                    {item.body || item.file?.filename}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 7 }}>
                    {item.state === "failed" ? "Не отправлено" : "В очереди…"}
                    {item.file ? ` · ${item.file.filename}` : ""}
                  </Text>
                  {item.state === "failed" && (
                    <View style={{ gap: 8, marginTop: 10 }}>
                      <Text style={{ color: "#9C3E43", fontSize: 12 }}>{item.error}</Text>
                      <Button title="Повторить" subtle onPress={() => void retry(item.id)} />
                      <Pressable onPress={() => void discard(item.id)}>
                        <Text style={{ color: colors.muted, textAlign: "center", padding: 8 }}>
                          Удалить из очереди
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
              backgroundColor: "#FFF",
              gap: 8,
            }}
          >
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
                accessibilityLabel="Прикрепить фото"
                onPress={() => void choose(true)}
                style={{ padding: 10 }}
              >
                <Text style={{ fontSize: 24, color: colors.blue }}>▧</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Прикрепить файл"
                onPress={() => void choose(false)}
                style={{ padding: 7 }}
              >
                <Text style={{ fontSize: 24, color: colors.blue }}>＋</Text>
              </Pressable>
              <TextInput
                accessibilityLabel="Сообщение клиенту"
                multiline
                maxLength={4000}
                placeholder="Написать ответ…"
                value={body}
                onChangeText={setBody}
                style={[
                  styles.input,
                  { flex: 1, minHeight: 46, maxHeight: 140, paddingVertical: 12 },
                ]}
              />
              <Pressable
                accessibilityLabel="Отправить сообщение"
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
                <Text style={{ color: body.trim() || file ? "#FFF" : colors.muted, fontSize: 24 }}>
                  ↑
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={{ padding: 20, textAlign: "center", color: colors.muted }}>
            Для вашей роли доступен просмотр.
          </Text>
        )}
      </KeyboardAvoidingView>
      <Modal
        visible={!!panel}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPanel(null)}
      >
        <SafeAreaView style={styles.screen}>
          <View style={[styles.row, { justifyContent: "space-between", padding: 22 }]}>
            <Text style={styles.heading}>
              {panel === "profile"
                ? "Клиент"
                : panel === "notes"
                  ? "Внутренние заметки"
                  : "Управление диалогом"}
            </Text>
            <Pressable onPress={() => setPanel(null)}>
              <Text style={{ color: colors.blue, padding: 8 }}>Готово</Text>
            </Pressable>
          </View>
          <ErrorBanner message={error} />
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 22, gap: 14 }}
          >
            {panel === "profile" && (
              <View style={[styles.card, { gap: 16 }]}>
                <Avatar name={name} size={64} />
                <Text style={styles.heading}>{name}</Text>
                {[
                  ["Email", detail?.contact?.email],
                  ["Телефон", detail?.contact?.phone],
                  ["Страница", detail?.source_url],
                  [
                    "Создан",
                    detail?.created_at && new Date(detail.created_at).toLocaleDateString("ru"),
                  ],
                ].map(([label, value]) => (
                  <View key={label}>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{label}</Text>
                    <Text selectable style={{ color: colors.ink, marginTop: 5 }}>
                      {value || "Не указан"}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {panel === "actions" && (
              <>
                <Button title="Карточка клиента" subtle onPress={() => void openPanel("profile")} />
                {role && can(role, "manage_internal_notes") && (
                  <Button
                    title="Внутренние заметки"
                    subtle
                    onPress={() => void openPanel("notes")}
                  />
                )}
                {writable && (
                  <>
                    <Button
                      title="Взять диалог"
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
                          ? "Открыть заново"
                          : "Закрыть диалог"
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
                    <Text style={[styles.caption, { marginTop: 12 }]}>Назначить оператору</Text>
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
                      title="Снять назначение"
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
            {panel === "notes" && (
              <>
                <Text style={styles.caption}>Заметки видит только ваша команда.</Text>
                {notes.map((item) => (
                  <View key={item.id} style={[styles.card, { backgroundColor: "#FFF9E9", gap: 8 }]}>
                    <Text style={{ fontWeight: "600", color: colors.ink }}>
                      {item.author_display_label}
                    </Text>
                    <Text selectable style={{ color: colors.ink, lineHeight: 22 }}>
                      {item.body}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {new Date(item.created_at).toLocaleString("ru")}
                    </Text>
                  </View>
                ))}
                <TextInput
                  accessibilityLabel="Внутренняя заметка"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  maxLength={4000}
                  placeholder="Добавить заметку для команды…"
                  style={[styles.input, { minHeight: 100, paddingVertical: 15 }]}
                />
                <Button
                  title="Добавить заметку"
                  disabled={busy || !note.trim()}
                  onPress={() => {
                    void action("note", {
                      conversationId: id,
                      body: note.trim(),
                      clientNoteId: noteId.current,
                    }).then((success) => {
                      if (success) {
                        setNote("");
                        noteId.current = Crypto.randomUUID();
                      }
                    });
                  }}
                />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
