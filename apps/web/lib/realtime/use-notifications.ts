"use client";

import {
  createNotificationTabElection,
  isNotificationUnread,
  isQuietHoursActive,
  notificationHref,
  notificationItemSchema,
  notificationShouldPlaySound,
  notificationShouldShowBrowser,
  type ConnectionState,
  type NotificationItem,
  type NotificationListResult,
  type NotificationPreferences,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { toAppRoute } from "@/lib/auth/redirect";
import {
  getNotificationPreferencesAction,
  getNotificationUnreadCountAction,
  listNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications/actions";
import {
  playNotificationSound,
  showBrowserNotification,
} from "@/lib/notifications/side-effects";
import { subscribeOperatorNotifications } from "@/lib/realtime/operator-subscriptions";

const DEFAULT_LIMIT = 20;

function mergeById(
  existing: NotificationItem[],
  incoming: NotificationItem[],
  mode: "prepend" | "append" | "replace",
): NotificationItem[] {
  if (mode === "replace") {
    const seen = new Set<string>();
    const next: NotificationItem[] = [];
    for (const item of incoming) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      next.push(item);
    }
    return next;
  }

  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }

  const merged = [...byId.values()].sort((a, b) => {
    const created = b.created_at.localeCompare(a.created_at);
    if (created !== 0) {
      return created;
    }
    return b.id.localeCompare(a.id);
  });

  if (mode === "prepend") {
    return merged;
  }

  // append: keep prior order preference but still de-dupe via map above
  return merged;
}

