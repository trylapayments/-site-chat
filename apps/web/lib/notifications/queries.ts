import {
  notificationItemSchema,
  notificationListResultSchema,
  notificationPreferencesSchema,
  type NotificationItem,
  type NotificationListResult,
  type NotificationPreferences,
  type UpdateNotificationPreferencesInput,
} from "@site-chat/shared";
import { z } from "zod";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc, parseRpcResult } from "@/lib/workspace/rpc";

function throwRpcError(error: { message?: string } | null): never {
  const message = error?.message ?? "Notification request failed";
  throw new Error(message);
}

export async function fetchNotifications(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: {
    limit?: number;
    before_created_at?: string;
    before_id?: string;
    unread_only?: boolean;
  },
): Promise<NotificationListResult> {
  const { data, error } = await callPublicRpc(supabase, "list_notifications", {
    p_workspace_id: workspaceId,
    p_query: query,
  });
  if (error) {
    throwRpcError(error);
  }
  return parseRpcResult(
    notificationListResultSchema,
    data,
    "list_notifications",
  );
}

export async function fetchNotificationUnreadCount(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await callPublicRpc(
    supabase,
    "get_notification_unread_count",
    { p_workspace_id: workspaceId },
  );
  if (error) {
    throwRpcError(error);
  }
  const parsed = z
    .object({ unread_count: z.number().int().min(0) })
    .safeParse(data);
  if (!parsed.success) {
    throw new Error("Invalid get_notification_unread_count response");
  }
  return parsed.data.unread_count;
}

export async function markNotificationRead(
  supabase: AppSupabaseClient,
  workspaceId: string,
  notificationId: string,
): Promise<{ notification: NotificationItem; unread_count: number }> {
  const { data, error } = await callPublicRpc(
    supabase,
    "mark_notification_read",
    {
      p_workspace_id: workspaceId,
      p_notification_id: notificationId,
    },
  );
  if (error) {
    throwRpcError(error);
  }
  return z
    .object({
      notification: notificationItemSchema,
      unread_count: z.number().int().min(0),
    })
    .parse(data);
}

export async function markAllNotificationsRead(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<{ updated_count: number; unread_count: number }> {
  const { data, error } = await callPublicRpc(
    supabase,
    "mark_all_notifications_read",
    { p_workspace_id: workspaceId },
  );
  if (error) {
    throwRpcError(error);
  }
  return z
    .object({
      updated_count: z.number().int().min(0),
      unread_count: z.number().int().min(0),
    })
    .parse(data);
}

export async function fetchNotificationPreferences(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<NotificationPreferences> {
  const { data, error } = await callPublicRpc(
    supabase,
    "get_notification_preferences",
    { p_workspace_id: workspaceId },
  );
  if (error) {
    throwRpcError(error);
  }
  return parseRpcResult(
    notificationPreferencesSchema,
    data,
    "get_notification_preferences",
  );
}

export async function updateNotificationPreferences(
  supabase: AppSupabaseClient,
  workspaceId: string,
  patch: UpdateNotificationPreferencesInput,
): Promise<NotificationPreferences> {
  const { data, error } = await callPublicRpc(
    supabase,
    "update_notification_preferences",
    {
      p_workspace_id: workspaceId,
      p_patch: patch,
    },
  );
  if (error) {
    throwRpcError(error);
  }
  return parseRpcResult(
    notificationPreferencesSchema,
    data,
    "update_notification_preferences",
  );
}
