"use server";

import {
  assignConversationSchema,
  cancelUploadsRequestSchema,
  completeUploadsRequestSchema,
  initiateUploadsDataSchema,
  operatorInitiateUploadsRequestSchema,
  sendOperatorMessageResultSchema,
  markConversationDeliveredSchema,
  markConversationReadSchema,
  sendMessageSchema,
  updateConversationStatusSchema,
  type InitiateUploadsData,
  type MarkConversationDeliveredResult,
  type MarkConversationReadResult,
  type ReceiptCursors,
  type SendOperatorMessageResult,
} from "@site-chat/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  AttachmentValidationError,
  cancelUploads,
  completeOperatorUploads,
  initiateOperatorUploads,
} from "@/lib/attachments/service";
import { workspaceNavPath } from "@/lib/dashboard/routes";
import { requireInboxWorkspace } from "@/lib/inbox/guards";
import {
  assignConversation,
  fetchConversation,
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

const conversationIdSchema = z.object({
  conversationId: z.string().uuid(),
});

export type AttachmentActionResult =
  | {
      success: true;
      data:
        InitiateUploadsData | SendOperatorMessageResult | { cancelled: number };
    }
  | { success: false; message: string };

function attachmentActionError(error: unknown): AttachmentActionResult {
  if (error instanceof CapabilityError) {
    return { success: false, message: error.message };
  }

  let rawMessage: string | null = null;
  if (error instanceof Error) {
    rawMessage = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    const candidate = Reflect.get(error, "message");
    if (typeof candidate === "string") {
      rawMessage = candidate;
    }
  }

  if (rawMessage) {
    // Surface actionable storage/RPC/Zod failures in UI/E2E without leaking secrets.
    // Do not treat "foreign key" / schema paths containing "token" as secrets.
    const safe = rawMessage.replace(/\s+/g, " ").trim().slice(0, 180);
    if (
      !/password|secret|service[_ -]?role|api[_ -]?key|bearer\s+[a-z0-9._-]+/i.test(
        safe,
      )
    ) {
      return { success: false, message: safe };
    }
  }
  return { success: false, message: "Something went wrong. Please try again." };
}

async function resolveMemberId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

export async function initiateOperatorUploadsAction(
  workspaceSlug: string,
  input: z.infer<typeof operatorInitiateUploadsRequestSchema>,
): Promise<AttachmentActionResult> {
  try {
    const parsed = operatorInitiateUploadsRequestSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid upload request." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "send_messages");
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Unauthorized." };
    }

    const memberId = await resolveMemberId(
      supabase,
      workspace.workspace_id,
      user.id,
    );
    if (!memberId) {
      return { success: false, message: "Unauthorized." };
    }

    const result = await initiateOperatorUploads({
      workspaceId: workspace.workspace_id,
      conversationId: parsed.data.conversationId,
      memberId,
      files: parsed.data.files,
      body: parsed.data.body,
      clientMessageId: parsed.data.clientMessageId,
    });

    const validated = initiateUploadsDataSchema.safeParse(result);
    if (!validated.success) {
      return {
        success: false,
        message: "Upload initiate response was invalid.",
      };
    }
    return { success: true, data: validated.data };
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return { success: false, message: error.message };
    }
    return attachmentActionError(error);
  }
}

export async function completeOperatorUploadsAction(
  workspaceSlug: string,
  input: {
    conversationId: string;
    batchId: string;
    uploadIds: string[];
    body?: string;
    clientMessageId?: string;
  },
): Promise<AttachmentActionResult> {
  try {
    const parsed = completeUploadsRequestSchema
      .omit({ embedToken: true })
      .extend({ conversationId: z.string().uuid() })
      .safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid complete request." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "send_messages");

    const data = await completeOperatorUploads({
      workspaceId: workspace.workspace_id,
      conversationId: parsed.data.conversationId,
      batchId: parsed.data.batchId,
      uploadIds: parsed.data.uploadIds,
      body: parsed.data.body,
      clientMessageId: parsed.data.clientMessageId,
      authedClient: supabase,
    });

    const result = sendOperatorMessageResultSchema.parse(data);
    revalidatePath(workspaceNavPath(workspaceSlug, "inbox"));
    revalidatePath(
      `${workspaceNavPath(workspaceSlug, "inbox")}/${parsed.data.conversationId}`,
    );
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return { success: false, message: error.message };
    }
    return attachmentActionError(error);
  }
}

export async function cancelOperatorUploadsAction(
  workspaceSlug: string,
  input: { batchId: string; uploadIds?: string[] },
): Promise<AttachmentActionResult> {
  try {
    const parsed = cancelUploadsRequestSchema
      .omit({ embedToken: true })
      .safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid cancel request." };
    }

    const { workspace, supabase } =
      await requireInboxMutationContext(workspaceSlug);
    requireCapability(workspace.role, "send_messages");
    const { user } = await requireUser(supabase);
    if (!user) {
      return { success: false, message: "Unauthorized." };
    }

    const memberId = await resolveMemberId(
      supabase,
      workspace.workspace_id,
      user.id,
    );
    if (!memberId) {
      return { success: false, message: "Unauthorized." };
    }

    const cancelled = await cancelUploads({
      workspaceId: workspace.workspace_id,
      batchId: parsed.data.batchId,
      uploadIds: parsed.data.uploadIds,
      memberId,
    });

    return { success: true, data: { cancelled } };
  } catch (error) {
    return attachmentActionError(error);
  }
}

/**
 * One-shot catch-up of peer (visitor) receipt cursors after ephemeral
 * (re)subscribe. Not a poll — called only on Realtime SUBSCRIBED.
 */
export async function fetchVisitorReceiptCursorsAction(
  workspaceSlug: string,
  input: { conversationId: string },
): Promise<
  { success: true; data: ReceiptCursors } | { success: false; message: string }
> {
  try {
    const parsed = conversationIdSchema.safeParse(input);
    if (!parsed.success) {
      return { success: false, message: "Invalid conversation." };
    }

    const { workspace } = await requireInboxWorkspace(workspaceSlug);
    const supabase = await createClient();
    const conversation = await fetchConversation(
      supabase,
      workspace.workspace_id,
      parsed.data.conversationId,
    );

    return {
      success: true,
      data: {
        lastDeliveredSequence: conversation.visitor_last_delivered_sequence,
        lastReadSequence: conversation.visitor_last_read_sequence,
      },
    };
  } catch {
    return {
      success: false,
      message: "Unable to load receipt cursors.",
    };
  }
}
