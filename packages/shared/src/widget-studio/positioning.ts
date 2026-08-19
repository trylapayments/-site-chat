import { WIDGET_DIMENSION_LIMITS } from "./constants";
import type { WidgetPosition } from "./constants";

/**
 * Clamp launcher offsets so the launcher stays within a reasonable viewport margin.
 * Prevents configuration that pushes the launcher off-screen on common viewports.
 */
export function clampLauncherOffset(value: number): number {
  if (!Number.isFinite(value)) {
    return WIDGET_DIMENSION_LIMITS.offsetMin;
  }
  return Math.min(
    WIDGET_DIMENSION_LIMITS.offsetMax,
    Math.max(WIDGET_DIMENSION_LIMITS.offsetMin, Math.round(value)),
  );
}

export type LauncherPlacement = {
  position: WidgetPosition;
  offsetX: number;
  offsetY: number;
  /** Physical CSS insets — NOT mirrored for RTL (product decision). */
  style: {
    bottom: string;
    left?: string;
    right?: string;
  };
};

/**
 * Physical left/right placement so launcher position is stable under RTL document direction.
 */
export function resolveLauncherPlacement(input: {
  position: WidgetPosition;
  offsetX: number;
  offsetY: number;
}): LauncherPlacement {
  const offsetX = clampLauncherOffset(input.offsetX);
  const offsetY = clampLauncherOffset(input.offsetY);
  const bottom = `${String(offsetY)}px`;

  if (input.position === "bottom-left") {
    return {
      position: input.position,
      offsetX,
      offsetY,
      style: { bottom, left: `${String(offsetX)}px`, right: "auto" },
    };
  }

  return {
    position: input.position,
    offsetX,
    offsetY,
    style: { bottom, right: `${String(offsetX)}px`, left: "auto" },
  };
}
