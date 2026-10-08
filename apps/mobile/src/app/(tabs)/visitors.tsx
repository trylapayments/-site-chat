import React, { useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  ScrollView,
  Pressable,
  RefreshControl,
  Text,
  View,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Avatar, Button, Empty, ErrorBanner, useTheme } from "../../components/ui";
import { VisitorLocation } from "../../components/VisitorLocation";
import { VisitorChatComposer } from "../../components/VisitorChatComposer";
import { SaveContact } from "../../components/SaveContact";
import { DirectoryHeader } from "../../components/DirectoryHeader";
import { useDirectory } from "../../lib/useDirectory";
import { useMill } from "../../lib/session";
type Visitor = {
  id: string;
  workspace: { id: string; name: string; slug: string };
  canSend: boolean;
  name: string | null;
  email: string | null;
  country?: string | null;
  city?: string | null;
  ip: string | null;
  url: string | null;
  title: string | null;
  device: string | null;
  lastSeenAt: string;
  conversationId: string | null;
  status: string;
};
export default function Visitors() {
  const { session } = useMill();
  return <VisitorsContent key={session?.user.id} />;
}
function VisitorsContent() {
  const { colors, styles } = useTheme();
  const { workspaces, online, active } = useMill();
  const [selected, setSelected] = useState<Visitor | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [active]);
  const { data, loading, error, refresh } = useDirectory<Visitor[]>("allVisitors", {}, 3000, true);
  const rows = (data ?? []).filter(
    (visitor) =>
      now - Date.parse(visitor.lastSeenAt) < 90000 &&
      workspaces.some((w) => w.workspace_id === visitor.workspace?.id),
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <DirectoryHeader
        title="Visitors"
        detail={
          online
            ? `${rows.length} online now · All Websites`
            : "Offline · Reconnecting to live visitors"
        }
      />
      <ErrorBanner message={error} />
      <FlatList
        data={rows}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={loading && !data}
            onRefresh={() => void refresh()}
            tintColor={colors.blue}
          />
        }
        ListEmptyComponent={
          <Empty
            icon="people-outline"
            loading={loading && !data}
            title={loading && !data ? "Finding online visitors…" : "Your site is quiet"}
            detail="People currently browsing your websites appear here."
          />
        }
        renderItem={({ item: v }) => (
          <Pressable
            onPress={() => setSelected(v)}
            style={[styles.card, styles.row, { gap: 12, marginBottom: 10, padding: 16 }]}
          >
            <Avatar name={v.name || v.email || "Visitor"} online />
            <View style={{ flex: 1, gap: 5 }}>
              <View style={[styles.row, { gap: 8 }]}>
                <View
                  style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.green }}
                />
                <Text numberOfLines={1} style={{ color: colors.ink, fontWeight: "600", flex: 1 }}>
                  {v.name || v.email || "Visitor"}
                </Text>
              </View>
              <Text numberOfLines={1} style={styles.caption}>
                {v.workspace.name} · {v.title || v.url || "Browsing your website"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted }}>
                {[v.device, v.status].filter(Boolean).join(" · ")}
              </Text>
              <VisitorLocation visitor={v} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Visitor details"
              onPress={(event) => {
                event.stopPropagation();
                setSelected(v);
              }}
              hitSlop={8}
              style={{
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.blue, fontSize: 25 }}>›</Text>
            </Pressable>
          </Pressable>
        )}
      />
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.screen}>
          <View style={[styles.row, { justifyContent: "space-between", padding: 22 }]}>
            <Text style={styles.heading}>Visitor details</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close visitor details"
              onPress={() => setSelected(null)}
              style={{ minHeight: 44, justifyContent: "center" }}
            >
              <Text style={{ color: colors.blue, fontSize: 17 }}>Done</Text>
            </Pressable>
          </View>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 40 }}
            >
              {selected && (
                <>
                  <Avatar name={selected.name || selected.email || "Visitor"} size={64} />
                  <Text style={styles.heading}>{selected.name || selected.email || "Visitor"}</Text>
                  <Text selectable style={styles.caption}>
                    {selected.title || selected.url || "Browsing your website"}
                  </Text>
                  <Text style={styles.caption}>{selected.device || ""}</Text>
                  <VisitorLocation visitor={selected} detailed />
                  <SaveContact visitorSessionId={selected.id} workspaceId={selected.workspace.id} />
                  {selected.canSend && (
                    <VisitorChatComposer
                      key={selected.id}
                      visitorId={selected.id}
                      workspaceId={selected.workspace.id}
                      onStarted={(id) => {
                        setSelected(null);
                        router.push({
                          pathname: "/chat/[id]",
                          params: { id, workspaceId: selected.workspace.id },
                        });
                      }}
                    />
                  )}
                  {selected.conversationId && (
                    <Button
                      title="Open chat"
                      onPress={() => {
                        const visitor = selected;
                        setSelected(null);
                        router.push({
                          pathname: "/chat/[id]",
                          params: {
                            id: visitor.conversationId!,
                            workspaceId: visitor.workspace.id,
                          },
                        });
                      }}
                    />
                  )}
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
