"use server";

import {
  applyWidgetPreset,
  widgetAppearanceConfigSchema,
  widgetAssetKindSchema,
  widgetPresetIdSchema,
  widgetStudioMessagesEn,
  type WidgetStudioState,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/session";
import {
  SETTINGS_SECTION_WIDGET_STUDIO,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import {
  completeWidgetAssetUpload,
  initiateWidgetAssetUpload,
  WidgetAssetValidationError,
  type WidgetAssetUploadIntent,
  type WidgetAssetView,
} from "@/lib/widget-studio/assets";
import { requireWidgetStudioWorkspace } from "@/lib/widget-studio/guards";
import {
  discardWidgetStudioDraft,
  fetchWidgetStudioState,
  publishWidgetStudio,
  resetWidgetStudioDraft,
  saveWidgetStudioDraft,
} from "@/lib/widget-studio/queries";

const messages = widgetStudioMessagesEn;

const presetActionSchema = z
  .object({
    draft: widgetAppearanceConfigSchema,
    presetId: widgetPresetIdSchema,
  })
  .strict();

const initiateAssetSchema = z
  .object({
    kind: widgetAssetKindSchema,
    filename: z.string().min(1).max(512),
    mimeType: z.string().min(1).max(128),
    sizeBytes: z.number().int().positive(),
    width: z.number().int().positive().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
  })
  .strict();

const completeAssetSchema = z
  .object({
    assetId: z.string().uuid(),
  })
  .strict();

export type WidgetStudioActionResult<T> =
  | { success: true; data: T }
  | { success: false; message: string; code?: string };

function actionErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    return [record.message, record.details, record.hint]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join(" ");
  }
  return typeof error === "string" ? error : "";
}

function actionError<T>(
  error: unknown,
  fallback: string,
): WidgetStudioActionResult<T> {
  if (error instanceof CapabilityError) {
    return { success: false, message: messages.forbidden, code: "FORBIDDEN" };
  }
  if (error instanceof WidgetAssetValidationError) {
    return { success: false, message: error.message, code: error.code };
  }
  const text = actionErrorText(error);
  if (text.includes("PUBLISH_CONFLICT")) {
    return {
      success: false,
      message:
        "Publish conflict: another admin published while you were editing. Reload Widget Studio, review the latest version, and try again.",
      code: "PUBLISH_CONFLICT",
    };
  }
  return { success: false, message: fallback };
}

function revalidateStudio(workspaceSlug: string): void {
  revalidatePath(
    workspaceSettingsPath(workspaceSlug, SETTINGS_SECTION_WIDGET_STUDIO),
  );
}

async function requireWidgetStudioContext(
  workspaceSlug: string,
  manage: boolean,
) {
  const { workspace } = await requireWidgetStudioWorkspace(workspaceSlug);
  if (manage) {
    requireCapability(workspace.role, "manage_widget_studio");
  }
  const supabase = await createClient();
  return { workspace, supabase };
}

export async function getWidgetStudioStateAction(
  workspaceSlug: string,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      false,
    );
    const state = await fetchWidgetStudioState(
      supabase,
      workspace.workspace_id,
    );
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to load Widget Studio.");
  }
}

export async function saveWidgetStudioDraftAction(
  workspaceSlug: string,
  draft: unknown,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  const parsed = widgetAppearanceConfigSchema.safeParse(draft);
  if (!parsed.success) {
    return {
      success: false,
      message:
        parsed.error.issues[0]?.message ?? "The widget draft is not valid.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const state = await saveWidgetStudioDraft(
      supabase,
      workspace.workspace_id,
      parsed.data,
    );
    revalidateStudio(workspaceSlug);
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to save the widget draft.");
  }
}

export async function publishWidgetStudioAction(
  workspaceSlug: string,
  expectedPublishedVersion?: unknown,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  const expected =
    expectedPublishedVersion === undefined || expectedPublishedVersion === null
      ? null
      : z.number().int().positive().safeParse(expectedPublishedVersion);
  if (
    expectedPublishedVersion !== undefined &&
    expectedPublishedVersion !== null &&
    (expected === null || !expected.success)
  ) {
    return {
      success: false,
      message: "Invalid publish version.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const state = await publishWidgetStudio(
      supabase,
      workspace.workspace_id,
      expected && "success" in expected && expected.success
        ? expected.data
        : null,
    );
    revalidateStudio(workspaceSlug);
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to publish the widget.");
  }
}

export async function discardWidgetStudioDraftAction(
  workspaceSlug: string,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const state = await discardWidgetStudioDraft(
      supabase,
      workspace.workspace_id,
    );
    revalidateStudio(workspaceSlug);
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to discard the widget draft.");
  }
}

export async function resetWidgetStudioDraftAction(
  workspaceSlug: string,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const state = await resetWidgetStudioDraft(
      supabase,
      workspace.workspace_id,
    );
    revalidateStudio(workspaceSlug);
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to reset the widget draft.");
  }
}

export async function applyWidgetStudioPresetAction(
  workspaceSlug: string,
  input: unknown,
): Promise<WidgetStudioActionResult<WidgetStudioState>> {
  const parsed = presetActionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: "The selected widget preset is not valid.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const draft = applyWidgetPreset(parsed.data.presetId, parsed.data.draft);
    const state = await saveWidgetStudioDraft(
      supabase,
      workspace.workspace_id,
      draft,
    );
    revalidateStudio(workspaceSlug);
    return { success: true, data: state };
  } catch (error) {
    return actionError(error, "Unable to apply the widget preset.");
  }
}

export async function initiateWidgetStudioAssetUploadAction(
  workspaceSlug: string,
  input: unknown,
): Promise<WidgetStudioActionResult<WidgetAssetUploadIntent>> {
  const parsed = initiateAssetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Invalid asset upload.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { workspace, supabase } = await requireWidgetStudioContext(
      workspaceSlug,
      true,
    );
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: messages.forbidden, code: "FORBIDDEN" };
    }

    const intent = await initiateWidgetAssetUpload({
      ...parsed.data,
      workspaceId: workspace.workspace_id,
      createdBy: user.id,
    });
    return { success: true, data: intent };
  } catch (error) {
    return actionError(error, "Unable to start the asset upload.");
  }
}

export async function completeWidgetStudioAssetUploadAction(
  workspaceSlug: string,
  input: unknown,
): Promise<WidgetStudioActionResult<WidgetAssetView>> {
  const parsed = completeAssetSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      message: "Invalid asset upload.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { workspace } = await requireWidgetStudioContext(workspaceSlug, true);
    const asset = await completeWidgetAssetUpload({
      workspaceId: workspace.workspace_id,
      assetId: parsed.data.assetId,
    });
    return { success: true, data: asset };
  } catch (error) {
    return actionError(error, "Unable to confirm the asset upload.");
  }
}
