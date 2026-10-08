import React, { useEffect, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { can } from "@site-chat/shared";
import { CreateTemplatePanel } from "../../components/CreateTemplatePanel";
import type { CannedResponse, ListCannedResponsesResult } from "@site-chat/shared";
import { Button, Empty, ErrorBanner, useTheme } from "../../components/ui";
import { DirectoryHeader } from "../../components/DirectoryHeader";
import { useMill } from "../../lib/session";
import { useDirectory } from "../../lib/useDirectory";
export default function Templates() {
  const { session, workspace } = useMill();
  return <TemplatesContent key={`${session?.user.id}:${workspace?.workspace_id}`} />;
}
function TemplatesContent() {
  const { workspace } = useMill();
  const [creating, setCreating] = useState(false);
  const { colors, styles } = useTheme();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CannedResponse | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, loading, error, refresh } = useDirectory<ListCannedResponsesResult>(
    "templates",
    {
      limit: 100,
      ...(search ? { q: search } : {}),
    },
    5000,
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.screen}>
      <DirectoryHeader title="Templates" detail="Ready-to-use replies for your team" />
      <TextInput
        accessibilityLabel="Search templates"
        placeholder="Search replies and shortcuts"
        placeholderTextColor={colors.muted}
        value={query}
        onChangeText={setQuery}
        style={[styles.input, { marginHorizontal: 20, marginBottom: 16 }]}
      />
      {workspace && can(workspace.role, "use_canned_responses") && (
        <View style={{ paddingHorizontal: 20, marginBottom: 16, alignItems: "flex-start" }}>
          <Button title="New template" subtle onPress={() => setCreating(true)} />
        </View>
      )}
      <ErrorBanner message={error} />
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(item) => item.id}
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
            icon="document-text-outline"
            loading={loading && !data}
            title={loading && !data ? "Loading templates…" : "No templates yet"}
            detail="Your team’s saved replies are available here and in the conversation composer."
          />
        }
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, { padding: 18, gap: 8, marginBottom: 10 }]}
            onPress={() => setSelected(item)}
          >
            <Text style={{ color: colors.ink, fontWeight: "700", fontSize: 16 }}>{item.title}</Text>
            <Text numberOfLines={2} style={styles.caption}>
              {item.body}
            </Text>
            <Text style={{ color: colors.blue, fontSize: 12 }}>
              {item.shortcut ? `/${item.shortcut} · ` : ""}
              {item.visibility === "personal" ? "Personal" : "Team"}
            </Text>
          </Pressable>
        )}
      />
      <Modal
        visible={creating}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setCreating(false)}
      >
        {creating && (
          <CreateTemplatePanel
            onClose={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              setQuery("");
              setSearch("");
              void refresh();
            }}
          />
        )}
      </Modal>
      <Modal
        visible={!!selected}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.screen}>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
            <Text style={styles.heading}>{selected?.title}</Text>
            <Text selectable style={{ color: colors.ink, fontSize: 17, lineHeight: 26 }}>
              {selected?.body}
            </Text>
            <Text style={styles.caption}>
              Choose this reply from Templates inside a conversation to insert it before sending.
            </Text>
            <Button title="Done" subtle onPress={() => setSelected(null)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
