import "server-only";

import {
  WIDGET_ASSETS_BUCKET,
  WIDGET_ASSET_LIMITS,
  mapAppearanceToPublicConfig,
  widgetAppearanceConfigSchema,
  widgetPublicAppearanceSchema,
  type WidgetAssetKind,
  type WidgetPublicAppearance,
} from "@site-chat/shared";

import { createSupabaseObjectStorage } from "@/lib/storage/supabase-object-storage";
import { createServiceClient } from "@/lib/supabase/service";

type AssetTarget = {
  id: string;
  kind: WidgetAssetKind;
  field: "logoUrl" | "launcherIconUrl" | "agentAvatarUrl";
};

/**
 * Fill visitor-safe published config with short-lived private asset URLs.
 * Draft JSON is never read here.
 */
export async function enrichWidgetPublicAppearance(input: {
  workspaceId: string;
  publicConfig: unknown;
}): Promise<WidgetPublicAppearance> {
  const parsedPublic = widgetPublicAppearanceSchema.safeParse(
    input.publicConfig,
  );
  const supabase = createServiceClient();
  const { data: configRow, error: configError } = await supabase
    .from("widget_configs")
    .select("published_json, published_version, published_at")
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();

  if (configError || !configRow) {
    if (!parsedPublic.success) {
      throw new Error("Invalid published widget appearance");
    }
    return clearAssetUrls(parsedPublic.data);
  }

  const published = widgetAppearanceConfigSchema.safeParse(
    configRow.published_json,
  );
  if (!published.success) {
    if (!parsedPublic.success) {
      throw new Error("Invalid published widget appearance");
    }
    return clearAssetUrls(parsedPublic.data);
  }

  const publicAppearance = clearAssetUrls(
    parsedPublic.success
      ? parsedPublic.data
      : mapAppearanceToPublicConfig({
          config: published.data,
          publishedVersion: configRow.published_version,
          publishedAt: configRow.published_at,
        }),
  );

  const targets: AssetTarget[] = [];
  if (published.data.logoAssetId) {
    targets.push({
      id: published.data.logoAssetId,
      kind: "logo",
      field: "logoUrl",
    });
  }
  if (published.data.launcherIconAssetId) {
    targets.push({
      id: published.data.launcherIconAssetId,
      kind: "launcher_icon",
      field: "launcherIconUrl",
    });
  }
  if (published.data.agentAvatarAssetId) {
    targets.push({
      id: published.data.agentAvatarAssetId,
      kind: "agent_avatar",
      field: "agentAvatarUrl",
    });
  }

  if (targets.length === 0) {
    return publicAppearance;
  }

  const { data: assets, error: assetsError } = await supabase
    .from("widget_assets")
    .select("*")
    .eq("workspace_id", input.workspaceId)
    .in(
      "id",
      targets.map((target) => target.id),
    )
    .is("deleted_at", null)
    .not("width", "is", null)
    .not("height", "is", null);

  if (assetsError) {
    return publicAppearance;
  }

  const storage = createSupabaseObjectStorage(WIDGET_ASSETS_BUCKET);
  const signedEntries = await Promise.all(
    targets.map(
      async (target): Promise<[AssetTarget["field"], string | null]> => {
        const asset = assets.find(
          (candidate) =>
            candidate.id === target.id && candidate.kind === target.kind,
        );
        if (!asset) {
          return [target.field, null];
        }
        try {
          const signed = await storage.createSignedDownloadUrl({
            path: asset.storage_key,
            expiresInSeconds: WIDGET_ASSET_LIMITS.signedDownloadTtlSeconds,
          });
          return [target.field, signed.url];
        } catch {
          // A missing object must not take down bootstrap; omit that asset.
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
    ...publicAppearance,
    ...urls,
    branding: {
      ...publicAppearance.branding,
      logoUrl: urls.logoUrl ?? null,
    },
  });
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

export function widgetPublicConfigEtag(
  widgetPublicKey: string,
  version: number,
): string {
  return `"widget-config-${widgetPublicKey}-${String(version)}"`;
}
