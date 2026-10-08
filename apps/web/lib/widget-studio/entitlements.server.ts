import "server-only";

import {
  defaultWidgetStudioEntitlements,
  resolveWidgetStudioEntitlements,
  WIDGET_STUDIO_FEATURES,
} from "@site-chat/shared";

/** Explicit pilot grants until billing supplies workspace capabilities. */
export function workspaceWidgetStudioEntitlements(workspaceId: string) {
  const pilots = (process.env.MILL_FULL_FEATURE_WORKSPACE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return pilots.includes(workspaceId)
    ? resolveWidgetStudioEntitlements({
        grantedFeatures: WIDGET_STUDIO_FEATURES,
      })
    : defaultWidgetStudioEntitlements();
}
