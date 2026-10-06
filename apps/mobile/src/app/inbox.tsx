import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router } from "expo-router";
import type { ConversationListItem, ListConversationsResult } from "@site-chat/shared";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import { useRealtime } from "../lib/realtime";
import { Avatar, Button, Empty, ErrorBanner, Logo, colors, styles } from "../components/ui";
import { usePushNavigation } from "../lib/push";

const tabs = [
  { key: "all", label: "Все" },
  { key: "unassigned", label: "Без оператора" },
  { key: "assigned_to_me", label: "Мои" },
  { key: "closed", label: "Закрытые" },
] as const;
export default function Inbox() {
  const {
    session,
    workspace,
    workspaces,
    selectWorkspace,
    online,
    error: workspaceError,
    reload,
  } = useMill();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ConversationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const request = useRef(0);
  usePushNavigation();
  const load = useCallback(
    async (nextPage = 1) => {
      if (!workspace) return;
      const version = ++request.current;
      setLoading(true);
      try {
        const result = await api<ListConversationsResult>("conversations", workspace.workspace_id, {
          page: nextPage,
          pageSize: 25,
          ...(query.trim() ? { q: query.trim() } : {}),
          ...(filter === "closed" ? { status: "closed" } : { assignment: filter }),
        });
        if (request.current !== version) return;
        setRows((old) =>
          nextPage === 1
            ? result.items
            : [...old, ...result.items.filter((r) => !old.some((o) => o.id === r.id))],
        );
        setTotal(result.total);
        setPage(nextPage);
        setError("");
      } catch (e) {
        if (request.current === version)
          setError(e instanceof Error ? e.message : "Не удалось загрузить диалоги.");
      } finally {
        if (request.current === version) setLoading(false);
      }
    },
    [workspace, filter, query],
  );
  useEffect(() => {
    request.current++;
    const timer = setTimeout(() => {
      setRows([]);
      void load();
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [load]);
  useRealtime(workspace?.workspace_id, () => void load());
  if (!session) return <Redirect href="/login" />;
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <View style={{ padding: 22, gap: 23 }}>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Logo small />
          <Pressable
            accessibilityLabel="Настройки оператора"
            onPress={() => router.push("/settings")}
          >
            <Avatar name={session.user.email || "Mill"} size={38} />
          </Pressable>
        </View>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={{ fontSize: 32, fontWeight: "700", letterSpacing: -1, color: colors.ink }}>
            Диалоги
          </Text>
          <Pressable
            onPress={() => setPicker(!picker)}
            style={[styles.row, { gap: 6, maxWidth: "55%" }]}
          >
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.blue, fontWeight: "600" }}>
              {workspace?.name || "Рабочее пространство"}
            </Text>
            <Text style={{ color: colors.blue }}>⌄</Text>
          </Pressable>
        </View>
        {picker && (
          <View style={styles.card}>
            {workspaces.map((w) => (
              <Pressable
                key={w.workspace_id}
                onPress={() => {
                  selectWorkspace(w.workspace_id);
                  setPicker(false);
                }}
                style={{ paddingVertical: 12 }}
              >
                <Text
                  style={{
                    color: w.workspace_id === workspace?.workspace_id ? colors.blue : colors.ink,
                  }}
                >
                  {w.name} · {w.role}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          accessibilityLabel="Поиск диалогов"
          placeholder="Поиск разговоров и клиентов"
          value={query}
          onChangeText={setQuery}
          style={[styles.input, { backgroundColor: "#EDF1F7", borderWidth: 0, minHeight: 46 }]}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 22, gap: 8, paddingBottom: 16 }}
        style={{ flexGrow: 0 }}
      >
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setFilter(tab.key)}
            style={{
              paddingHorizontal: 15,
              paddingVertical: 10,
              borderRadius: 22,
              backgroundColor: filter === tab.key ? colors.ink : "#FFF",
            }}
          >
            <Text
              style={{
                color: filter === tab.key ? "#FFF" : colors.muted,
                fontWeight: "600",
                fontSize: 13,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {!online && (
        <ErrorBanner message="Нет сети. Очередь сообщений сохранена; отправим при подключении." />
      )}
      <ErrorBanner message={error || workspaceError} />
      {!workspace ? (
        <View style={{ flex: 1 }}>
          <Empty
            title="Ваше рабочее пространство"
            detail="Здесь появятся доступные вам пространства Mill."
          />
          <Button title="Обновить" subtle onPress={() => void reload()} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load()}
              tintColor={colors.blue}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            !loading ? (
              <Empty
                title={error ? "Не удалось загрузить диалоги" : "Всё спокойно"}
                detail={
                  error ? "Потяните вниз, чтобы повторить." : "Новые разговоры появятся здесь."
                }
              />
            ) : null
          }
          onEndReached={() => {
            if (!loading && rows.length < total) void load(page + 1);
          }}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => {
            const name = item.contact?.name || item.contact?.email || "Посетитель";
            const time = new Date(item.last_message_at || item.created_at).toLocaleTimeString(
              "ru",
              { hour: "2-digit", minute: "2-digit" },
            );
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/chat/[id]",
                    params: { id: item.id, workspaceId: workspace.workspace_id },
                  })
                }
                style={({ pressed }) => [
                  styles.row,
                  {
                    padding: 16,
                    gap: 13,
                    backgroundColor: pressed ? colors.pale : "#FFF",
                    borderRadius: 20,
                    marginBottom: 7,
                  },
                ]}
              >
                <Avatar name={name} />
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={[styles.row, { justifyContent: "space-between", gap: 8 }]}>
                    <Text
                      numberOfLines={1}
                      style={{
                        flex: 1,
                        fontSize: 16,
                        fontWeight: item.has_unread ? "700" : "600",
                        color: colors.ink,
                      }}
                    >
                      {name}
                    </Text>
                    <Text
                      style={{ fontSize: 11, color: item.has_unread ? colors.blue : colors.muted }}
                    >
                      {time}
                    </Text>
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{ fontSize: 13, lineHeight: 19, color: colors.muted }}
                  >
                    {item.last_message_preview || "Новый разговор"}
                  </Text>
                  <View style={[styles.row, { justifyContent: "space-between" }]}>
                    <Text style={{ fontSize: 11, color: colors.muted }}>
                      {item.assigned_to?.display_label || "Без оператора"}
                    </Text>
                    {item.has_unread && (
                      <View
                        style={{
                          backgroundColor: colors.blue,
                          borderRadius: 10,
                          minWidth: 20,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ fontSize: 11, color: "#FFF", textAlign: "center" }}>
                          {item.unread_count || "•"}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
