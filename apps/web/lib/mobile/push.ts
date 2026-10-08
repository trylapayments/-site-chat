import "server-only";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { env } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { workspaceBillingAccess } from "@/lib/billing/access";
import { isQuietHoursActive } from "@site-chat/shared";
import type { MobileDatabase } from "./database";

// Keep proposed schema separate from generated Database until migration is approved.
export function mobileService() {
  return createClient<MobileDatabase>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
const jobSchema = z.object({
  id: z.string().uuid(),
  notification_id: z.string().uuid(),
  device_id: z.string().uuid(),
  attempts: z.number(),
});
export async function processMobilePush() {
  if (process.env.MOBILE_PUSH_ENABLED !== "1")
    return { sent: 0, skipped: 0, claimed: 0 };
  const mobile = mobileService();
  const service = createServiceClient();
  const deadline = Date.now() + 35000;
  let sent = 0;
  let skipped = 0;
  let claimed = 0;
  while (claimed < 10 && Date.now() < deadline) {
    const { data, error } = await mobile.rpc("claim_mobile_push", {
      p_limit: 1,
    });
    if (error) throw error;
    const jobs = z.array(jobSchema).parse(data);
    const job = jobs[0];
    if (!job) break;
    claimed++;
    try {
      const [
        { data: device, error: deviceError },
        { data: notification, error: notificationError },
      ] = await Promise.all([
        mobile
          .from("mobile_push_devices")
          .select("*")
          .eq("id", job.device_id)
          .single(),
        service
          .from("notifications")
          .select("*")
          .eq("id", job.notification_id)
          .single(),
      ]);
      if (deviceError || notificationError)
        throw new Error("Push context unavailable");
      if (
        notification.read_at ||
        !notification.conversation_id ||
        Date.parse(notification.created_at) < Date.now() - 3600000
      ) {
        await finish(job.id, "skipped");
        skipped++;
        continue;
      }
      const [
        { data: member, error: memberError },
        { data: prefs, error: prefsError },
        access,
      ] = await Promise.all([
        service
          .from("workspace_members")
          .select("id,role,status,user_id")
          .eq("id", device.member_id)
          .eq("workspace_id", device.workspace_id)
          .single(),
        service
          .from("notification_preferences")
          .select("*")
          .eq("workspace_member_id", device.member_id)
          .eq("workspace_id", device.workspace_id)
          .maybeSingle(),
        workspaceBillingAccess(device.workspace_id),
      ]);
      if (memberError || prefsError) throw new Error("Push access unavailable");
      if (
        member.status !== "active" ||
        member.role === "viewer" ||
        member.user_id !== device.user_id ||
        notification.recipient_id !== device.member_id ||
        notification.workspace_id !== device.workspace_id ||
        !access.enabled ||
        (prefs && isQuietHoursActive(prefs))
      ) {
        await finish(job.id, "skipped");
        skipped++;
        continue;
      }
      // No customer names or message text on the lock screen.
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          to: device.token,
          title: "Mill",
          body:
            notification.type === "conversation_new"
              ? "New conversation in Mill"
              : "New conversation activity",
          ...(device.sound_mode === "silent"
            ? {}
            : {
                sound:
                  device.sound_mode === "system"
                    ? "default"
                    : `${device.sound_mode === "voice" ? "mill-voice" : "mill"}-${notification.type === "conversation_new" ? "conversation" : "message"}.wav`,
              }),
          channelId: `mill-conversations-${device.sound_mode}`,
          data: {
            workspaceId: device.workspace_id,
            conversationId: notification.conversation_id,
            notificationId: notification.id,
            recipientUserId: device.user_id,
          },
          ttl: 3600,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Provider unavailable");
      const result = z
        .object({
          data: z.object({
            status: z.enum(["ok", "error"]),
            id: z.string().optional(),
            details: z.object({ error: z.string().optional() }).optional(),
          }),
        })
        .parse(await response.json());
      if (result.data.status !== "ok") {
        if (result.data.details?.error === "DeviceNotRegistered") {
          const { error } = await mobile
            .from("mobile_push_devices")
            .delete()
            .eq("id", job.device_id);
          if (error) throw error;
          skipped++;
          continue;
        }
        throw new Error("Push rejected");
      }
      if (!result.data.id) throw new Error("Missing provider ticket");
      await finish(job.id, "sent", result.data.id);
      sent++;
    } catch {
      const { error: retryError } = await mobile
        .from("mobile_push_outbox")
        .update({
          status: job.attempts >= 8 ? "failed" : "pending",
          next_attempt_at: new Date(
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
          ).toISOString(),
          claimed_at: null,
        })
        .eq("id", job.id);
      if (retryError) throw retryError;
    }
  }
  // Stop polling tickets whose provider receipt window has expired.
  const { error: expiryError } = await mobile
    .from("mobile_push_outbox")
    .update({ status: "failed", receipt_checked_at: new Date().toISOString() })
    .eq("status", "sent")
    .is("receipt_checked_at", null)
    .lt("claimed_at", new Date(Date.now() - 24 * 3600000).toISOString());
  if (expiryError) throw expiryError;
  if (Date.now() > deadline) return { sent, skipped, claimed };
  // Provider tickets are acceptance, receipts are delivery results. Disable invalid tokens.
  const { data: receipts, error: receiptQueryError } = await mobile
    .from("mobile_push_outbox")
    .select("id,ticket_id,device_id")
    .eq("status", "sent")
    .is("receipt_checked_at", null)
    .lt("claimed_at", new Date(Date.now() - 15 * 60000).toISOString())
    .limit(100);
  if (receiptQueryError) throw receiptQueryError;
  if (receipts.length) {
    const response = await fetch(
      "https://exp.host/--/api/v2/push/getReceipts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          ids: receipts.map((r) => r.ticket_id).filter(Boolean),
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (response.ok) {
      const result = z
        .object({
          data: z.record(
            z.object({
              status: z.enum(["ok", "error"]),
              details: z.object({ error: z.string().optional() }).optional(),
            }),
          ),
        })
        .parse(await response.json());
      for (const row of receipts) {
        if (Date.now() >= deadline) break;
        if (!row.ticket_id) continue;
        const receipt = result.data[row.ticket_id];
        if (!receipt) continue;
        const { error } =
          receipt.details?.error === "DeviceNotRegistered"
            ? await mobile
                .from("mobile_push_devices")
                .delete()
                .eq("id", row.device_id)
            : await mobile
                .from("mobile_push_outbox")
                .update({
                  receipt_checked_at: new Date().toISOString(),
                  status: receipt.status === "ok" ? "sent" : "failed",
                })
                .eq("id", row.id);
        if (error) throw error;
      }
    }
  }
  return { sent, skipped, claimed };
  async function finish(id: string, status: string, ticketId?: string) {
    const { error } = await mobile
      .from("mobile_push_outbox")
      .update({ status, ...(ticketId ? { ticket_id: ticketId } : {}) })
      .eq("id", id);
    if (error) throw error;
  }
}
