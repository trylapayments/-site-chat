/** Configure only the mobile push scheduler after explicit production approval. */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const secretPath = process.env.MILL_MOBILE_PUSH_SECRET_FILE;
if (!secretPath) throw new Error("MILL_MOBILE_PUSH_SECRET_FILE is required");
const secret = readFileSync(secretPath, "utf8").trim();
if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret))
  throw new Error("Invalid scheduler secret");
const endpoint = new URL(
  process.env.MILL_MOBILE_PUSH_WORKER_URL ??
    "https://app.mill.chat/api/internal/mobile-push",
);
if (
  endpoint.hostname !== "app.mill.chat" ||
  endpoint.pathname !== "/api/internal/mobile-push" ||
  endpoint.protocol !== "https:" ||
  endpoint.username ||
  endpoint.password ||
  endpoint.search ||
  endpoint.hash
)
  throw new Error("Invalid worker URL");
const quotedUrl = endpoint.href.replaceAll("'", "''");
const sql = `BEGIN;
DO $setup$
DECLARE existing_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') OR
     NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') OR
     NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='supabase_vault') THEN
    RAISE EXCEPTION 'Required scheduler extensions are not installed';
  END IF;
  SELECT id INTO existing_id FROM vault.secrets WHERE name='mill_mobile_push_cron_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret('${secret}','mill_mobile_push_cron_secret','Mill push scheduler authorization');
  ELSE
    PERFORM vault.update_secret(existing_id,'${secret}');
  END IF;
END;
$setup$;
SELECT cron.schedule('mill-mobile-push','* * * * *',$job$
  SELECT net.http_post(url:='${quotedUrl}',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='mill_mobile_push_cron_secret')),
    body:='{}'::jsonb,timeout_milliseconds:=60000)
  WHERE EXISTS (SELECT 1 FROM public.mobile_push_outbox
    WHERE (status='pending' AND next_attempt_at<=now()) OR
      (status='sending' AND claimed_at<now()-interval '2 minutes'))
    OR EXISTS (SELECT 1 FROM public.mobile_push_outbox WHERE status='sent'
      AND receipt_checked_at IS NULL AND ticket_id IS NOT NULL AND claimed_at<now()-interval '15 minutes');
$job$);
COMMIT;
SELECT jobname,schedule,active FROM cron.job WHERE jobname='mill-mobile-push';
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
    throw new Error("Mobile push scheduler setup failed");
  console.log(JSON.stringify(JSON.parse(result.stdout).rows));
} finally {
  unlinkSync(sqlPath);
}
