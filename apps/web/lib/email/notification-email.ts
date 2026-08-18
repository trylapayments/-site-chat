import "server-only";

import { z } from "zod";

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
  send: (input: {
    apiKey: string;
    to: string;
    subject: string;
    from: string;
    appUrl: string;
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
    return [];
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

async function sendViaResend(input: {
  apiKey: string;
  to: string;
  subject: string;
  from: string;
  appUrl: string;
}): Promise<NotificationEmailSendResult> {
  const body = [
    input.subject,
    "",
    "Open Site Chat to review this notification.",
    input.appUrl,
    "",
    "You received this because email notifications are enabled for your account.",
  ].join("\n");

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: body,
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
    send: sendViaResend,
  };
}

/**
 * Process claimable notification email outbox rows.
 * Claim happens before any provider call. Missing Resend config → skipped (not sent).
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
    send: options?.deps?.send ?? defaults.send,
  };

  const apiKey =
    options?.resendApiKey !== undefined
      ? options.resendApiKey
      : (process.env.RESEND_API_KEY ?? null);
  const fromEmail =
    options?.fromEmail ??
    process.env.RESEND_FROM_EMAIL ??
    "Site Chat <notifications@mail.sitechat.app>";
  const appUrl =
    options?.appUrl ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000";

  const claimed = await deps.claim(limit);
  const result: ProcessNotificationEmailResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of claimed) {
    result.processed += 1;

    if (!apiKey) {
      const ok = await deps.finalize({
        id: row.id,
        status: "skipped",
        lastError: "RESEND_API_KEY missing",
      });
      if (ok) {
        result.skipped += 1;
      }
      continue;
    }

    const sendResult = await deps.send({
      apiKey,
      to: row.to_email,
      subject: row.subject,
      from: fromEmail,
      appUrl,
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
