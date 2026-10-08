"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { validateWidgetAssetContents } from "@/lib/widget-studio/assets";
async function ownMembership(slug: string) {
  const { workspace } = await requireInboxWorkspace(slug);
  const { user } = await requireUser(await createClient());
  if (!user) throw new Error("Please sign in again.");
  const service = createServiceClient();
  const { data, error } = await service
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspace.workspace_id)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();
  if (error) throw new Error("Active membership required.");
  return { service, memberId: data.id, workspaceId: workspace.workspace_id };
}
export async function getMyAgentProfileAction(slug: string) {
  const { service, memberId, workspaceId } = await ownMembership(slug);
  const { data, error } = await service
    .from("agent_profiles")
    .select("display_name,avatar_path")
    .eq("member_id", memberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error("Unable to load your profile.");
  let avatarUrl: string | null = null;
  if (data?.avatar_path)
    avatarUrl =
      (
        await service.storage
          .from("agent-avatars")
          .createSignedUrl(data.avatar_path, 3600)
      ).data?.signedUrl ?? null;
  return { name: data?.display_name ?? "", avatarUrl };
}
export async function saveMyAgentProfileAction(slug: string, form: FormData) {
  const parsed = z.string().trim().min(1).max(100).safeParse(form.get("name"));
  if (!parsed.success)
    return {
      success: false as const,
      message: "Enter your name (up to 100 characters).",
    };
  const { service, memberId, workspaceId } = await ownMembership(slug);
  const { data: current, error: readError } = await service
    .from("agent_profiles")
    .select("avatar_path")
    .eq("member_id", memberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (readError)
    return {
      success: false as const,
      message: "Unable to load your profile. Try again.",
    };
  let path = current?.avatar_path ?? null;
  let uploaded: string | null = null;
  let saved = false;
  try {
    const photo = form.get("photo");
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 2 * 1024 * 1024)
        throw new Error("Use an image smaller than 2 MB.");
      const extensions: Record<string, string> = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/webp": "webp",
      };
      const extension = extensions[photo.type];
      if (!extension) throw new Error("Choose a PNG, JPEG or WebP photo.");
      const bytes = new Uint8Array(await photo.arrayBuffer());
      validateWidgetAssetContents(bytes, photo.type);
      uploaded = `${workspaceId}/${memberId}/${randomUUID()}.${extension}`;
      const upload = await service.storage
        .from("agent-avatars")
        .upload(uploaded, bytes, { contentType: photo.type, upsert: false });
      if (upload.error) throw new Error("Unable to upload your photo.");
      path = uploaded;
    } else if (form.get("removePhoto") === "true") path = null;
    const { error } = await service.from("agent_profiles").upsert({
      member_id: memberId,
      workspace_id: workspaceId,
      display_name: parsed.data,
      avatar_path: path,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error("Unable to save your profile.");
    saved = true;
    if (current?.avatar_path && current.avatar_path !== path)
      await service.storage.from("agent-avatars").remove([current.avatar_path]);
    revalidatePath(`/app/${slug}/settings/profile`);
    return {
      success: true as const,
      profile: await getMyAgentProfileAction(slug),
    };
  } catch (error) {
    if (uploaded && !saved)
      await service.storage.from("agent-avatars").remove([uploaded]);
    return {
      success: false as const,
      message:
        error instanceof Error ? error.message : "Unable to save your profile.",
    };
  }
}
