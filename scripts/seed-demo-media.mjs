#!/usr/bin/env node
/**
 * Uploads local demo media into Supabase Storage and links it to seeded rows.
 * Requires .env.local (or env) with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const WORKSPACE_SLUG = "acme-support";
const LOGO_PATH = resolve(root, "demo/fixtures/acme-logo.png");
const RECEIPT_PATH = resolve(root, "demo/fixtures/receipt.png");

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq)] = value;
  }
  return env;
}

function requireEnv(name, ...sources) {
  for (const source of sources) {
    if (source[name]) return source[name];
  }
  throw new Error(`Missing required env: ${name}`);
}

async function main() {
  const fileEnv = {
    ...loadEnvFile(resolve(root, ".env.local")),
    ...loadEnvFile(resolve(root, "apps/web/.env.local")),
  };
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env, fileEnv);
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", process.env, fileEnv);

  if (!existsSync(LOGO_PATH) || !existsSync(RECEIPT_PATH)) {
    throw new Error("Demo fixtures missing under demo/fixtures/");
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", WORKSPACE_SLUG)
    .is("deleted_at", null)
    .maybeSingle();

  if (workspaceError || !workspace?.id) {
    throw new Error(`Workspace ${WORKSPACE_SLUG} not found. Run supabase db reset first.`);
  }

  const workspaceId = workspace.id;
  const logoBytes = readFileSync(LOGO_PATH);
  const receiptBytes = readFileSync(RECEIPT_PATH);

  // --- Widget logo ---
  const { data: existingLogo } = await supabase
    .from("widget_assets")
    .select("id, storage_key")
    .eq("workspace_id", workspaceId)
    .eq("kind", "logo")
    .is("deleted_at", null)
    .eq("original_filename", "acme-logo.png")
    .maybeSingle();

  let logoAssetId = existingLogo?.id ?? null;

  if (!logoAssetId) {
    logoAssetId = randomUUID();
    const storageKey = `workspaces/${workspaceId}/widget-assets/${logoAssetId}/acme-logo.png`;

    const { error: uploadError } = await supabase.storage
      .from("widget-assets")
      .upload(storageKey, logoBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (uploadError) {
      throw new Error(`Logo upload failed: ${uploadError.message}`);
    }

    const { error: insertError } = await supabase.from("widget_assets").insert({
      id: logoAssetId,
      workspace_id: workspaceId,
      kind: "logo",
      storage_key: storageKey,
      mime_type: "image/png",
      byte_size: logoBytes.length,
      width: 64,
      height: 64,
      original_filename: "acme-logo.png",
      status: "verified",
      verified_at: new Date().toISOString(),
    });
    if (insertError) {
      throw new Error(`widget_assets insert failed: ${insertError.message}`);
    }
  } else {
    const { error: reuploadError } = await supabase.storage
      .from("widget-assets")
      .upload(existingLogo.storage_key, logoBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (reuploadError) {
      throw new Error(`Logo re-upload failed: ${reuploadError.message}`);
    }
  }

  const { data: config, error: configError } = await supabase
    .from("widget_configs")
    .select("draft_json, published_json")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (configError || !config) {
    throw new Error(`widget_configs missing for ${WORKSPACE_SLUG}`);
  }

  const patchLogo = (appearance) => ({
    ...appearance,
    logoAssetId,
    headerStyle: appearance.headerStyle ?? "branded",
  });

  const nextDraft = patchLogo(config.draft_json ?? {});
  const nextPublished = patchLogo(config.published_json ?? {});

  const { error: updateConfigError } = await supabase
    .from("widget_configs")
    .update({
      draft_json: nextDraft,
      published_json: nextPublished,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);

  if (updateConfigError) {
    throw new Error(`widget_configs update failed: ${updateConfigError.message}`);
  }

  console.log(`Linked Widget Studio logo asset ${logoAssetId}`);

  // --- Message attachment bytes for seeded receipt.png ---
  const { data: attachment, error: attachmentError } = await supabase
    .from("message_attachments")
    .select("id, storage_key, filename")
    .eq("workspace_id", workspaceId)
    .eq("filename", "receipt.png")
    .maybeSingle();

  if (attachmentError) {
    throw new Error(`message_attachments lookup failed: ${attachmentError.message}`);
  }

  if (attachment?.storage_key) {
    const { error: attachUploadError } = await supabase.storage
      .from("attachments")
      .upload(attachment.storage_key, receiptBytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (attachUploadError) {
      throw new Error(`Attachment upload failed: ${attachUploadError.message}`);
    }
    console.log(`Uploaded attachment object for ${attachment.filename}`);
  } else {
    console.log("No seeded receipt.png attachment row yet — skipped attachment bytes.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
