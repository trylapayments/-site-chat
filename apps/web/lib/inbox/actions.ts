"use server";

import {
  assignConversationSchema,
  markConversationDeliveredSchema,
  markConversationReadSchema,
  sendMessageSchema,
  updateConversationStatusSchema,
  type MarkConversationDeliveredResult,
  type MarkConversationReadResult,
  type SendOperatorMessageResult,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";

import { workspaceNavPath } from "@/lib/dashboard/routes";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  assignConversation,
  markConversationDelivered,
  markConversationRead,
  sendOperatorMessage,
  updateConversationStatus,
} from "@/lib/inbox/queries";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export type InboxActionResult =
  | {
      success: true;
      data?:
        | SendOperatorMessageResult
        | MarkConversationReadResult
        | MarkConversationDeliveredResult;
    }
  | { success: false; message: string };

function mapActionError(error: unknown): InboxActionResult {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message };
  }
  return { success: false, message: "Something went wrong. Please try again." };
}

async function requireInboxMutationContext(workspaceSlug: string) {
  const { workspace } = await requireInboxWorkspace(workspaceSlug);
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    throw new CapabilityError(workspace.role, "view_conversations");
  }

  return { workspace, supabase };
}

export async function sendMessageAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    body: string;
    clientMessageId?: string;
  },
): Promise<InboxActionResult> {
  try {
    const parsed = sendMessageSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid message." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "send_messages");

    const result = await sendOperatorMessage(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
      parsed.data.body,
      parsed.data.clientMessageId,
    );

    revalidatePath(workspaceNavPath(workspaceSlug, "inbox"));
    revalidatePath(
      `${workspaceNavPath(workspaceSlug, "inbox")}/${parsed.data.conversationId}`,
    );
    return { success: true, data: result };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function assignConversationAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    assigneeMemberId: string | null;
  },
): Promise<InboxActionResult> {
  try {
    const parsed = assignConversationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid assignment." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "assign_conversations");

    await assignConversation(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
      parsed.data.assigneeMemberId,
    );

    revalidatePath(workspaceNavPath(workspaceSlug, "inbox"));
    revalidatePath(
      `${workspaceNavPath(workspaceSlug, "inbox")}/${parsed.data.conversationId}`,
    );
    return { success: true };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function updateConversationStatusAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    status: "open" | "pending" | "resolved" | "closed";
  },
): Promise<InboxActionResult> {
  try {
    const parsed = updateConversationStatusSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid status." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "update_conversation_status");

    await updateConversationStatus(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
      parsed.data.status,
    );

    revalidatePath(workspaceNavPath(workspaceSlug, "inbox"));
    revalidatePath(
      `${workspaceNavPath(workspaceSlug, "inbox")}/${parsed.data.conversationId}`,
    );
    return { success: true };
  } catch (error) {
    return mapActionError(error);
  }
}

export async function markConversationReadAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    throughSequence?: number;
  },
): Promise<InboxActionResult> {
  try {
    const parsed = markConversationReadSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid read request." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);

    const result = await markConversationRead(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
      parsed.data.throughSequence,
    );

    return { success: true, data: result };
  } catch {
    return { success: false, message: "Unable to mark conversation read." };
  }
}

export async function markConversationDeliveredAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    throughSequence: number;
  },
): Promise<InboxActionResult> {
  try {
    const parsed = markConversationDeliveredSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid delivery request." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);

    const result = await markConversationDelivered(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
      parsed.data.throughSequence,
    );

    return { success: true, data: result };
  } catch {
    return {
      success: false,
      message: "Unable to mark conversation delivered.",
    };
  }
}
