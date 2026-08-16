"use client";

import {
  advanceCannedCatchUpWatermark,
  localCannedFolderTombstone,
  localCannedTombstone,
  mergeCannedFolders,
  mergeCannedResponses,
  reconcileCannedCatchUp,
  reconcileCannedFolderCatchUp,
  seedCannedCatchUpWatermark,
  type CannedFolder,
  type CannedResponse,
  type ConnectionState,
} from "@site-chat/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  listCannedResponseFoldersAction,
  listCannedResponsesAction,
} from "@/lib/canned/actions";
import { subscribeOperatorCannedResponses } from "@/lib/realtime/operator-subscriptions";

const CATCH_UP_LIMIT = 200;
/** Coalesce bursts of CDC rows (bulk edits, favorite toggles) into one resync. */
const CDC_RESYNC_DELAY_MS = 250;

export function useLiveCannedResponses(input: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  initialResponses: CannedResponse[];
  initialFolders?: CannedFolder[];
  /** False for viewers-only surfaces that never subscribe (e.g. no member id). */
  enabled: boolean;
  /** Settings page needs folders; the composer does not. */
  includeFolders?: boolean;
  initialHasMore?: boolean;
}) {
  const includeFolders = input.includeFolders ?? false;

  const [responses, setResponses] = useState<CannedResponse[]>(
    input.initialResponses,
  );
  const [folders, setFolders] = useState<CannedFolder[]>(
    input.initialFolders ?? [],
  );
  const [hasMore, setHasMore] = useState(input.initialHasMore ?? false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);

  /** Bumped on workspace change so a stale catch-up never merges elsewhere. */
  const generationRef = useRef(0);
  /** Monotonic id: only the latest in-flight catch-up may apply. */
  const requestRef = useRef(0);
  const workspaceIdRef = useRef(input.workspaceId);
  workspaceIdRef.current = input.workspaceId;

  const responsesWatermarkRef = useRef<string | null>(
    seedCannedCatchUpWatermark(input.initialResponses),
  );
  const foldersWatermarkRef = useRef<string | null>(
    seedCannedCatchUpWatermark(input.initialFolders ?? []),
  );

  const initialResponsesRef = useRef(input.initialResponses);
  initialResponsesRef.current = input.initialResponses;
  const initialFoldersRef = useRef(input.initialFolders ?? []);
  initialFoldersRef.current = input.initialFolders ?? [];

  /**
   * Session-local soft deletes. Prevents an in-flight catch-up that still lists
   * a snippet from resurrecting it after the operator deleted it.
   */
  const deletedResponseIdsRef = useRef<Set<string>>(new Set());
  const deletedFolderIdsRef = useRef<Set<string>>(new Set());
  const resyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateInFlight = useCallback(() => {
    generationRef.current += 1;
    requestRef.current += 1;
  }, []);

  const catchUp = useCallback(async () => {
    if (!input.enabled) {
      return;
    }

    const generation = generationRef.current;
    const requestId = ++requestRef.current;
    const workspaceId = input.workspaceId;
    const responsesWatermark = responsesWatermarkRef.current;
    const foldersWatermark = foldersWatermarkRef.current;

    const isStale = () =>
      requestId !== requestRef.current ||
      generation !== generationRef.current ||
      workspaceId !== workspaceIdRef.current;

    try {
      const result = await listCannedResponsesAction(input.workspaceSlug, {
        limit: CATCH_UP_LIMIT,
        authoritative: true,
        include_folders: false,
        ...(responsesWatermark ? { catch_up_since: responsesWatermark } : {}),
      });

      if (isStale()) {
        return;
      }

      if (!result.success) {
        setError(result.message);
        return;
      }

      setError(null);
      setHasMore(result.data.has_more);

      const localTombstones = [...deletedResponseIdsRef.current].map((id) =>
        localCannedTombstone({ id, workspaceId }),
      );
      setResponses((current) =>
        reconcileCannedCatchUp(
          current,
          result.data.items,
          [...result.data.tombstones, ...localTombstones],
          { authoritativeReplace: true },
        ),
      );
      responsesWatermarkRef.current = advanceCannedCatchUpWatermark(
        responsesWatermark,
        result.data.items,
        result.data.tombstones,
        result.data.server_watermark,
      );

      if (!includeFolders) {
        return;
      }

      // Folders reconcile through their own RPC: the snippet list only carries
      // active folders, so folder deletions need that RPC's tombstones.
      const folderResult = await listCannedResponseFoldersAction(
        input.workspaceSlug,
        {
          authoritative: true,
          ...(foldersWatermark ? { catch_up_since: foldersWatermark } : {}),
        },
      );

      if (isStale()) {
        return;
      }

      if (!folderResult.success) {
        setError(folderResult.message);
        return;
      }

      const localFolderTombstones = [...deletedFolderIdsRef.current].map((id) =>
        localCannedFolderTombstone({ id, workspaceId }),
      );
      setFolders((current) =>
        reconcileCannedFolderCatchUp(
          current,
          folderResult.data.items,
          [...folderResult.data.tombstones, ...localFolderTombstones],
          { authoritativeReplace: true },
        ),
      );
      foldersWatermarkRef.current = advanceCannedCatchUpWatermark(
        foldersWatermark,
        folderResult.data.items,
        folderResult.data.tombstones,
        folderResult.data.server_watermark,
      );
    } catch (err) {
      if (isStale()) {
        return;
      }
      setError(
        err instanceof Error ? err.message : "Unable to load canned responses.",
      );
    }
  }, [includeFolders, input.enabled, input.workspaceId, input.workspaceSlug]);

  const scheduleResync = useCallback(() => {
    if (resyncTimerRef.current !== null) {
      return;
    }
    resyncTimerRef.current = setTimeout(() => {
      resyncTimerRef.current = null;
      void catchUp();
    }, CDC_RESYNC_DELAY_MS);
  }, [catchUp]);

  // Reset on workspace change only — never on initial-prop identity, which would
  // abort an in-flight catch-up on every parent re-render.
  useEffect(() => {
    invalidateInFlight();
    deletedResponseIdsRef.current = new Set();
    deletedFolderIdsRef.current = new Set();
    setResponses(initialResponsesRef.current);
    setFolders(initialFoldersRef.current);
    responsesWatermarkRef.current = seedCannedCatchUpWatermark(
      initialResponsesRef.current,
    );
    foldersWatermarkRef.current = seedCannedCatchUpWatermark(
      initialFoldersRef.current,
    );
    setError(null);
    setConnectionState("connecting");
  }, [input.workspaceId, invalidateInFlight]);

  useEffect(() => {
    if (!input.enabled) {
      setConnectionState("disconnected");
      return;
    }

    const unsubscribe = subscribeOperatorCannedResponses({
      workspaceId: input.workspaceId,
      memberId: input.memberId,
      onConnectionChange: (status) => {
        setConnectionState(status);
        if (status === "connected") {
          void catchUp();
        }
      },
      onResponseChange: (row) => {
        if (typeof row.id === "string" && row.deleted_at) {
          const deletedId = row.id;
          deletedResponseIdsRef.current.add(deletedId);
          setResponses((current) =>
            current.filter((item) => item.id !== deletedId),
          );
          return;
        }
        // CDC rows lack display labels and the caller's `is_favorited`, so the
        // enriched item comes from a coalesced authoritative list instead of a
        // lossy partial merge.
        scheduleResync();
      },
      ...(includeFolders
        ? {
            onFolderChange: (row) => {
              if (typeof row.id === "string" && row.deleted_at) {
                const deletedId = row.id;
                deletedFolderIdsRef.current.add(deletedId);
                setFolders((current) =>
                  current.filter((item) => item.id !== deletedId),
                );
              }
              // Folder writes also unfile snippets, so resync both lists.
              scheduleResync();
            },
          }
        : {}),
      onFavoriteChange: () => {
        scheduleResync();
      },
    });

    return () => {
      invalidateInFlight();
      if (resyncTimerRef.current !== null) {
        clearTimeout(resyncTimerRef.current);
        resyncTimerRef.current = null;
      }
      unsubscribe();
    };
  }, [
    catchUp,
    includeFolders,
    input.enabled,
    input.memberId,
    input.workspaceId,
    invalidateInFlight,
    scheduleResync,
  ]);

  // Tab focus: CDC can be missed under multi-tab load.
  useEffect(() => {
    if (!input.enabled) {
      return;
    }

    function refreshOnVisible() {
      if (document.visibilityState === "visible") {
        void catchUp();
      }
    }

    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [catchUp, input.enabled]);

  const applyResponse = useCallback((item: CannedResponse) => {
    if (item.deleted_at) {
      deletedResponseIdsRef.current.add(item.id);
      setResponses((current) => current.filter((row) => row.id !== item.id));
      return;
    }
    deletedResponseIdsRef.current.delete(item.id);
    setResponses((current) => mergeCannedResponses(current, [item]));
  }, []);

  const markResponseDeleted = useCallback(
    (cannedResponseId: string) => {
      deletedResponseIdsRef.current.add(cannedResponseId);
      // Drop any catch-up started before this delete — it may still list the row.
      invalidateInFlight();
      setResponses((current) =>
        current.filter((row) => row.id !== cannedResponseId),
      );
    },
    [invalidateInFlight],
  );

  const clearResponseTombstone = useCallback((cannedResponseId: string) => {
    deletedResponseIdsRef.current.delete(cannedResponseId);
  }, []);

  const applyFolder = useCallback((folder: CannedFolder) => {
    if (folder.deleted_at) {
      deletedFolderIdsRef.current.add(folder.id);
      setFolders((current) => current.filter((row) => row.id !== folder.id));
      return;
    }
    deletedFolderIdsRef.current.delete(folder.id);
    setFolders((current) => mergeCannedFolders(current, [folder]));
  }, []);

  const markFolderDeleted = useCallback(
    (folderId: string) => {
      deletedFolderIdsRef.current.add(folderId);
      invalidateInFlight();
      setFolders((current) => current.filter((row) => row.id !== folderId));
      // Snippets in the folder are unfiled server-side, not deleted.
      setResponses((current) =>
        current.map((row) =>
          row.folder_id === folderId ? { ...row, folder_id: null } : row,
        ),
      );
    },
    [invalidateInFlight],
  );

  return {
    responses,
    folders,
    hasMore,
    connectionState,
    error,
    applyResponse,
    markResponseDeleted,
    clearResponseTombstone,
    applyFolder,
    markFolderDeleted,
    retry: () => {
      void catchUp();
    },
  };
}
