import {
  conversationDetailSchema,
  listConversationsQuerySchema,
  listConversationsResultSchema,
  listMessagesQuerySchema,
  listMessagesResultSchema,
  markConversationReadResultSchema,
  sendOperatorMessageResultSchema,
  workspaceMemberOptionSchema,
  type ConversationDetail,
  type ListConversationsQuery,
  type ListConversationsResult,
  type ListMessagesQuery,
  type ListMessagesResult,
  type MarkConversationReadResult,
  type SendOperatorMessageResult,
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

export async function assignConversation(
  supabase: AppSupabaseClient,
  workspaceId: string,
  conversationId: string,
  assigneeMemberId: string | null,
): Promise<ConversationDetail> {
  const { data, error } = await callPublicRpc(supabase, "assign_conversation", {
    p_workspace_id: workspaceId,
    p_conversation_id: conversationId,
    p_assignee_member_id: assigneeMemberId as unknown as string,
  });

  if (error) {
    throw error;
  }

  return parseRpcResult(conversationDetailSchema, data, "assign_conversation");
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
