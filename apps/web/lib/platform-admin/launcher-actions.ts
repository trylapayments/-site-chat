"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requirePlatformAdministrator } from "./guard";
import { createServiceClient } from "@/lib/supabase/service";
import {
  initiateWidgetAssetUpload,
  completeWidgetAssetUpload,
} from "@/lib/widget-studio/assets";

async function authorize(workspaceId: string) {
  z.string().uuid().parse(workspaceId);
  const administrator = await requirePlatformAdministrator();
  if (administrator.role !== "owner")
    throw new Error("Platform owner required.");
  const { data, error } = await createServiceClient()
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) throw new Error("Customer not found.");
  return administrator;
}
export async function uploadPlatformLauncher(
  workspaceId: string,
  input: { filename: string; mimeType: string; sizeBytes: number },
) {
  const { user } = await authorize(workspaceId);
  return initiateWidgetAssetUpload({
    ...input,
    kind: "launcher_icon",
    workspaceId,
    createdBy: user.id,
  });
}
export async function applyPlatformLauncher(
  workspaceId: string,
  assetId: string | null,
  version: number,
  reason: string,
) {
  const { user } = await authorize(workspaceId);
  z.string().trim().min(3).max(2000).parse(reason);
  z.number().int().positive().parse(version);
  if (assetId) {
    z.string().uuid().parse(assetId);
    const asset = await completeWidgetAssetUpload({ workspaceId, assetId });
    if (asset.kind !== "launcher_icon")
      throw new Error("Launcher icon required.");
  }
  const { error } = await createServiceClient().rpc(
    "platform_set_launcher_icon" as never,
    {
      p_actor_id: user.id,
      p_workspace_id: workspaceId,
      p_asset_id: assetId,
      p_reason: reason,
      p_expected_version: version,
    } as never,
  );
  if (error)
    throw new Error(
      error.code === "40001"
        ? "Widget changed. Refresh and retry."
        : "The icon could not be applied.",
    );
  revalidatePath(`/admin/customers/${workspaceId}/widget`);
}
