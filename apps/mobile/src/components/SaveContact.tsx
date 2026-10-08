import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { can } from "@site-chat/shared";
import { api } from "../lib/client";
import { useMill } from "../lib/session";
import { Button, ErrorBanner, useTheme } from "./ui";

type Membership = { contactId: string | null; saved: boolean };
export function SaveContact({ visitorSessionId, workspaceId }: { visitorSessionId: string; workspaceId?: string }) {
  const { session, workspace } = useMill();
  return (
    <SaveContactContent
      key={`${session?.user.id}:${workspaceId ?? workspace?.workspace_id}:${visitorSessionId}`}
      visitorSessionId={visitorSessionId}
      targetWorkspaceId={workspaceId}
    />
  );
}
function SaveContactContent({ visitorSessionId, targetWorkspaceId }: { visitorSessionId: string; targetWorkspaceId?: string }) {
  const { session, workspace: currentWorkspace, workspaces, online } = useMill();
  const workspace = targetWorkspaceId ? workspaces.find((w) => w.workspace_id === targetWorkspaceId) : currentWorkspace;
  const { colors, styles } = useTheme();
  const [membership, setMembership] = useState<Membership>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const savingLock = useRef(false);
  const userId = session?.user.id;
  const workspaceId = workspace?.workspace_id;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!userId || !workspaceId || !online) return;
    void api<Membership>("contactMembership", workspaceId, { visitorSessionId }, userId)
      .then((value) => {
        if (!cancelled) {
          setMembership(value);
          setError("");
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unable to check contact.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, workspaceId, visitorSessionId, online]);
  async function save() {
    if (!userId || !workspaceId || !online || savingLock.current) return;
    savingLock.current = true;
    setSaving(true);
    setError("");
    try {
      const value = await api<Membership>("saveContact", workspaceId, { visitorSessionId }, userId);
      if (mounted.current) setMembership(value);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Unable to save contact.");
    } finally {
      savingLock.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <View style={{ gap: 12 }}>
      <ErrorBanner message={error} />
      {loading && online && <ActivityIndicator color={colors.blue} />}
      {membership?.saved ? (
        <Text style={{ color: colors.green, fontWeight: "600" }}>Saved in Contacts</Text>
      ) : (
        <>
          <Text style={styles.caption}>Keep this visitor in your team’s Contacts.</Text>
          {workspace?.role && can(workspace.role, "update_visitor_profile") && (
            <Button
              title={saving ? "Saving…" : "Save to contacts"}
              disabled={!online || saving || (loading && !error)}
              onPress={() => void save()}
            />
          )}
        </>
      )}
    </View>
  );
}
