/** Configure managed notification delivery; never commit runtime secrets. */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const secretPath = process.env.MILL_NOTIFICATION_CRON_SECRET_FILE;
if (!secretPath) throw new Error("MILL_NOTIFICATION_CRON_SECRET_FILE is required");
const secret = readFileSync(secretPath, "utf8").trim();
if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret)) throw new Error("Invalid scheduler secret");
const endpoint = new URL(
  process.env.MILL_NOTIFICATION_WORKER_URL ??
    "https://app.mill.chat/api/internal/notification-emails",
);
if (
  endpoint.protocol !== "https:" ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error("Invalid worker URL");
const quotedUrl = endpoint.href.replaceAll("'", "''");
const sql = `
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
DO $setup$
DECLARE existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'mill_notification_email_cron_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret('${secret}', 'mill_notification_email_cron_secret', 'Mill email scheduler authorization');
  ELSE
    PERFORM vault.update_secret(existing_id, '${secret}');
  END IF;
END;
$setup$;
SELECT cron.schedule('mill-notification-emails', '* * * * *', $job$
  SELECT net.http_post(
    url := '${quotedUrl}',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'mill_notification_email_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) WHERE EXISTS (
    SELECT 1 FROM public.notification_email_outbox
    WHERE status IN ('pending', 'failed', 'sending') AND next_attempt_at <= now() AND attempts < 10
  ) OR EXISTS (
    SELECT 1 FROM public.conversation_email_outbox
    WHERE status IN ('pending', 'failed', 'sending') AND next_attempt_at <= now() AND attempts < 10
  );
$job$);
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname='mill-notification-emails';
`;
const sqlPath = resolve(secretPath + ".setup.sql");
writeFileSync(sqlPath, sql, { mode: 0o600 });
try {
  const result = spawnSync(
    process.env.SUPABASE_CLI ?? "supabase",
    ["db", "query", "--linked", "--file", sqlPath, "--output", "json"],
    { encoding: "utf8" },
  );
  if (result.status !== 0)
    throw new Error(
      "Scheduler setup failed; inspect the linked project's extensions and CLI authorization",
    );
  const response = JSON.parse(result.stdout);
  console.log(JSON.stringify(response.rows));
} finally {
  unlinkSync(sqlPath);
}
