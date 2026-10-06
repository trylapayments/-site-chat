import { millEmailHtml } from "./mill-template";
import "server-only";

import { z } from "zod";
import { isQuietHoursActive } from "@site-chat/shared";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Notification email outbox processor.
 *
 * State machine: pending|failed → (claim) sending → sent|skipped|failed
 *
 * Never calls the provider before atomic claim ownership is established.
 * Concurrent workers cannot send the same outbox row.
 *
 * Never logs API keys or note bodies. Outbox rows only carry subject + to_email.
 */

const claimedRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  recipient_member_id: z.string().uuid(),
  notification_id: z.string().uuid().nullable(),
  email_category: z.enum([
    "mention",
    "assignment",
    "conversation_new",
    "visitor_message",
  ]),
  created_at: z.string().datetime({ offset: true }),
  to_email: z.string().email(),
  subject: z.string().min(1),
  status: z.literal("sending"),
  attempts: z.number().int().min(1),
});

export type ClaimedOutboxRow = z.infer<typeof claimedRowSchema>;

export type ProcessNotificationEmailResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

export type NotificationEmailSendResult =
  | { ok: true; providerMessageId?: string | null }
  | { ok: false; error: string };

export type NotificationEmailProcessorDeps = {
  claim: (limit: number) => Promise<ClaimedOutboxRow[]>;
  finalize: (input: {
    id: string;
    status: "sent" | "skipped" | "failed";
    lastError?: string | null;
    providerMessageId?: string | null;
  }) => Promise<boolean>;
  prepare: (
    row: ClaimedOutboxRow,
    appUrl: string,
  ) => Promise<{ href: string } | { skip: string }>;
  send: (input: {
    apiKey: string;
    to: string;
    subject: string;
    from: string;
    appUrl: string;
    idempotencyKey: string;
  }) => Promise<NotificationEmailSendResult>;
};

type ServiceClient = ReturnType<typeof createServiceClient>;

async function claimViaRpc(
  supabase: ServiceClient,
  limit: number,
): Promise<ClaimedOutboxRow[]> {
  const { data, error } = await supabase.rpc(
    "claim_notification_email_outbox" as never,
    { p_limit: limit } as never,
  );

  if (error) {
    console.error("notification email outbox claim failed", {
      message: error.message,
    });
    throw new Error("Notification email claim failed");
  }

  const rows: ClaimedOutboxRow[] = [];
  const candidates = Array.isArray(data) ? data : [];
  for (const raw of candidates) {
    const parsed = claimedRowSchema.safeParse(raw);
    if (parsed.success) {
      rows.push(parsed.data);
    }
  }
  return rows;
}

async function finalizeViaRpc(
  supabase: ServiceClient,
  input: {
    id: string;
    status: "sent" | "skipped" | "failed";
    lastError?: string | null;
    providerMessageId?: string | null;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "finalize_notification_email_outbox" as never,
    {
      p_id: input.id,
      p_status: input.status,
      p_last_error: input.lastError ?? null,
      p_provider_message_id: input.providerMessageId ?? null,
    } as never,
  );

  if (error) {
    console.error("notification email outbox finalize failed", {
      id: input.id,
      message: error.message,
    });
    return false;
  }

  return data === true;
}

