import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ContactListItem, ContactProfile, ListContactsResult } from "@site-chat/shared";
import { Avatar, Button, Empty, ErrorBanner, useTheme } from "../../components/ui";
import { DirectoryHeader } from "../../components/DirectoryHeader";
import { useDirectory } from "../../lib/useDirectory";
import { useMill } from "../../lib/session";
import { api } from "../../lib/client";
export default function Contacts() {
  const { session, workspace } = useMill();
  return <ContactsContent key={`${session?.user.id}:${workspace?.workspace_id}`} />;
}
function ContactsContent() {
  const { colors, styles } = useTheme();
  const { workspace, session } = useMill();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [extra, setExtra] = useState<ContactListItem[]>([]);
  const [cursor, setCursor] = useState<ListContactsResult["next_before"]>();
  const [moreBusy, setMoreBusy] = useState(false);
  const [selected, setSelected] = useState<ContactListItem | null>(null);
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [error, setError] = useState("");
  const identity = `${session?.user.id}:${workspace?.workspace_id}:${search}`;
  const current = useRef(identity);
  useEffect(() => {
    current.current = identity;
  }, [identity]);
  const contactRequest = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  const {
    data,
    loading,
    error: loadError,
    refresh,
  } = useDirectory<ListContactsResult>("contacts", { limit: 30, ...(search ? { q: search } : {}) });
  useEffect(() => {
    contactRequest.current++;
    void Promise.resolve().then(() => {
      setExtra([]);
      setCursor(undefined);
      setSelected(null);
      setProfile(null);
      setMoreBusy(false);
    });
  }, [search, workspace?.workspace_id, session?.user.id]);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setExtra([]);
      setCursor(undefined);
    });
  }, [data]);
  async function open(item: ContactListItem) {
    const version = ++contactRequest.current;
    setSelected(item);
    setProfile(null);
    setError("");
    try {
      const next = await api<ContactProfile>(
        "contact",
        workspace!.workspace_id,
        { id: item.id },
        session!.user.id,
      );
      if (contactRequest.current === version) setProfile(next);
    } catch (e) {
      if (contactRequest.current === version)
        setError(e instanceof Error ? e.message : "Unable to load contact.");
    }
  }
  const rows = [...(data?.items ?? []), ...extra];
  const next = cursor === undefined ? data?.next_before : cursor;
  async function loadMore() {
    if (!next || moreBusy) return;
    const key = current.current;
    setMoreBusy(true);
    try {
      const result = await api<ListContactsResult>(
        "contacts",
        workspace!.workspace_id,
        { limit: 30, before: next, ...(search ? { q: search } : {}) },
        session!.user.id,
      );
      if (current.current !== key) return;
      setExtra((old) => [...old, ...result.items.filter((r) => !rows.some((o) => o.id === r.id))]);
      setCursor(result.next_before);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load contacts.");
    } finally {
      if (current.current === key) setMoreBusy(false);
    }
  }
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <DirectoryHeader title="Contacts" />
      <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search people and companies"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>
      <ErrorBanner message={loadError || error} />
      <FlatList
        data={rows}
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
            icon="person-outline"
            loading={loading && !data}
            title={loading && !data ? "Loading contacts…" : "No contacts found"}
            detail="Customer details from your Mill workspace appear here."
          />
        }
        ListFooterComponent={
          next ? (
            <Button
              title={moreBusy ? "Loading…" : "Load more"}
              subtle
              disabled={moreBusy}
              onPress={() => void loadMore()}
            />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => void open(item)}
            style={[styles.card, styles.row, { gap: 12, padding: 16, marginBottom: 9 }]}
          >
            <Avatar name={item.name || item.email || "Visitor"} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text numberOfLines={1} style={{ color: colors.ink, fontWeight: "600" }}>
                {item.name || item.email || "Visitor"}
              </Text>
              <Text numberOfLines={1} style={styles.caption}>
                {item.email || item.phone || item.company?.name || "Customer"}
              </Text>
            </View>
            <Text style={{ color: colors.muted }}>›</Text>
          </Pressable>
        )}
      />
      <Modal
        visible={!!selected}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <SafeAreaView style={styles.screen}>
          <View style={[styles.row, { justifyContent: "space-between", padding: 20 }]}>
            <Text style={styles.heading}>Contact</Text>
            <Pressable onPress={() => setSelected(null)}>
              <Text style={{ color: colors.blue, padding: 10 }}>Done</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
            <ErrorBanner message={error} />
            <Avatar name={selected?.name || selected?.email || "Visitor"} size={70} />
            <Text style={styles.heading}>{selected?.name || selected?.email || "Visitor"}</Text>
            {selected?.email && (
              <Pressable onPress={() => void Linking.openURL(`mailto:${selected.email}`)}>
                <Text style={{ color: colors.blue, fontSize: 17 }}>{selected.email}</Text>
              </Pressable>
            )}
            {selected?.phone && (
              <Pressable onPress={() => void Linking.openURL(`tel:${selected.phone}`)}>
                <Text style={{ color: colors.blue }}>{selected.phone}</Text>
              </Pressable>
            )}
            <Text style={styles.caption}>
              {[selected?.company?.name, selected?.country_code].filter(Boolean).join(" · ")}
            </Text>
            {profile ? (
              <>
                <View style={[styles.card, { gap: 12 }]}>
                  <Text style={{ color: colors.ink }}>
                    {profile.visit_count} visits · {profile.conversation_count} conversations
                  </Text>
                  <Text style={styles.caption}>
                    Last seen {new Date(profile.last_seen_at).toLocaleString("en-US")}
                  </Text>
                </View>
                <Text style={styles.caption}>
                  {profile.tags.map((tag) => tag.name).join(" · ")}
                </Text>
              </>
            ) : (
              <Text style={styles.caption}>Loading customer details…</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
