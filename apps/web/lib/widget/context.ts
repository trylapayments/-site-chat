import { widgetPublicKeySchema } from "@site-chat/shared";

import {
  createEmbedToken,
  normalizeParentOrigin,
  verifyEmbedToken,
  type EmbedTokenPayload,
} from "@/lib/widget/embed-token";
import { isDevLocalOrigin } from "@/lib/widget/origin";
import {
  resolveWidgetByPublicKey,
  validateWidgetOrigin,
  type WidgetWorkspaceLookup,
} from "@/lib/widget/service";

export type VerifiedEmbedContext = EmbedTokenPayload & {
  workspace: WidgetWorkspaceLookup;
};

export async function resolveBootstrapContext(input: {
  widgetPublicKey: string;
  requestOrigin: string | null;
}): Promise<
  | { ok: true; workspace: WidgetWorkspaceLookup; parentOrigin: string }
  | { ok: false }
> {
  const keyResult = widgetPublicKeySchema.safeParse(input.widgetPublicKey);
  if (!keyResult.success) {
    return { ok: false };
  }

  const workspace = await resolveWidgetByPublicKey(keyResult.data);
  if (!workspace) {
    return { ok: false };
  }

  const parentOrigin = input.requestOrigin
    ? normalizeParentOrigin(input.requestOrigin)
    : null;

  if (!parentOrigin) {
    return { ok: false };
  }

  const allowed =
    isDevLocalOrigin(parentOrigin) ||
    (await validateWidgetOrigin(
      workspace.workspaceId,
      parentOrigin,
      process.env.NODE_ENV === "production",
    ));

  if (!allowed) {
    return { ok: false };
  }

  return { ok: true, workspace, parentOrigin };
}

export function issueEmbedToken(
  workspace: WidgetWorkspaceLookup,
  parentOrigin: string,
) {
  return createEmbedToken({
    widgetPublicKey: workspace.widgetPublicKey,
    workspaceId: workspace.workspaceId,
    parentOrigin,
  });
}

export async function verifyEmbedContext(
  embedToken: string,
): Promise<VerifiedEmbedContext | null> {
  try {
    const payload = verifyEmbedToken(embedToken);
    const workspace = await resolveWidgetByPublicKey(payload.widgetPublicKey);

    if (!workspace || workspace.workspaceId !== payload.workspaceId) {
      return null;
    }

    const allowed =
      isDevLocalOrigin(payload.parentOrigin) ||
      (await validateWidgetOrigin(
        workspace.workspaceId,
        payload.parentOrigin,
        process.env.NODE_ENV === "production",
      ));

    if (!allowed) {
      return null;
    }

    return {
      ...payload,
      workspace,
    };
  } catch {
    return null;
  }
}

export function corsOriginFromEmbed(parentOrigin: string): string {
  return parentOrigin;
}