export async function prepareNotificationEmail(
  supabase: ServiceClient,
  row: ClaimedOutboxRow,
  appUrl: string,
): Promise<{ href: string } | { skip: string }> {
  // Never deliver expired staging history or reserved test recipients.
  if (Date.now() - Date.parse(row.created_at) >= 24 * 60 * 60 * 1000) {
    return { skip: "Notification expired" };
  }
  const domain = row.to_email.split("@")[1]?.toLowerCase() ?? "";
  if (
    domain.endsWith(".invalid") ||
    ["example.com", "example.org", "example.net", "localhost"].includes(domain)
  ) {
    return { skip: "Reserved test recipient" };
  }
  const [member, workspace, preferences, notification] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("status,user_id,role")
      .eq("id", row.recipient_member_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle(),
    supabase
      .from("workspaces")
      .select("slug,status,deleted_at")
      .eq("id", row.workspace_id)
      .maybeSingle(),
    supabase
      .from("notification_preferences")
      .select("*")
      .eq("workspace_member_id", row.recipient_member_id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle(),
    row.notification_id
      ? supabase
          .from("notifications")
          .select("conversation_id,read_at")
          .eq("id", row.notification_id)
          .eq("workspace_id", row.workspace_id)
          .eq("recipient_id", row.recipient_member_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (
    member.error ||
    workspace.error ||
    preferences.error ||
    notification.error
  ) {
    throw new Error("Notification context unavailable");
  }
  if (
    !member.data ||
    member.data.status !== "active" ||
    !workspace.data ||
    workspace.data.status !== "active" ||
    workspace.data.deleted_at
  ) {
    return { skip: "Recipient or workspace inactive" };
  }
  if (
    member.data.role === "viewer" &&
    ["mention", "assignment"].includes(row.email_category)
  ) {
    return { skip: "Recipient no longer authorized" };
  }
  const currentUser = await supabase.auth.admin.getUserById(
    member.data.user_id,
  );
  if (currentUser.error) throw new Error("Recipient identity unavailable");
  if (
    currentUser.data.user.email?.toLowerCase() !== row.to_email.toLowerCase()
  ) {
    return { skip: "Recipient address changed" };
  }
  const prefs = preferences.data;
  if (
    !prefs ||
    !prefs[`email_${row.email_category}`] ||
    isQuietHoursActive(prefs)
  ) {
    return { skip: "Email preferences suppress delivery" };
  }
  if (
    row.notification_id &&
    (!notification.data || notification.data.read_at)
  ) {
    return { skip: "Notification already read or removed" };
  }
  const origin = new URL(appUrl).origin;
  const base = `/app/${encodeURIComponent(workspace.data.slug)}/inbox`;
  const conversationId = notification.data?.conversation_id;
  return {
    href: new URL(conversationId ? `${base}/${conversationId}` : base, origin)
      .href,
  };
}

async function sendViaResend(input: {
  apiKey: string;
  to: string;
  subject: string;
  from: string;
  appUrl: string;
  idempotencyKey: string;
}): Promise<NotificationEmailSendResult> {
  const body = [
    input.subject,
    "",
    "Open conversation in Mill:",
    input.appUrl,
    "",
    "You received this because email notifications are enabled for your account.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: body,
        html: millEmailHtml({
          title: input.subject,
          paragraphs: ["A conversation needs your attention in Mill."],
          button: { label: "Open conversation", href: input.appUrl },
          footer:
            "You received this because email notifications are enabled for your account. You can manage them in Mill Settings.",
        }),
      }),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `Resend HTTP ${String(response.status)}`,
      };
    }

    let providerMessageId: string | null = null;
    try {
      const json = (await response.json()) as { id?: unknown };
      if (typeof json.id === "string") {
        providerMessageId = json.id;
      }
    } catch {
      providerMessageId = null;
    }

    return { ok: true, providerMessageId };
  } catch {
    return { ok: false, error: "Resend request failed" };
  }
}

function defaultDeps(supabase: ServiceClient): NotificationEmailProcessorDeps {
  return {
    claim: (limit) => claimViaRpc(supabase, limit),
    finalize: (input) => finalizeViaRpc(supabase, input),
    prepare: (row, appUrl) => prepareNotificationEmail(supabase, row, appUrl),
    send: sendViaResend,
  };
}

/**
 * Process claimable notification email outbox rows.
 * Claim happens before any provider call. Missing Resend config leaves the queue untouched.
 */
export async function processNotificationEmailOutbox(options?: {
  limit?: number;
  supabase?: ServiceClient;
  resendApiKey?: string | null;
  fromEmail?: string;
  appUrl?: string;
  deps?: Partial<NotificationEmailProcessorDeps>;
}): Promise<ProcessNotificationEmailResult> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const supabase = options?.supabase ?? createServiceClient();
  const defaults = defaultDeps(supabase);
  const deps: NotificationEmailProcessorDeps = {
    claim: options?.deps?.claim ?? defaults.claim,
    finalize: options?.deps?.finalize ?? defaults.finalize,
    prepare: options?.deps?.prepare ?? defaults.prepare,
    send: options?.deps?.send ?? defaults.send,
  };

  const apiKey =
    options?.resendApiKey !== undefined
      ? options.resendApiKey
      : (process.env.RESEND_API_KEY ?? null);
  const fromEmail =
    options?.fromEmail ??
    process.env.RESEND_FROM_EMAIL ??
    "Mill <notifications@notify.mill.chat>";
  const appUrl =
    options?.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  const result: ProcessNotificationEmailResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  if (!apiKey) return result;

  const claimed = await deps.claim(limit);

  for (const row of claimed) {
    result.processed += 1;

    let target: { href: string } | { skip: string };
    try {
      target = await deps.prepare(row, appUrl);
    } catch {
      if (
        await deps.finalize({
          id: row.id,
          status: "failed",
          lastError: "Notification context unavailable",
        })
      )
        result.failed += 1;
      continue;
    }
    if ("skip" in target) {
      if (
        await deps.finalize({
          id: row.id,
          status: "skipped",
          lastError: target.skip,
        })
      )
        result.skipped += 1;
      continue;
    }
    const sendResult = await deps.send({
      apiKey,
      to: row.to_email,
      subject: row.subject,
      from: fromEmail,
      appUrl: target.href,
      idempotencyKey: `mill-notification/${row.id}`,
    });

    if (sendResult.ok) {
      const ok = await deps.finalize({
        id: row.id,
        status: "sent",
        providerMessageId: sendResult.providerMessageId ?? null,
      });
      if (ok) {
        result.sent += 1;
      }
      continue;
    }

    const ok = await deps.finalize({
      id: row.id,
      status: "failed",
      lastError: sendResult.error.slice(0, 500),
    });
    if (ok) {
      result.failed += 1;
    }
  }

  return result;
}
