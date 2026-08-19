/**
 * White-label / plan entitlement readiness.
 *
 * Do NOT hardcode plan names or billing logic in UI components.
 * Resolve capabilities through this abstraction; billing PR will feed real entitlements.
 */

export const WIDGET_STUDIO_FEATURES = [
  "basic_styling",
  "custom_logo",
  "custom_launcher_icon",
  "advanced_styling",
  "hide_powered_by",
  "business_hours",
  "locale_copy_overrides",
  "custom_domain",
] as const;

export type WidgetStudioFeature = (typeof WIDGET_STUDIO_FEATURES)[number];

/**
 * Entitlement snapshot for a workspace. Until billing ships, defaults grant
 * studio-editing features except white-label hide_powered_by and enterprise
 * custom_domain (fail-closed branding).
 */
export type WidgetStudioEntitlements = {
  features: ReadonlySet<WidgetStudioFeature>;
};

const DEFAULT_FEATURES: readonly WidgetStudioFeature[] = [
  "basic_styling",
  "custom_logo",
  "custom_launcher_icon",
  "advanced_styling",
  "business_hours",
  "locale_copy_overrides",
];

export function defaultWidgetStudioEntitlements(): WidgetStudioEntitlements {
  return { features: new Set(DEFAULT_FEATURES) };
}

/** Fail-closed: unknown / missing entitlements grant nothing. */
export function emptyWidgetStudioEntitlements(): WidgetStudioEntitlements {
  return { features: new Set() };
}

export function resolveWidgetStudioEntitlements(input?: {
  /** Future: plan id / feature flags from billing. */
  grantedFeatures?: readonly WidgetStudioFeature[] | null;
}): WidgetStudioEntitlements {
  if (input?.grantedFeatures == null) {
    return defaultWidgetStudioEntitlements();
  }
  const features = new Set<WidgetStudioFeature>();
  for (const feature of input.grantedFeatures) {
    if ((WIDGET_STUDIO_FEATURES as readonly string[]).includes(feature)) {
      features.add(feature);
    }
  }
  return { features };
}

export function hasWidgetStudioFeature(
  entitlements: WidgetStudioEntitlements,
  feature: WidgetStudioFeature,
): boolean {
  return entitlements.features.has(feature);
}

/**
 * Effective showPoweredBy for public delivery:
 * - If hide_powered_by is not entitled, always show branding.
 * - Otherwise honor the published config flag.
 */
export function resolveShowPoweredBy(input: {
  configured: boolean;
  entitlements: WidgetStudioEntitlements;
}): boolean {
  if (!hasWidgetStudioFeature(input.entitlements, "hide_powered_by")) {
    return true;
  }
  return input.configured;
}
