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
  const mobile = mobileService();
  const service = createServiceClient();
  const { data, error } = await mobile.rpc("claim_mobile_push", {
    p_limit: 10,
  });
  if (error) throw error;
  const jobs = z.array(jobSchema).parse(data);
  let sent = 0;
  let skipped = 0;
  for (const job of jobs) {
    try {
      const [{ data: device }, { data: notification }] = await Promise.all([
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
      if (
        !device ||
        !notification ||
        notification.read_at ||
        !notification.conversation_id
      ) {
        await finish(job.id, "skipped");
        skipped++;
        continue;
      }
      const [{ data: member }, { data: prefs }, access] = await Promise.all([
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
      if (
        !member ||
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
              ? "Новый диалог в Mill"
              : "Новое событие в диалоге",
          sound: "default",
          data: {
            workspaceId: device.workspace_id,
            conversationId: notification.conversation_id,
            notificationId: notification.id,
          },
          ttl: 3600,
          collapseId: notification.id,
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
          await mobile
            .from("mobile_push_devices")
            .delete()
            .eq("id", job.device_id);
          skipped++;
          continue;
        }
        throw new Error("Push rejected");
      }
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
        if (!row.ticket_id) continue;
        const receipt = result.data[row.ticket_id];
        if (!receipt) continue;
        if (receipt.details?.error === "DeviceNotRegistered")
          await mobile
            .from("mobile_push_devices")
            .delete()
            .eq("id", row.device_id);
        else
          await mobile
            .from("mobile_push_outbox")
            .update({
              receipt_checked_at: new Date().toISOString(),
              status: receipt.status === "ok" ? "sent" : "failed",
            })
            .eq("id", row.id);
      }
    }
  }
  return { sent, skipped, claimed: jobs.length };
  async function finish(id: string, status: string, ticketId?: string) {
    const { error } = await mobile
      .from("mobile_push_outbox")
      .update({ status, ...(ticketId ? { ticket_id: ticketId } : {}) })
      .eq("id", id);
    if (error) throw error;
  }
}
