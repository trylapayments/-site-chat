import {
  assignmentMutationResultSchema,
  conversationDetailSchema,
  inboxUnreadTotalResultSchema,
  listConversationsQuerySchema,
  listConversationsResultSchema,
  listCustomerTimelineQuerySchema,
  listCustomerTimelineResultSchema,
  listMessagesQuerySchema,
  listMessagesResultSchema,
  markConversationDeliveredResultSchema,
  markConversationReadResultSchema,
  parseAssignmentErrorMessage,
  sendOperatorMessageResultSchema,
  visitorProfileSchema,
  workspaceMemberOptionSchema,
  type AssignmentMutationResult,
  type ConversationDetail,
  type InboxUnreadTotalResult,
  type ListConversationsQuery,
  type ListConversationsResult,
  type ListCustomerTimelineQuery,
  type ListCustomerTimelineResult,
  type ListMessagesQuery,
  type ListMessagesResult,
  type MarkConversationDeliveredResult,
  type MarkConversationReadResult,
  type SendOperatorMessageResult,
  type VisitorProfile,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import { z } from "zod";

import type { AppSupabaseClient } from "@/lib/supabase/server";
import { callPublicRpc } from "@/lib/workspace/rpc";

function parseRpcResult<T>(
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T } },
  data: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid ${label} response`);
  }
  return parsed.data as T;
}

const assignableMembersSchema = z.array(workspaceMemberOptionSchema);

export async function fetchConversations(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListConversationsQuery,
): Promise<ListConversationsResult> {
  const validated = listConversationsQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(supabase, "list_conversations", {
    p_workspace_id: workspaceId,
    p_query: validated,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(
    listConversationsResultSchema,
    data,
    "list_conversations",
  );
}

export async function fetchConversation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const { data, error } = await callPublicRpc(supabase, "get_conversation", {
    p_workspace_id: workspaceId,
    p_conversation_id: conversationId,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(conversationDetailSchema, data, "get_conversation");
}

export async function fetchMessages(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  query: ListMessagesQuery = {},
): Promise<ListMessagesResult> {
  const validated = listMessagesQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(supabase, "list_messages", {
    p_workspace_id: workspaceId,
    p_conversation_id: conversationId,
    p_query: validated,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(listMessagesResultSchema, data, "list_messages");
}

export async function sendOperatorMessage(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  body: string,
  clientMessageId?: string,
): Promise<SendOperatorMessageResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "send_operator_message",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_body: body,
      p_client_message_id: clientMessageId,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    sendOperatorMessageResultSchema,
    data,
    "send_operator_message",
  );
}

function throwAssignmentRpcError(error: unknown): never {
  let message: string | null = null;
  if (error instanceof Error) {
    message = error.message;
  } else if (error && typeof error === "object" && "message" in error) {
    const candidate = Reflect.get(error, "message");
    if (typeof candidate === "string") {
      message = candidate;
    }
  }
  const typed = parseAssignmentErrorMessage(message);
  if (typed) {
    throw typed;
  }
  throw error instanceof Error ? error : new Error("Assignment failed");
}

export async function takeConversation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  expectedVersion?: number,
): Promise<AssignmentMutationResult> {
  const { data, error } = await callPublicRpc(supabase, "take_conversation", {
    p_workspace_id: workspaceId,
    p_conversation_id: conversationId,
    ...(expectedVersion !== undefined
      ? { p_expected_version: expectedVersion }
      : {}),
  });

  if (error) {
    throwAssignmentRpcError(error);
  }

  return parseRpcResult(
    assignmentMutationResultSchema,
    data,
    "take_conversation",
  );
}

export async function assignConversation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  assigneeMemberId: string,
  expectedVersion?: number,
): Promise<AssignmentMutationResult> {
  const { data, error } = await callPublicRpc(supabase, "assign_conversation", {
    p_workspace_id: workspaceId,
    p_conversation_id: conversationId,
    p_assignee_member_id: assigneeMemberId,
    ...(expectedVersion !== undefined
      ? { p_expected_version: expectedVersion }
      : {}),
  });

  if (error) {
    throwAssignmentRpcError(error);
  }

  return parseRpcResult(
    assignmentMutationResultSchema,
    data,
    "assign_conversation",
  );
}

export async function unassignConversation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  expectedVersion?: number,
): Promise<AssignmentMutationResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "unassign_conversation",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      ...(expectedVersion !== undefined
        ? { p_expected_version: expectedVersion }
        : {}),
    },
  );

  if (error) {
    throwAssignmentRpcError(error);
  }

  return parseRpcResult(
    assignmentMutationResultSchema,
    data,
    "unassign_conversation",
  );
}

export async function updateConversationStatus(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  status: ConversationDetail["status"],
): Promise<ConversationDetail> {
  const { data, error } = await callPublicRpc(
    supabase,
    "update_conversation_status",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_status: status,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    conversationDetailSchema,
    data,
    "update_conversation_status",
  );
}

export async function markConversationRead(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  throughSequence?: number,
): Promise<MarkConversationReadResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "mark_conversation_read",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_through_sequence: throughSequence,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    markConversationReadResultSchema,
    data,
    "mark_conversation_read",
  );
}

export async function markConversationDelivered(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  throughSequence: number,
): Promise<MarkConversationDeliveredResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "mark_conversation_delivered",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_through_sequence: throughSequence,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    markConversationDeliveredResultSchema,
    data,
    "mark_conversation_delivered",
  );
}

export async function fetchInboxUnreadTotal(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<InboxUnreadTotalResult> {
  const { data, error } = await callPublicRpc(
    supabase,
    "get_inbox_unread_total",
    {
      p_workspace_id: workspaceId,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    inboxUnreadTotalResultSchema,
    data,
    "get_inbox_unread_total",
  );
}

export async function fetchAssignableMembers(
  supabase: AppSupabaseClient,
  workspaceId: string,
): Promise<WorkspaceMemberOption[]> {
  const { data, error } = await callPublicRpc(
    supabase,
    "list_assignable_members",
    {
      p_workspace_id: workspaceId,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    assignableMembersSchema,
    data,
    "list_assignable_members",
  );
}

export async function updateVisitorProfile(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  patch: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    phone_e164?: string | null;
  },
): Promise<VisitorProfile> {
  const { data, error } = await callPublicRpc(
    supabase,
    "update_visitor_profile",
    {
      p_workspace_id: workspaceId,
      p_conversation_id: conversationId,
      p_patch: patch,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(visitorProfileSchema, data, "update_visitor_profile");
}

export async function fetchCustomerTimeline(
  supabase: AppSupabaseClient,
  workspaceId: string,
  query: ListCustomerTimelineQuery,
): Promise<ListCustomerTimelineResult> {
  const validated = listCustomerTimelineQuerySchema.parse(query);
  const { data, error } = await callPublicRpc(
    supabase,
    "list_customer_timeline",
    {
      p_workspace_id: workspaceId,
      p_query: validated,
    },
  );

  if (error) {
    throw error;
  }

  return parseRpcResult(
    listCustomerTimelineResultSchema,
    data,
    "list_customer_timeline",
  );
}
