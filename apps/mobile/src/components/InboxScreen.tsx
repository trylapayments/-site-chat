import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, router, useFocusEffect } from "expo-router";
import { allConversationsResultSchema, can } from "@site-chat/shared";
import { SwipeConversation } from "../components/SwipeConversation";
import { fetchChatBootstrap } from "../lib/chat-cache";
import { cacheKey, cached, remember } from "../lib/cache";
import type { ListConversationsResult } from "@site-chat/shared";
import { CompanyChoices } from "../components/CompanyChoices";
import { useCompanyInboxes } from "../lib/company-inboxes";
import { conversationCompany, type CompanyConversation } from "../core/company-inbox";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import {
  startReviewProgress,
  noteSuccessfulClose,
  requestReviewWhenIdle,
} from "../lib/app-review";
import { useRealtime } from "../lib/realtime";
import { Avatar, BrandWash, Button, Empty, ErrorBanner, Logo, useTheme } from "../components/ui";

const tabs = [
  { key: "all", label: "All open" },
  { key: "unassigned", label: "Unassigned" },
  { key: "assigned_to_me", label: "Mine" },
  { key: "closed", label: "Closed" },
] as const;
type InboxOptions = { embedded?: boolean; selectedId?: string; selectedWorkspaceId?: string };
export default function Inbox(options: InboxOptions) {
  const { session, workspace } = useMill();
  return <InboxContent key={`${session?.user.id}:${workspace?.workspace_id}`} {...options} />;
}
function InboxContent({ embedded = false, selectedId, selectedWorkspaceId }: InboxOptions) {
  const { colors, styles } = useTheme();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.2;
  const {
    session,
    workspace,
    workspaces,
    selectWorkspace,
    allWebsites,
    selectAllWebsites,
    online,
    active,
    pending,
    error: workspaceError,
    reload,
  } = useMill();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<CompanyConversation[]>([]);
  const { companies, refresh: refreshCompanyInboxes } = useCompanyInboxes();
  const counts = Object.fromEntries(
    companies.map((company) => [company.workspace_id, company.unread_total]),
  );
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const focused = useRef(false);
  const hasLoaded = useRef(false);
  const [settled, setSettled] = useState(false);
  const [error, setError] = useState("");
  const [picker, setPicker] = useState(false);
  const request = useRef(0);
  const lastInteraction = useRef(0);
  const reviewReady =
    !embedded &&
    active &&
    online &&
    !loading &&
    settled &&
    !refreshing &&
    !picker &&
    !query &&
    !error &&
    !workspaceError &&
    pending.length === 0;
  useEffect(() => {
    if (session) void startReviewProgress(session.user.id);
  }, [session]);
  useEffect(() => {
    let cancelled = false;
    const userId = session?.user.id;
    if (!reviewReady || !userId) return;
    const timer = setTimeout(() => {
      void requestReviewWhenIdle(
        userId,
        () => !cancelled && focused.current && Date.now() - lastInteraction.current >= 2000,
      );
    }, 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, reviewReady]);
  const workspaceId = workspace?.workspace_id;
  const inboxScope = allWebsites ? "all" : workspaceId;
  const inboxKey =
    session && workspaceId
      ? cacheKey(
          session.user.id,
          allWebsites ? "all-websites" : workspaceId,
          `inbox:status-groups-v4:${filter}:${query.trim()}`,
        )
      : "";
  const load = useCallback(
    async (nextPage = 1) => {
      if (!workspaceId) return;
      const version = ++request.current;
      setLoading(true);
      try {
        const response = await api<
          Omit<ListConversationsResult, "items"> & { items: CompanyConversation[] }
        >(
          allWebsites ? "allConversations" : "conversations",
          allWebsites ? undefined : workspaceId,
          {
            page: nextPage,
            pageSize: 25,
            ...(query.trim() ? { q: query.trim() } : {}),
            ...(filter === "closed"
              ? { statusGroup: "completed" }
              : { statusGroup: "active", assignment: filter }),
          },
          session?.user.id,
        );
        const result = allWebsites ? allConversationsResultSchema.parse(response) : response;
        if (request.current !== version) return;
        setRows((old) =>
          nextPage === 1
            ? result.items
            : [...old, ...result.items.filter((r) => !old.some((o) => o.id === r.id))],
        );
        hasLoaded.current = true;
        setSettled(true);
        if (nextPage === 1) remember(inboxKey, result);
        setTotal(result.total);
        setPage(nextPage);
        setError("");
      } catch (e) {
        if (request.current === version)
          setError(e instanceof Error ? e.message : "Unable to load conversations.");
      } finally {
        if (request.current === version) setLoading(false);
      }
    },
    [workspaceId, filter, query, inboxKey, allWebsites, session],
  );
  useEffect(() => {
    request.current++;
    hasLoaded.current = false;
    const timer = setTimeout(
      () => {
        const warm = cached<ListConversationsResult>(inboxKey);
        setSettled(!!warm);
        setRows(warm?.items ?? []);
        setTotal(warm?.total ?? 0);
        void load();
      },
      query.trim() ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [load, inboxKey, query]);
  const loadLatest = useRef(load);
  useEffect(() => {
    loadLatest.current = load;
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (hasLoaded.current) void loadLatest.current();
      return () => {
        focused.current = false;
        setRefreshing(false);
      };
    }, []),
  );
  useRealtime(
    workspaceId,
    () => {
      void refreshCompanyInboxes().catch(() => {});
      if (focused.current) void loadLatest.current();
    },
    undefined,
    workspaces.map((company) => company.workspace_id),
  );
  if (!session) return <Redirect href="/login" />;
  return (
    <SafeAreaView
      onTouchStart={() => {
        lastInteraction.current = Date.now();
      }}
      style={styles.screen}
      edges={embedded ? ["top", "bottom", "left"] : ["top", "left", "right"]}
    >
      <View style={{ padding: embedded ? 16 : 22, gap: embedded ? 14 : 20 }}>
        <BrandWash />
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Logo small />
          <Pressable
            accessibilityLabel="Operator settings"
            onPress={() => router.push("/settings")}
          >
            <Avatar name={session.user.email || "Mill"} size={38} />
          </Pressable>
        </View>
        <View style={[styles.row, { justifyContent: "space-between" }]}>
          <Text style={{ fontSize: embedded ? 28 : 34, fontWeight: "800", letterSpacing: -1, color: colors.ink }}>
            Chats
          </Text>
          <Pressable
            onPress={() => setPicker(!picker)}
            style={[styles.row, { gap: 6, maxWidth: "55%" }]}
          >
            <Text numberOfLines={1} style={{ fontSize: 14, color: colors.blue, fontWeight: "600" }}>
              {allWebsites ? "All Websites" : workspace?.name || "Company"}
            </Text>
            <Text style={{ color: colors.blue }}>⌄</Text>
          </Pressable>
        </View>
        {picker && (
          <View style={styles.card}>
            <CompanyChoices
              workspaces={workspaces}
              counts={counts}
              selected={allWebsites ? "all" : (workspaceId ?? null)}
              onSelect={(id) => {
                if (id === "all") selectAllWebsites();
                else selectWorkspace(id);
                setPicker(false);
              }}
            />
          </View>
        )}
        <TextInput
          accessibilityLabel="Search conversations"
          placeholder="Search conversations and customers"
          value={query}
          onChangeText={setQuery}
          style={[styles.input, { backgroundColor: colors.input, borderWidth: 0, minHeight: 46 }]}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={largeText || embedded}
        contentContainerStyle={{
          paddingHorizontal: 12,
          gap: 6,
          paddingBottom: 16,
          width: largeText || embedded ? undefined : "100%",
        }}
        style={{ flexGrow: 0 }}
      >
        {tabs.map((tab) => (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.key === "assigned_to_me" ? "Assigned to me" : tab.label}
            accessibilityState={{ selected: filter === tab.key }}
            onPress={() => setFilter(tab.key)}
            style={{
              flex: largeText || embedded
                ? undefined
                : tab.key === "unassigned"
                  ? 1.25
                  : tab.key === "all"
                    ? 1.05
                    : 0.85,
              paddingHorizontal: largeText || embedded ? 15 : 6,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              backgroundColor: filter === tab.key ? colors.blue : colors.surface,
            }}
          >
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit={!largeText}
              minimumFontScale={0.85}
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
        <ErrorBanner message="You're offline. Messages are saved and will send when you reconnect." />
      )}
      <ErrorBanner message={error || workspaceError} />
      {!workspace ? (
        <View style={{ flex: 1 }}>
          <Empty title="Your workspace" detail="Your available Mill workspaces will appear here." />
          <Button title="Refresh" subtle onPress={() => void reload()} />
        </View>
      ) : (
        <FlatList
          key={`inbox-v4:${inboxScope}:${filter}`}
          style={{ flex: 1 }}
          data={rows.filter(
            (item) => !!inboxScope && !!conversationCompany(item, inboxScope, workspaces),
          )}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
              tintColor={colors.blue}
            />
          }
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40, flexGrow: 1 }}
          ListEmptyComponent={
            !loading || settled ? (
              <Empty
                title={error ? "Unable to load conversations" : "You're all caught up"}
                detail={error ? "Pull down to try again." : "New conversations will appear here."}
              />
            ) : (
              <View style={{ paddingVertical: 48, alignItems: "center", gap: 12 }}>
                <ActivityIndicator color={colors.blue} />
                <Text style={{ color: colors.muted }}>Loading conversations…</Text>
              </View>
            )
          }
          onEndReached={() => {
            if (!loading && rows.length < total) void load(page + 1);
          }}
          onEndReachedThreshold={0.3}
          renderItem={({ item }) => {
            const company = inboxScope ? conversationCompany(item, inboxScope, workspaces) : null;
            if (!company) return null;
            const name = item.contact?.name || item.contact?.email || "Visitor";
            const time = new Date(item.last_message_at || item.created_at).toLocaleTimeString(
              "en-US",
              { hour: "2-digit", minute: "2-digit" },
            );
            return (
              <SwipeConversation
                closed={item.status === "closed" || item.status === "resolved"}
                disabled={!online || !can(company.role, "update_conversation_status")}
                onClose={async () => {
                  try {
                    await api(
                      "status",
                      company.workspace_id,
                      { conversationId: item.id, status: "closed" },
                      session.user.id,
                    );
                    void noteSuccessfulClose(session.user.id, company.workspace_id, item.id);
                    setRows((old) =>
                      filter === "closed" ? old : old.filter((row) => row.id !== item.id),
                    );
                    void loadLatest.current();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Unable to close this conversation.");
                  }
                }}
              >
                <Pressable
                  onPress={() => {
                    void fetchChatBootstrap(session.user.id, company.workspace_id, item.id).catch(
                      () => {},
                    );
                    (embedded ? router.replace : router.push)({
                      pathname: "/chat/[id]",
                      params: { id: item.id, workspaceId: company.workspace_id },
                    });
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      padding: 16,
                      gap: 13,
                      backgroundColor:
                        pressed || (item.id === selectedId && company.workspace_id === selectedWorkspaceId)
                          ? colors.pale
                          : colors.surface,
                      borderRadius: 20,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor:
                        item.id === selectedId && company.workspace_id === selectedWorkspaceId
                          ? colors.blue
                          : item.has_unread ? colors.pale : colors.line,
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
                        style={{
                          fontSize: 11,
                          color: item.has_unread ? colors.blue : colors.muted,
                        }}
                      >
                        {time}
                      </Text>
                    </View>
                    {allWebsites && (
                      <Text
                        numberOfLines={1}
                        style={{ color: colors.blue, fontSize: 11, fontWeight: "600" }}
                      >
                        {company.name}
                      </Text>
                    )}
                    <Text
                      numberOfLines={2}
                      style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}
                    >
                      {item.last_message_preview || "New conversation"}
                    </Text>
                    <View style={[styles.row, { justifyContent: "space-between" }]}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        {item.assigned_to?.display_label || "Unassigned"}
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
              </SwipeConversation>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
