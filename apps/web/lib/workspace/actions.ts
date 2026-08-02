"use server";

import {
  createWorkspaceResultSchema,
  createWorkspaceSchema,
  selectWorkspaceSchema,
  switchWorkspaceSchema,
} from "@site-chat/shared";
import { redirect } from "next/navigation";

import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import type { WorkspaceActionState } from "@/lib/workspace/action-state";
import {
  fetchAccessibleWorkspaces,
  setLastWorkspace,
} from "@/lib/workspace/queries";
import { callPublicRpc } from "@/lib/workspace/rpc";
import { resolveWorkspaceSwitchDestination } from "@/lib/workspace/switch-workspace";
import { createClient } from "@/lib/supabase/server";

function mapFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  return issues.reduce<Record<string, string[]>>((acc, issue) => {
    const key = String(issue.path[0] ?? "form");
    acc[key] ??= [];
    acc[key].push(issue.message);
    return acc;
  }, {});
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function mapWorkspaceRpcError(error: {
  message: string;
}): WorkspaceActionState {
  if (
    error.message.includes("duplicate key value violates unique constraint")
  ) {
    return {
      success: false,
      fieldErrors: {
        slug: ["This slug is already taken. Choose another."],
      },
      message: "This slug is already taken.",
    };
  }

  return {
    success: false,
    message: "Something went wrong. Please try again.",
  };
}

export async function createWorkspaceAction(
  _prevState: WorkspaceActionState,
  formData: FormData,
): Promise<WorkspaceActionState> {
  const parsed = createWorkspaceSchema.safeParse({
    name: getFormString(formData, "name"),
    slug: getFormString(formData, "slug"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      message: "Fix the highlighted fields.",
    };
  }

  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  if (!user) {
    redirect(toAppRoute("/login"));
  }

  const { data, error } = await callPublicRpc(supabase, "create_workspace", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
  });

  if (error) {
    return mapWorkspaceRpcError(error);
  }

  const workspace = createWorkspaceResultSchema.safeParse(data);
  if (!workspace.success) {
    return {
      success: false,
      message: "Something went wrong. Please try again.",
    };
  }

  redirect(toAppRoute(`/app/${workspace.data.slug}`));
}

export async function switchWorkspaceAction(formData: FormData): Promise<void> {
  const parsed = switchWorkspaceSchema.safeParse({
    workspaceId: getFormString(formData, "workspaceId"),
    currentPath: getFormString(formData, "currentPath") || undefined,
  });

  if (!parsed.success) {
    redirect(toAppRoute("/app/select-workspace"));
  }

  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  if (!user) {
    redirect(toAppRoute("/login"));
  }

  const membership = await fetchAccessibleWorkspaces(supabase);
  const resolution = resolveWorkspaceSwitchDestination({
    workspaceId: parsed.data.workspaceId,
    currentPath: parsed.data.currentPath,
    accessibleWorkspaces: membership.accessible_workspaces,
  });

  if (!resolution.ok) {
    redirect(toAppRoute(resolution.destination));
  }

  await setLastWorkspace(supabase, resolution.workspaceId);
  redirect(toAppRoute(resolution.destination));
}

export async function selectWorkspaceAction(formData: FormData): Promise<void> {
  const parsed = selectWorkspaceSchema.safeParse({
    workspaceId: getFormString(formData, "workspaceId"),
  });

  if (!parsed.success) {
    redirect(toAppRoute("/app/select-workspace"));
  }

  return switchWorkspaceAction(formData);
}