function rowToNotification(
  row: Record<string, unknown>,
): NotificationItem | null {
  const payloadCandidate = row.payload ?? row.payload_json;
  const payload =
    payloadCandidate &&
    typeof payloadCandidate === "object" &&
    !Array.isArray(payloadCandidate)
      ? (payloadCandidate as Record<string, unknown>)
      : {};
  const candidate = {
    id: row.id,
    workspace_id: row.workspace_id,
    recipient_id: row.recipient_id,
    type: row.type,
    title: row.title,
    body: row.body ?? null,
    resource_type: row.resource_type ?? null,
    resource_id: row.resource_id ?? null,
    conversation_id: row.conversation_id ?? null,
    actor_member_id: row.actor_member_id ?? null,
    payload,
    dedupe_key: row.dedupe_key,
    read_at: row.read_at ?? null,
    created_at: row.created_at,
  };
  const parsed = notificationItemSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function shouldSuppressSideEffects(
  prefs: NotificationPreferences | null,
): boolean {
  if (!prefs) {
    return true;
  }
  // Shared evaluator — mirrors app_private.notification_in_quiet_hours.
  // Durable in-app history is never gated by this.
  return isQuietHoursActive({
    dnd_enabled: prefs.dnd_enabled,
    quiet_hours_start: prefs.quiet_hours_start ?? null,
    quiet_hours_end: prefs.quiet_hours_end ?? null,
    timezone: prefs.timezone,
  });
}

export function useNotifications(input: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  enabled?: boolean;
}) {
  const enabled = input.enabled !== false && Boolean(input.memberId);
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<NonNullable<
    NotificationListResult["next_cursor"]
  > | null>(null);
  const [preferences, setPreferences] =
    useState<NotificationPreferences | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPending, startTransition] = useTransition();

  const generationRef = useRef(0);
  const requestRef = useRef(0);
  const workspaceIdRef = useRef(input.workspaceId);
  workspaceIdRef.current = input.workspaceId;
  const preferencesRef = useRef<NotificationPreferences | null>(null);
  preferencesRef.current = preferences;
  const hasInteractedRef = useRef(false);
  const electionRef = useRef<ReturnType<
    typeof createNotificationTabElection
  > | null>(null);
  /** Prevents reconnect/CDC replay from replaying browser/sound side effects. */
  const sideEffectedIdsRef = useRef<Set<string>>(new Set());
  /**
   * Only live arrivals at/after this watermark may emit side effects.
   * Boot uses a small skew buffer; reconnect advances to "now" so catch-up is silent.
   */
  const liveCutoffIsoRef = useRef<string>(
    new Date(Date.now() - 5_000).toISOString(),
  );
  const hasConnectedOnceRef = useRef(false);

  const invalidateInFlight = useCallback(() => {
    generationRef.current += 1;
    requestRef.current += 1;
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const generation = generationRef.current;
    const requestId = ++requestRef.current;
    const workspaceId = input.workspaceId;

    const isStale = () =>
      requestId !== requestRef.current ||
      generation !== generationRef.current ||
      workspaceId !== workspaceIdRef.current;

    try {
      const [listResult, unreadResult, prefsResult] = await Promise.all([
        listNotificationsAction(input.workspaceSlug, { limit: DEFAULT_LIMIT }),
        getNotificationUnreadCountAction(input.workspaceSlug),
        getNotificationPreferencesAction(input.workspaceSlug),
      ]);

      if (isStale()) {
        return;
      }

      if (!listResult.success) {
        setError(listResult.message);
        return;
      }

      setError(null);
      setItems(listResult.data.items);
      setHasMore(listResult.data.has_more);
      setNextCursor(listResult.data.next_cursor ?? null);
      setUnreadCount(
        unreadResult.success
          ? unreadResult.data.unread_count
          : listResult.data.unread_count,
      );
      if (prefsResult.success) {
        setPreferences(prefsResult.data);
      }
    } catch {
      if (!isStale()) {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
      }
    }
  }, [enabled, input.workspaceId, input.workspaceSlug]);

  const loadMore = useCallback(async () => {
    if (!enabled || !hasMore || !nextCursor || loadingMore) {
      return;
    }
    setLoadingMore(true);
    const generation = generationRef.current;
    const requestId = ++requestRef.current;
    try {
      const result = await listNotificationsAction(input.workspaceSlug, {
        limit: DEFAULT_LIMIT,
        before_created_at: nextCursor.before_created_at,
        before_id: nextCursor.before_id,
      });
      if (
        requestId !== requestRef.current ||
        generation !== generationRef.current
      ) {
        return;
      }
      if (!result.success) {
        setError(result.message);
        return;
      }
      setError(null);
      setItems((current) => mergeById(current, result.data.items, "append"));
      setHasMore(result.data.has_more);
      setNextCursor(result.data.next_cursor ?? null);
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, hasMore, loadingMore, nextCursor, input.workspaceSlug]);

  const markRead = useCallback(
    async (notificationId: string) => {
      const result = await markNotificationReadAction(
        input.workspaceSlug,
        notificationId,
      );
      if (!result.success) {
        setError(result.message);
        return null;
      }
      setItems((current) =>
        current.map((item) =>
          item.id === result.data.notification.id
            ? result.data.notification
            : item,
        ),
      );
      setUnreadCount(result.data.unread_count);
      return result.data.notification;
    },
    [input.workspaceSlug],
  );

  const markAllRead = useCallback(async () => {
    const result = await markAllNotificationsReadAction(input.workspaceSlug);
    if (!result.success) {
      setError(result.message);
      return;
    }
    const readAt = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.read_at ? item : { ...item, read_at: readAt },
      ),
    );
    setUnreadCount(0);
  }, [input.workspaceSlug]);

  const openNotification = useCallback(
    (item: NotificationItem) => {
      startTransition(async () => {
        if (isNotificationUnread(item)) {
          await markRead(item.id);
        }
        const href = notificationHref(input.workspaceSlug, item);
        if (href) {
          router.push(toAppRoute(href));
        }
      });
    },
    [input.workspaceSlug, markRead, router],
  );

  const maybeRunSideEffects = useCallback(
    (item: NotificationItem) => {
      if (sideEffectedIdsRef.current.has(item.id)) {
        return;
      }
      // Reconnect catch-up / historical rows must update UI only.
      if (item.created_at < liveCutoffIsoRef.current) {
        return;
      }

      const prefs = preferencesRef.current;
      if (!prefs || shouldSuppressSideEffects(prefs)) {
        return;
      }
      if (!electionRef.current?.isLeader()) {
        return;
      }

      sideEffectedIdsRef.current.add(item.id);

      const href = notificationHref(input.workspaceSlug, item);

      if (
        hasInteractedRef.current &&
        notificationShouldPlaySound(item.type, prefs)
      ) {
        playNotificationSound();
      }

      if (notificationShouldShowBrowser(item.type, prefs)) {
        showBrowserNotification({
          title: item.title,
          body: item.body,
          tag: item.id,
          href,
          onNavigate: (target) => {
            router.push(toAppRoute(target));
          },
        });
      }
    },
    [input.workspaceSlug, router],
  );

  // Track first user gesture so sound never autoplays beforehand.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    function markInteracted() {
      hasInteractedRef.current = true;
    }
    window.addEventListener("pointerdown", markInteracted, { once: true });
    window.addEventListener("keydown", markInteracted, { once: true });
    return () => {
      window.removeEventListener("pointerdown", markInteracted);
      window.removeEventListener("keydown", markInteracted);
    };
  }, [enabled]);

  // Tab election for sound / browser notifications only.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const election = createNotificationTabElection(input.workspaceId);
    electionRef.current = election;
    return () => {
      election.dispose();
      if (electionRef.current === election) {
        electionRef.current = null;
      }
    };
  }, [enabled, input.workspaceId]);

  // Initial load + reconnect / visibility catch-up.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const unsubscribe = subscribeOperatorNotifications({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      onConnectionChange: (status) => {
        setConnectionState(status);
        if (status === "connected") {
          if (hasConnectedOnceRef.current) {
            // Reconnect catch-up must update UI without replaying sound/browser.
            liveCutoffIsoRef.current = new Date().toISOString();
          } else {
            hasConnectedOnceRef.current = true;
          }
          void refresh();
        }
      },
      onInsert: (payload) => {
        const row = (payload.new ?? payload) as Record<string, unknown>;
        const item = rowToNotification(row);
        if (!item) {
          void refresh();
          return;
        }
        setItems((current) => mergeById(current, [item], "prepend"));
        // Optimistic badge bump; unread_counts CDC sets the authoritative value.
        if (isNotificationUnread(item)) {
          setUnreadCount((count) => count + 1);
        }
        maybeRunSideEffects(item);
      },
      onUpdate: (payload) => {
        const row = (payload.new ?? payload) as Record<string, unknown>;
        const item = rowToNotification(row);
        if (!item) {
          void refresh();
          return;
        }
        setItems((current) =>
          current.some((entry) => entry.id === item.id)
            ? current.map((entry) => (entry.id === item.id ? item : entry))
            : mergeById(current, [item], "prepend"),
        );
      },
      onUnreadCountChange: (payload) => {
        const row = (payload.new ?? payload) as Record<string, unknown>;
        if (
          typeof row.workspace_id === "string" &&
          row.workspace_id !== input.workspaceId
        ) {
          return;
        }
        if (typeof row.unread_count === "number" && row.unread_count >= 0) {
          setUnreadCount(row.unread_count);
        }
      },
    });

    return () => {
      invalidateInFlight();
      unsubscribe();
    };
  }, [
    enabled,
    input.memberId,
    input.workspaceId,
    invalidateInFlight,
    maybeRunSideEffects,
    refresh,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    function refreshOnVisible() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("online", refreshOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("online", refreshOnVisible);
    };
  }, [enabled, refresh]);

  return {
    items,
    unreadCount,
    hasMore,
    preferences,
    connectionState,
    error,
    loading,
    loadingMore,
    isPending,
    refresh,
    loadMore,
    markRead,
    markAllRead,
    openNotification,
    setPreferences,
  };
}
