"use server";

import {
  listNotificationsQuerySchema,
  notificationPreferencesSchema,
  updateNotificationPreferencesSchema,
  type NotificationListResult,
  type NotificationPreferences,
} from "@site-chat/shared";
import { z } from "zod";

import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  fetchNotificationPreferences,
  fetchNotificationUnreadCount,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationPreferences,
} from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

export type NotificationActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

function mapError(error: unknown): NotificationActionResult<never> {
  const message =
    error instanceof Error ? error.message : "Notification request failed.";
  if (message.startsWith("FORBIDDEN")) {
    return { success: false, message: "Not allowed.", code: "FORBIDDEN" };
  }
  if (message.startsWith("NOTIFICATION_NOT_FOUND")) {
    return {
      success: false,
      message: "Notification not found.",
      code: "NOT_FOUND",
    };
  }
  if (message.startsWith("INVALID_INPUT") || message.startsWith("INVALID")) {
    return { success: false, message: "Invalid request.", code: "INVALID" };
  }
  return {
    success: false,
    message: "Something went wrong. Please try again.",
    code: "FAILED",
  };
}

export async function listNotificationsAction(
  workspaceSlug: string,
  input: unknown = {},
): Promise<NotificationActionResult<NotificationListResult>> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const parsed = listNotificationsQuerySchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid query.", code: "INVALID" };
    }
    const supabase = await createClient();
    const data = await fetchNotifications(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    return { success: true, data };
  } catch (error) {
    return mapError(error);
  }
}

export async function getNotificationUnreadCountAction(
  workspaceSlug: string,
): Promise<NotificationActionResult<{ unread_count: number }>> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const supabase = await createClient();
    const unread_count = await fetchNotificationUnreadCount(
      supabase,
      workspace.workspace_id,
    );
    return { success: true, data: { unread_count } };
  } catch (error) {
    return mapError(error);
  }
}

export async function markNotificationReadAction(
  workspaceSlug: string,
  notificationId: unknown,
): Promise<
  NotificationActionResult<{
    notification: NotificationListResult["items"][number];
    unread_count: number;
  }>
> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const id = z.string().uuid().parse(notificationId);
    const supabase = await createClient();
    const data = await markNotificationRead(
      supabase,
      workspace.workspace_id,
      id,
    );
    return { success: true, data };
  } catch (error) {
    return mapError(error);
  }
}

export async function markAllNotificationsReadAction(
  workspaceSlug: string,
): Promise<
  NotificationActionResult<{ updated_count: number; unread_count: number }>
> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const supabase = await createClient();
    const data = await markAllNotificationsRead(
      supabase,
      workspace.workspace_id,
    );
    return { success: true, data };
  } catch (error) {
    return mapError(error);
  }
}

export async function getNotificationPreferencesAction(
  workspaceSlug: string,
): Promise<NotificationActionResult<NotificationPreferences>> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const supabase = await createClient();
    const data = await fetchNotificationPreferences(
      supabase,
      workspace.workspace_id,
    );
    return { success: true, data };
  } catch (error) {
    return mapError(error);
  }
}

export async function updateNotificationPreferencesAction(
  workspaceSlug: string,
  input: unknown,
): Promise<NotificationActionResult<NotificationPreferences>> {
  try {
    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const parsed = updateNotificationPreferencesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        message: "Invalid preferences.",
        code: "INVALID",
      };
    }
    const supabase = await createClient();
    const data = await updateNotificationPreferences(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    const validated = notificationPreferencesSchema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    return mapError(error);
  }
}
