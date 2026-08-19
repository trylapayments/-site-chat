import {
  WIDGET_ASSET_LIMITS,
  applyPublicAppearanceEntitlements,
  defaultWidgetAppearanceConfig,
  emptyWidgetStudioEntitlements,
  isWidgetAssetStorageKeyForWorkspace,
  mapAppearanceToPublicConfig,
  resolveWidgetStudioEntitlements,
  widgetConfigSigningBucket,
} from "@site-chat/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const createSignedDownloadUrl = vi.fn();
vi.mock("@/lib/storage/supabase-object-storage", () => ({
  createSupabaseObjectStorage: () => ({
    createSignedDownloadUrl,
  }),
}));

const fromMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: fromMock,
  }),
}));

const { enrichWidgetPublicAppearance, widgetPublicConfigEtag } =
  await import("./public-config");

describe("widget asset storage key invariant", () => {
  it("accepts only workspace-scoped keys", () => {
    const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(
      isWidgetAssetStorageKeyForWorkspace(
        `workspaces/${workspaceId}/widget-assets/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/logo.png`,
        workspaceId,
      ),
    ).toBe(true);
    expect(
      isWidgetAssetStorageKeyForWorkspace(
        `workspaces/cccccccc-cccc-4ccc-8ccc-cccccccccccc/widget-assets/x/logo.png`,
        workspaceId,
      ),
    ).toBe(false);
    expect(
      isWidgetAssetStorageKeyForWorkspace(
        `workspaces/${workspaceId}/widget-assets/../escape.png`,
        workspaceId,
      ),
    ).toBe(false);
  });
});

describe("public config entitlements", () => {
  it("forces powered-by when hide entitlement is absent", () => {
    const config = {
      ...defaultWidgetAppearanceConfig(),
      showPoweredBy: false,
    };
    const restricted = mapAppearanceToPublicConfig({
      config,
      publishedVersion: 2,
      publishedAt: "2026-08-19T00:00:00.000Z",
      entitlements: emptyWidgetStudioEntitlements(),
    });
    expect(restricted.showPoweredBy).toBe(true);
    expect(restricted.branding.showPoweredBy).toBe(true);

    const allowed = mapAppearanceToPublicConfig({
      config,
      publishedVersion: 2,
      publishedAt: "2026-08-19T00:00:00.000Z",
      entitlements: resolveWidgetStudioEntitlements({
        grantedFeatures: ["hide_powered_by"],
      }),
    });
    expect(allowed.showPoweredBy).toBe(false);
  });

  it("applyPublicAppearanceEntitlements remaps parsed DTOs", () => {
    const base = mapAppearanceToPublicConfig({
      config: {
        ...defaultWidgetAppearanceConfig(),
        showPoweredBy: false,
      },
      publishedVersion: 1,
      publishedAt: "2026-08-19T00:00:00.000Z",
    });
    const forced = applyPublicAppearanceEntitlements(
      base,
      emptyWidgetStudioEntitlements(),
    );
    expect(forced.showPoweredBy).toBe(true);
  });
});

describe("ETag signing bucket", () => {
  it("changes when the signing epoch rolls without a publish", () => {
    const key = "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const bucketSeconds = WIDGET_ASSET_LIMITS.configSigningBucketSeconds;
    const t0 = bucketSeconds * 1000;
    const t1 = (bucketSeconds * 2 + 1) * 1000;
    expect(widgetConfigSigningBucket(t0, bucketSeconds)).not.toBe(
      widgetConfigSigningBucket(t1, bucketSeconds),
    );
    expect(widgetPublicConfigEtag(key, 3, t0)).not.toBe(
      widgetPublicConfigEtag(key, 3, t1),
    );
  });
});

describe("enrichWidgetPublicAppearance asset authorization", () => {
  it("signs only verified same-workspace assets with valid storage keys", async () => {
    const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const published = {
      ...defaultWidgetAppearanceConfig(),
      logoAssetId: assetId,
      showPoweredBy: false,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "widget_configs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    published_json: published,
                    published_version: 5,
                    published_at: "2026-08-19T12:00:00.000Z",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              eq: () => ({
                is: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: assetId,
                        kind: "logo",
                        status: "verified",
                        verified_at: "2026-08-19T11:00:00.000Z",
                        width: 64,
                        height: 64,
                        storage_key: `workspaces/${workspaceId}/widget-assets/${assetId}/logo.png`,
                        deleted_at: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    });

    createSignedDownloadUrl.mockResolvedValue({
      url: "https://cdn.example.com/signed-logo",
      expiresAt: "2026-08-19T13:00:00.000Z",
    });

    const result = await enrichWidgetPublicAppearance({
      workspaceId,
      publicConfig: {},
      entitlements: emptyWidgetStudioEntitlements(),
    });

    expect(result.logoUrl).toBe("https://cdn.example.com/signed-logo");
    expect(result.showPoweredBy).toBe(true);
    expect(createSignedDownloadUrl).toHaveBeenCalledWith({
      path: `workspaces/${workspaceId}/widget-assets/${assetId}/logo.png`,
      expiresInSeconds: WIDGET_ASSET_LIMITS.signedDownloadTtlSeconds,
    });
  });

  it("returns null URL for foreign storage keys", async () => {
    const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const assetId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const published = {
      ...defaultWidgetAppearanceConfig(),
      logoAssetId: assetId,
    };

    fromMock.mockImplementation((table: string) => {
      if (table === "widget_configs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    published_json: published,
                    published_version: 1,
                    published_at: "2026-08-19T12:00:00.000Z",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: () => ({
              eq: () => ({
                is: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: assetId,
                        kind: "logo",
                        status: "verified",
                        verified_at: "2026-08-19T11:00:00.000Z",
                        width: 64,
                        height: 64,
                        storage_key:
                          "workspaces/dddddddd-dddd-4ddd-8ddd-dddddddddddd/widget-assets/x/logo.png",
                        deleted_at: null,
                      },
                    ],
                    error: null,
                  }),
              }),
            }),
          }),
        }),
      };
    });

    createSignedDownloadUrl.mockClear();
    const result = await enrichWidgetPublicAppearance({
      workspaceId,
      publicConfig: {},
    });
    expect(result.logoUrl).toBeNull();
    expect(createSignedDownloadUrl).not.toHaveBeenCalled();
  });
});
