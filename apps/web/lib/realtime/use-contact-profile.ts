"use client";

import type { ConnectionState, ContactProfile } from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getContactProfileAction } from "@/lib/crm/actions";
import { subscribeOperatorContactProfile } from "@/lib/realtime/operator-subscriptions";

const CDC_REFRESH_DELAY_MS = 250;

/**
 * Keeps a contact profile fresh via CDC + reconnect catch-up.
 *
 * Subscribe effect deps are stable (ids + enabled only) so parent re-renders
 * and `initialProfile` object identity never tear down the channel.
 * Forms should own local drafts and reconcile from the returned `serverProfile`.
 */
export function useContactProfileLiveRefresh(input: {
  workspaceId: string;
  workspaceSlug: string;
  contactId: string;
  enabled?: boolean;
  /** Seed / server-rendered profile for this contactId. */
  initialProfile?: ContactProfile;
}): {
  /** Authoritative server snapshot (RPC or SSR). Forms reconcile drafts from this. */
  serverProfile: ContactProfile | null;
  /** @deprecated Prefer `serverProfile`. */
  profile: ContactProfile | null;
  connectionState: ConnectionState;
  error: string | null;
} {
  const enabled = input.enabled ?? true;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;

  const [serverProfile, setServerProfile] = useState<ContactProfile | null>(
    input.initialProfile ?? null,
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const contactIdRef = useRef(input.contactId);
  contactIdRef.current = input.contactId;

  // Reset on contact switch. Do not depend on initialProfile object identity.
  useEffect(() => {
    setServerProfile(input.initialProfile ?? null);
    setError(null);
    setConnectionState("connecting");
    requestRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contact switch only
  }, [input.contactId]);

  // Adopt newer SSR/router.refresh snapshots for the same contact without resubscribing.
  const initialUpdatedAt = input.initialProfile?.updated_at;
  const initialProfileId = input.initialProfile?.id;
  useEffect(() => {
    const next = input.initialProfile;
    if (!next) {
      return;
    }
    if (next.id !== input.contactId) {
      return;
    }
    setServerProfile((current) => {
      if (!current) {
        return next;
      }
      if (next.updated_at >= current.updated_at) {
        return next;
      }
      return current;
    });
    // Intentionally keyed by contact + updated_at, not object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable live-refresh contract
  }, [input.contactId, initialProfileId, initialUpdatedAt]);

  useEffect(() => {
    if (!enabled || !input.contactId) {
      setConnectionState("disconnected");
      return;
    }

    const clearRefreshTimer = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };

    const catchUp = (options?: { refreshRouter?: boolean }) => {
      if (refreshTimerRef.current) {
        return;
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void (async () => {
          const requestId = ++requestRef.current;
          const contactId = contactIdRef.current;
          const result = await getContactProfileAction(
            input.workspaceSlug,
            contactId,
          );
          if (
            requestId !== requestRef.current ||
            contactId !== contactIdRef.current
          ) {
            return;
          }
          if (result.success) {
            setServerProfile(result.data);
            setError(null);
          } else {
            setError(result.message);
          }
          if (options?.refreshRouter !== false) {
            routerRef.current.refresh();
          }
        })();
      }, CDC_REFRESH_DELAY_MS);
    };

    const unsubscribe = subscribeOperatorContactProfile({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      onChange: () => {
        catchUp({ refreshRouter: true });
      },
      onConnectionChange: (status) => {
        setConnectionState(status);
        if (status === "connected") {
          // Catch-up refetch only — do not tear down the channel.
          catchUp({ refreshRouter: true });
        }
      },
    });

    return () => {
      unsubscribe();
      requestRef.current += 1;
      clearRefreshTimer();
    };
  }, [enabled, input.contactId, input.workspaceId, input.workspaceSlug]);

  return {
    serverProfile,
    profile: serverProfile,
    connectionState,
    error,
  };
}
