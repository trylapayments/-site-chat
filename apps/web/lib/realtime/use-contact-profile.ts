"use client";

import type { ConnectionState, ContactProfile } from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getContactProfileAction } from "@/lib/crm/actions";
import { subscribeOperatorContactProfile } from "@/lib/realtime/operator-subscriptions";

const CDC_REFRESH_DELAY_MS = 250;

/**
 * Keeps a contact profile fresh via CDC + reconnect catch-up.
 * Prefer router.refresh for server-rendered pages; optional onProfile for
 * client-held profile state.
 */
export function useContactProfileLiveRefresh(input: {
  workspaceId: string;
  workspaceSlug: string;
  contactId: string;
  enabled?: boolean;
  /** When set, refetch RPC into local state instead of only router.refresh. */
  initialProfile?: ContactProfile;
}): {
  profile: ContactProfile | null;
  connectionState: ConnectionState;
  error: string | null;
} {
  const enabled = input.enabled ?? true;
  const router = useRouter();
  const [profile, setProfile] = useState<ContactProfile | null>(
    input.initialProfile ?? null,
  );
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    setProfile(input.initialProfile ?? null);
  }, [input.initialProfile]);

  useEffect(() => {
    if (!enabled || !input.contactId) {
      return;
    }

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        return;
      }
      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void (async () => {
          const requestId = ++requestRef.current;
          if (input.initialProfile !== undefined) {
            const result = await getContactProfileAction(
              input.workspaceSlug,
              input.contactId,
            );
            if (requestId !== requestRef.current) {
              return;
            }
            if (result.success) {
              setProfile(result.data);
              setError(null);
            } else {
              setError(result.message);
            }
          }
          router.refresh();
        })();
      }, CDC_REFRESH_DELAY_MS);
    };

    const unsubscribe = subscribeOperatorContactProfile({
      workspaceId: input.workspaceId,
      contactId: input.contactId,
      onChange: () => {
        scheduleRefresh();
      },
      onConnectionChange: (status) => {
        setConnectionState(status);
        if (status === "connected") {
          scheduleRefresh();
        }
      },
    });

    return () => {
      unsubscribe();
      requestRef.current += 1;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [
    enabled,
    input.contactId,
    input.workspaceId,
    input.workspaceSlug,
    input.initialProfile,
    router,
  ]);

  return { profile, connectionState, error };
}
