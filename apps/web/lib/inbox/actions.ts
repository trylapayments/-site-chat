"use server";

import {
  assignConversationSchema,
  sendMessageSchema,
  updateConversationStatusSchema,
  markConversationReadSchema,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import {
  assignConversation,
  markConversationRead,
  sendOperatorMessage,
  updateConversationStatus,
} from "@/lib/inbox/queries";
import {
  CapabilityError,
  requireCapability,
} from "@/lib/permissions/require-capability";
import { createClient } from "@/lib/supabase/server";
import { workspaceNavPath } from "@/lib/dashboard/routes";

export type InboxActionResult =
  { success: true } | { success: false; message: string };

function mapActionError(error: unknown): InboxActionResult {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message };
  }
  return { success: false, message: "Something went wrong. Please try again." };
}

export async function sendMessageAction(
  workspaceSlug: string,
  role: Parameters<typeof requireCapability>[0],
  input: {
    workspaceId: string;
    conversationId: string;
    body: string;
    clientMessageId?: string;
  },
): Promise<InboxActionResult> {
  try {
    requireCapability(role, "send_messages");
    const parsed = sendMessageSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid message." };
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Not authenticated." };
    }

    await sendOperatorMessage(
      supabase,
      parsed.data.workspaceId,
      parsed.data.conversationId,
      parsed.data.body,
      parsed.data.clientMessageId,
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

export async function assignConversationAction(
  workspaceSlug: string,
  role: Parameters<typeof requireCapability>[0],
  input: {
    workspaceId: string;
    conversationId: string;
    assigneeMemberId: string | null;
  },
): Promise<InboxActionResult> {
  try {
    requireCapability(role, "assign_conversations");
    const parsed = assignConversationSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid assignment." };
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Not authenticated." };
    }

    await assignConversation(
      supabase,
      parsed.data.workspaceId,
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
  role: Parameters<typeof requireCapability>[0],
  input: {
    workspaceId: string;
    conversationId: string;
    status: "open" | "pending" | "resolved" | "closed";
  },
): Promise<InboxActionResult> {
  try {
    requireCapability(role, "update_conversation_status");
    const parsed = updateConversationStatusSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid status." };
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Not authenticated." };
    }

    await updateConversationStatus(
      supabase,
      parsed.data.workspaceId,
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

export async function markConversationReadAction(input: {
  workspaceId: string;
  conversationId: string;
  throughSequence?: number;
}): Promise<InboxActionResult> {
  try {
    const parsed = markConversationReadSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid read request." };
    }

    const supabase = await createClient();
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Not authenticated." };
    }

    await markConversationRead(
      supabase,
      parsed.data.workspaceId,
      parsed.data.conversationId,
      parsed.data.throughSequence,
    );

    return { success: true };
  } catch {
    return { success: false, message: "Unable to mark conversation read." };
  }
}
