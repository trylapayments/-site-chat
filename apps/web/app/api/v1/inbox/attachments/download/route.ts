import { attachmentDownloadDataSchema } from "@site-chat/shared";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createAttachmentDownloadUrl } from "@/lib/attachments/service";
import { requireUser } from "@/lib/auth/session";
import { requireCapability } from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspace/redirect.server";

const querySchema = z
  .object({
    workspaceId: z.string().uuid(),
    attachmentId: z.string().uuid(),
    variant: z.enum(["full", "thumbnail"]).optional().default("full"),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      workspaceId: url.searchParams.get("workspaceId"),
      attachmentId: url.searchParams.get("attachmentId"),
      variant: url.searchParams.get("variant") ?? "full",
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { membership } = await getWorkspaceContext();
    const workspace = membership.accessible_workspaces.find(
      (item) => item.workspace_id === parsed.data.workspaceId,
    );

    if (!workspace) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    requireCapability(workspace.role, "view_conversations");

    const download = await createAttachmentDownloadUrl({
      workspaceId: parsed.data.workspaceId,
      attachmentId: parsed.data.attachmentId,
      variant: parsed.data.variant,
    });

    return NextResponse.json({
      data: attachmentDownloadDataSchema.parse(download),
    });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
