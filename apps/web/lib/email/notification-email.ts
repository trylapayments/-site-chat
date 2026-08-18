import "server-only";

import { z } from "zod";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Minimal notification email outbox processor.
 *
 * Intended for cron / background jobs using the Supabase service role
 * (RLS denies authenticated access to notification_email_outbox).
 *
 * Never logs API keys or note bodies. Outbox rows only carry subject + to_email.
 */

const outboxRowSchema = z.object({
  id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  to_email: z.string().email(),
  subject: z.string().min(1),
  status: z.literal("pending"),
  attempts: z.number().int().min(0),
});

export type ProcessNotificationEmailResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
};

type OutboxTableClient = {
  from: (table: "notification_email_outbox") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => Promise<{
            data: unknown[] | null;
            error: { message?: string } | null;
          }>;
        };
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => {
        eq: (
          column: string,
          value: string,
        ) => {
          select: (columns: string) => {
            maybeSingle: () => Promise<{
              data: { id: string } | null;
              error: { message?: string } | null;
            }>;
          };
        };
      };
    };
  };
};

function outboxClient(
  supabase: ReturnType<typeof createServiceClient>,
): OutboxTableClient {
  // Table exists in migrations; generated Database types may lag until regenerated.
  return supabase as unknown as OutboxTableClient;
}

async function claimAndFinalize(
  client: OutboxTableClient,
  id: string,
  patch: {
    status: "sent" | "skipped" | "failed";
    attempts: number;
    last_error?: string | null;
    sent_at?: string | null;
  },
): Promise<boolean> {
  const { data, error } = await client
    .from("notification_email_outbox")
    .update({
      status: patch.status,
      attempts: patch.attempts,
      last_error: patch.last_error ?? null,
      sent_at: patch.sent_at ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("notification email outbox update failed", {
      id,
      message: error.message,
    });
    return false;
  }

  return Boolean(data?.id);
}

async function sendViaResend(input: {
  apiKey: string;
  to: string;
  subject: string;
  from: string;
  appUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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
      // Do not log response bodies (may echo addresses); keep status only.
      return {
        ok: false,
        error: `Resend HTTP ${String(response.status)}`,
      };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Resend request failed" };
  }
}

/**
 * Process pending notification email outbox rows.
 * Idempotent: only rows still in `pending` transition to sent/skipped/failed.
 */
export async function processNotificationEmailOutbox(options?: {
  limit?: number;
  /** Override for tests; defaults to service-role client. */
  supabase?: ReturnType<typeof createServiceClient>;
  resendApiKey?: string | null;
  fromEmail?: string;
  appUrl?: string;
}): Promise<ProcessNotificationEmailResult> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const supabase = options?.supabase ?? createServiceClient();
  const client = outboxClient(supabase);
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

  const { data, error } = await client
    .from("notification_email_outbox")
    .select("id, workspace_id, to_email, subject, status, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("notification email outbox list failed", {
      message: error.message,
    });
    return { processed: 0, sent: 0, skipped: 0, failed: 0 };
  }

  const result: ProcessNotificationEmailResult = {
    processed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
  };

  for (const raw of data ?? []) {
    const parsed = outboxRowSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    const row = parsed.data;
    result.processed += 1;
    const nextAttempts = row.attempts + 1;

    if (!apiKey) {
      const claimed = await claimAndFinalize(client, row.id, {
        status: "skipped",
        attempts: nextAttempts,
        last_error: "RESEND_API_KEY missing",
      });
      if (claimed) {
        result.skipped += 1;
      }
      continue;
    }

    const sendResult = await sendViaResend({
      apiKey,
      to: row.to_email,
      subject: row.subject,
      from: fromEmail,
      appUrl,
    });

    if (sendResult.ok) {
      const claimed = await claimAndFinalize(client, row.id, {
        status: "sent",
        attempts: nextAttempts,
        sent_at: new Date().toISOString(),
        last_error: null,
      });
      if (claimed) {
        result.sent += 1;
      }
      continue;
    }

    const claimed = await claimAndFinalize(client, row.id, {
      status: "failed",
      attempts: nextAttempts,
      last_error: sendResult.error.slice(0, 500),
    });
    if (claimed) {
      result.failed += 1;
    }
  }

  return result;
}
