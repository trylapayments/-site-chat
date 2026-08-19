import "server-only";

import {
  WIDGET_ASSETS_BUCKET,
  WIDGET_ASSET_LIMITS,
  applyPublicAppearanceEntitlements,
  defaultWidgetStudioEntitlements,
  isWidgetAssetStorageKeyForWorkspace,
  mapAppearanceToPublicConfig,
  resolveWidgetStudioEntitlements,
  widgetAppearanceConfigSchema,
  widgetConfigSigningBucket,
  widgetPublicAppearanceSchema,
  type WidgetAppearanceConfig,
  type WidgetAssetKind,
  type WidgetPublicAppearance,
  type WidgetStudioEntitlements,
} from "@site-chat/shared";

import { createSupabaseObjectStorage } from "@/lib/storage/supabase-object-storage";
import { createServiceClient } from "@/lib/supabase/service";

type AssetTarget = {
  id: string;
  kind: WidgetAssetKind;
  field: "logoUrl" | "launcherIconUrl" | "agentAvatarUrl";
};

/**
 * Canonical visitor config finalizer:
 * published appearance → entitlements → verified asset signed URLs.
 * Draft JSON is never read here.
 */
export async function enrichWidgetPublicAppearance(input: {
  workspaceId: string;
  publicConfig: unknown;
  entitlements?: WidgetStudioEntitlements;
}): Promise<WidgetPublicAppearance> {
  const entitlements =
    input.entitlements ??
    resolveWidgetStudioEntitlements({
      // Until billing ships, defaults grant studio features. Tests pass
      // restricted entitlements explicitly.
      grantedFeatures: null,
    });

  const supabase = createServiceClient();
  const { data: configRow, error: configError } = await supabase
    .from("widget_configs")
    .select("published_json, published_version, published_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  let published: WidgetAppearanceConfig | null = null;
  let base: WidgetPublicAppearance;
  if (!configError && configRow) {
    const parsedPublished = widgetAppearanceConfigSchema.safeParse(
      configRow.published_json,
    );
    if (parsedPublished.success) {
      published = parsedPublished.data;
      base = mapAppearanceToPublicConfig({
        config: published,
        publishedVersion: configRow.published_version,
        publishedAt: configRow.published_at,
        entitlements,
      });
    } else {
      base = parsePublicAppearance(input.publicConfig);
    }
  } else {
    base = parsePublicAppearance(input.publicConfig);
  }

  // Always remap showPoweredBy, even for already-valid public DTOs.
  base = applyPublicAppearanceEntitlements(base, entitlements);
  base = clearAssetUrls(base);

  if (!published) {
    return base;
  }

  const targets: AssetTarget[] = [];
  if (published.logoAssetId) {
    targets.push({
      id: published.logoAssetId,
      kind: "logo",
      field: "logoUrl",
    });
  }
  if (published.launcherIconAssetId) {
    targets.push({
      id: published.launcherIconAssetId,
      kind: "launcher_icon",
      field: "launcherIconUrl",
    });
  }
  if (published.agentAvatarAssetId) {
    targets.push({
      id: published.agentAvatarAssetId,
      kind: "agent_avatar",
      field: "agentAvatarUrl",
    });
  }

  if (targets.length === 0) {
    return base;
  }

  const { data: assets, error: assetsError } = await supabase
    .from("widget_assets")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .in(
      "id",
      targets.map((target) => target.id),
    )
    .eq("status", "verified")
    .is("deleted_at", null);

  if (assetsError) {
    return base;
  }

  const storage = createSupabaseObjectStorage(WIDGET_ASSETS_BUCKET);
  const signedEntries = await Promise.all(
    targets.map(
      async (target): Promise<[AssetTarget["field"], string | null]> => {
        const asset = assets.find(
          (candidate) =>
            candidate.id === target.id &&
            candidate.kind === target.kind &&
            candidate.status === "verified" &&
            candidate.verified_at !== null &&
            candidate.width !== null &&
            candidate.height !== null,
        );
        if (!asset) {
          return [target.field, null];
        }
        if (
          !isWidgetAssetStorageKeyForWorkspace(
            asset.storage_key,
            input.workspaceId,
          )
        ) {
          return [target.field, null];
        }
        try {
          const signed = await storage.createSignedDownloadUrl({
            path: asset.storage_key,
            expiresInSeconds: WIDGET_ASSET_LIMITS.signedDownloadTtlSeconds,
          });
          return [target.field, signed.url];
        } catch {
          return [target.field, null];
        }
      },
    ),
  );

  const urls: Partial<
    Pick<
      WidgetPublicAppearance,
      "logoUrl" | "launcherIconUrl" | "agentAvatarUrl"
    >
  > = {};
  for (const [field, url] of signedEntries) {
    urls[field] = url;
  }

  return widgetPublicAppearanceSchema.parse({
    ...base,
    ...urls,
    branding: {
      ...base.branding,
      logoUrl: urls.logoUrl ?? null,
    },
  });
}

function parsePublicAppearance(input: unknown): WidgetPublicAppearance {
  const parsed = widgetPublicAppearanceSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Invalid published widget appearance");
  }
  return parsed.data;
}

function clearAssetUrls(
  appearance: WidgetPublicAppearance,
): WidgetPublicAppearance {
  return widgetPublicAppearanceSchema.parse({
    ...appearance,
    logoUrl: null,
    launcherIconUrl: null,
    agentAvatarUrl: null,
    branding: {
      ...appearance.branding,
      logoUrl: null,
    },
  });
}

/**
 * ETag includes published version + signing bucket so 304 cannot retain
 * expired signed asset URLs after the signing epoch rolls.
 * Cache max-age must stay shorter than signedDownloadTtlSeconds.
 */
export function widgetPublicConfigEtag(
  widgetPublicKey: string,
  version: number,
  nowMs: number = Date.now(),
): string {
  const bucket = widgetConfigSigningBucket(
    nowMs,
    WIDGET_ASSET_LIMITS.configSigningBucketSeconds,
  );
  return `"widget-config-${widgetPublicKey}-v${String(version)}-s${String(bucket)}"`;
}

export function widgetPublicConfigCacheControl(): string {
  // Keep public cache well below signed URL TTL and signing bucket width.
  const maxAge = Math.min(
    60,
    Math.floor(WIDGET_ASSET_LIMITS.configSigningBucketSeconds / 2),
  );
  return `public, max-age=${String(maxAge)}, stale-while-revalidate=${String(maxAge)}`;
}

export { defaultWidgetStudioEntitlements };
