import {
  mobileTranslationCapabilities,
  mobileTranslate,
} from "@/lib/ai-translation/mobile";
import { TranslationServiceError } from "@/lib/ai-translation/service";
import { AIError, toPublicAIError } from "@site-chat/ai";
import {
  accountDeletionPreview,
  deleteOwnAccount,
  AccountDeletionError,
} from "@/lib/account/service";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  can,
  createCannedResponseSchema,
  listContactsQuerySchema,
  listCannedResponsesQuerySchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  takeConversationSchema,
  assignConversationSchema,
  updateConversationStatusSchema,
  markConversationReadSchema,
  createInternalNoteSchema,
  updateInternalNoteSchema,
  softDeleteInternalNoteSchema,
  listInternalNotesQuerySchema,
  operatorInitiateUploadsRequestSchema,
  completeUploadsRequestSchema,
  type DashboardCapability,
} from "@site-chat/shared";
import { visitorContactMembership } from "@/lib/crm/address-book";
import {
  fetchActiveVisitors,
  fetchAllActiveVisitors,
} from "@/lib/visitors/queries";
import { fetchContacts, fetchContactProfile } from "@/lib/crm/queries";
import { fetchChatSetup } from "@/lib/chat-setup/queries";
import { sendConversationTranscript } from "@/lib/conversation-wrapup/transcript";
import { callPublicRpc } from "@/lib/workspace/rpc";
import {
  createCannedResponse,
  fetchCannedResponses,
} from "@/lib/canned/queries";
import {
  fetchNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/notifications/queries";
import * as inbox from "@/lib/inbox/queries";
import {
  allConversations,
  workspaceInboxes,
  deleteCompany,
} from "@/lib/company/inboxes";
import { fetchAccessibleWorkspaces } from "@/lib/workspace/queries";
import { createServiceClient } from "@/lib/supabase/service";
import {
  initiateOperatorUploads,
  completeOperatorUploads,
  createAttachmentDownloadUrl,
} from "@/lib/attachments/service";
import {
  authenticateMobile,
  authorizeMobile,
  MobileError,
} from "@/lib/mobile/access";
import { mobileService } from "@/lib/mobile/push";
import { effectiveOperatorStatus } from "@/lib/operators/status";

export const runtime = "nodejs";
const envelope = z
  .object({
    operation: z.string(),
    workspaceId: z.string().uuid().optional(),
    input: z.unknown().optional(),
  })
  .strict();
const conversationInput = z
  .object({ conversationId: z.string().uuid(), query: z.unknown().optional() })
  .strict();
const mutationCapabilities: Record<string, DashboardCapability> = {
  contacts: "view_contact_profile",
  contact: "view_contact_profile",
  contactMembership: "view_contact_profile",
  saveContact: "update_visitor_profile",
  templates: "view_canned_responses",
  createTemplate: "use_canned_responses",
  startVisitorChat: "send_messages",
  visitorGreeting: "view_conversations",
  rating: "view_conversations",
  transcript: "send_messages",
  send: "send_messages",
  take: "assign_conversations",
  assign: "assign_conversations",
  status: "update_conversation_status",
  notes: "manage_internal_notes",
  note: "manage_internal_notes",
  updateNote: "manage_internal_notes",
  deleteNote: "manage_internal_notes",
  initiateUpload: "send_messages",
  completeUpload: "send_messages",
  availability: "send_messages",
  registerPush: "send_messages",
};

// Explicit operation allowlist. This is a bearer adapter, not a generic RPC proxy.
export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 65536)
      throw new MobileError(413, "TOO_LARGE", "Request is too large.");
    const context = await authenticateMobile(request);
    const { operation, workspaceId, input } = envelope.parse(
      await readBody(request),
    );
    if (operation === "accountDeletionPreview") {
      z.object({})
        .strict()
        .parse(input ?? {});
      return ok(await accountDeletionPreview(context.client));
    }
    if (operation === "deleteOwnAccount")
      return ok(await deleteOwnAccount(context.client, input));
    if (operation === "workspaces")
      return ok(await fetchAccessibleWorkspaces(context.client));
    if (operation === "allVisitors") {
      z.object({})
        .strict()
        .parse(input ?? {});
      return ok(await fetchAllActiveVisitors(context.client));
    }
    if (operation === "allConversations")
      return ok(await allConversations(context.client, input));
    if (operation === "workspaceInboxes") {
      z.object({})
        .strict()
        .parse(input ?? {});
      return ok(await workspaceInboxes(context.client));
    }
    if (operation === "deleteCompany") {
      if (!workspaceId)
        throw new MobileError(400, "INVALID_INPUT", "Choose a company.");
      return ok(await deleteCompany(context.client, workspaceId, input));
    }
    const pushEnabled = process.env.MOBILE_PUSH_ENABLED === "1";
    if (operation === "capabilities")
      return ok({
        apiVersion: 1,
        accountDeletion: true,
        push: pushEnabled,
        visitorPush:
          pushEnabled && process.env.MOBILE_VISITOR_PUSH_ENABLED === "1",
      });
    if (operation === "registerPush" || operation === "unregisterPush") {
      if (!pushEnabled)
        throw new MobileError(
          503,
          "FEATURE_UNAVAILABLE",
          "Push notifications are not available yet.",
        );
      if (operation === "unregisterPush") {
        // Revoked workspace access must never prevent an authenticated user from disabling push.
        const p = z
          .object({ installationId: z.string().uuid() })
          .strict()
          .parse(input);
        let deletion = mobileService()
          .from("mobile_push_devices")
          .delete()
          .eq("user_id", context.user.id)
          .eq("installation_id", p.installationId);
        if (workspaceId) deletion = deletion.eq("workspace_id", workspaceId);
        const { error } = await deletion;
        if (error) throw error;
        return ok({ enabled: false });
      }
    }
    if (!workspaceId)
      throw new MobileError(400, "INVALID_INPUT", "Workspace is required.");
    const { memberId, workspace: authorizedWorkspace } = await authorizeMobile(
      context,
      workspaceId,
      mutationCapabilities[operation],
    );
    const client = context.client;
    switch (operation) {
      case "translationCapabilities":
        z.object({})
          .strict()
          .parse(input ?? {});
        return ok(await mobileTranslationCapabilities(context, workspaceId));
      case "translateMessage":
      case "previewReplyTranslation":
        return ok(
          await mobileTranslate(context, workspaceId, operation, input),
        );
      case "visitors":
        return ok(await fetchActiveVisitors(client, workspaceId));
      case "contacts":
        return ok(
          await fetchContacts(
            client,
            workspaceId,
            listContactsQuerySchema.parse(input ?? {}),
          ),
        );
      case "contact": {
        const p = z.object({ id: z.string().uuid() }).strict().parse(input);
        return ok(await fetchContactProfile(client, workspaceId, p.id));
      }
      case "contactMembership":
      case "saveContact":
        return ok(
          await visitorContactMembership(
            client,
            workspaceId,
            input,
            operation === "saveContact",
          ),
        );
      case "rating": {
        const p = z
          .object({ conversationId: z.string().uuid() })
          .strict()
          .parse(input);
        const { error: scopeError } = await client
          .from("conversations")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", p.conversationId)
          .single();
        if (scopeError)
          throw new MobileError(404, "NOT_FOUND", "Conversation not found.");
        const { data, error } = await createServiceClient()
          .from("conversation_ratings")
          .select("score,comment,created_at")
          .eq("workspace_id", workspaceId)
          .eq("conversation_id", p.conversationId)
          .maybeSingle();
        if (error)
          throw new MobileError(
            503,
            "UNAVAILABLE",
            "Unable to load customer feedback.",
          );
        return ok(data);
      }
      case "visitorGreeting": {
        z.object({})
          .strict()
          .parse(input ?? {});
        const settings = await fetchChatSetup(workspaceId);
        return ok({ invitationMessage: settings.config.invitationMessage });
      }
      case "startVisitorChat": {
        const p = z
          .object({
            visitorId: z.string().uuid(),
            message: z.string().trim().min(1).max(1000),
            requestId: z.string().uuid(),
          })
          .strict()
          .parse(input);
        const { data, error } = await callPublicRpc(
          client,
          "start_visitor_chat",
          {
            p_workspace_id: workspaceId,
            p_visitor_session_id: p.visitorId,
            p_body: p.message,
            p_client_message_id: p.requestId,
          },
        );
        if (error)
          throw new MobileError(
            409,
            "VISITOR_UNAVAILABLE",
            "Unable to invite this visitor. They may have left the website.",
          );
        return ok(z.object({ conversationId: z.string().uuid() }).parse(data));
      }
      case "transcript": {
        const p = z
          .object({
            conversationId: z.string().uuid(),
            requestId: z.string().uuid(),
            email: z.string().trim().toLowerCase().email().max(254),
          })
          .strict()
          .parse(input);
        const { error } = await client
          .from("conversations")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", p.conversationId)
          .single();
        if (error)
          throw new MobileError(404, "NOT_FOUND", "Conversation not found.");
        await sendConversationTranscript({ ...p, workspaceId });
        return ok({ sent: true });
      }
      case "createTemplate": {
        const p = createCannedResponseSchema.parse(input);
        if (
          p.visibility === "workspace" &&
          !can(authorizedWorkspace.role, "manage_workspace_canned_responses")
        )
          throw new MobileError(
            403,
            "FORBIDDEN",
            "Only workspace owners and admins can create team templates.",
          );
        return ok(await createCannedResponse(client, workspaceId, p));
      }
      case "templates":
        return ok(
          await fetchCannedResponses(
            client,
            workspaceId,
            listCannedResponsesQuerySchema.parse(input ?? {}),
          ),
        );
      case "notificationPreferences": {
        const p = z
          .object({ emailConversationNew: z.boolean().optional() })
          .strict()
          .parse(input ?? {});
        return ok(
          p.emailConversationNew === undefined
            ? await fetchNotificationPreferences(client, workspaceId)
            : await updateNotificationPreferences(client, workspaceId, {
                email_conversation_new: p.emailConversationNew,
              }),
        );
      }
      case "chatBootstrap": {
        const p = z
          .object({
            conversationId: z.string().uuid(),
            limit: z.number().int().min(1).max(100).default(30),
          })
          .strict()
          .parse(input);
        const [conversation, messages] = await Promise.all([
          inbox.fetchConversation(client, workspaceId, p.conversationId),
          inbox.fetchMessages(
            client,
            workspaceId,
            p.conversationId,
            listMessagesQuerySchema.parse({ limit: p.limit }),
          ),
        ]);
        return ok({ conversation, messages });
      }
      case "pushPreferences": {
        if (process.env.MOBILE_VISITOR_PUSH_ENABLED !== "1")
          throw new MobileError(
            503,
            "FEATURE_UNAVAILABLE",
            "Push preferences are not available yet.",
          );
        const p = z
          .object({ installationId: z.string().uuid() })
          .strict()
          .parse(input);
        const { data, error } = await mobileService()
          .from("mobile_push_devices")
          .select("push_new_chat,push_new_visitor,push_messages")
          .eq("user_id", context.user.id)
          .eq("member_id", memberId)
          .eq("workspace_id", workspaceId)
          .eq("installation_id", p.installationId)
          .maybeSingle();
        if (error) throw error;
        return ok(
          data
            ? {
                pushNewChat: data.push_new_chat,
                pushNewVisitor: data.push_new_visitor,
                pushMessages: data.push_messages,
              }
            : { pushNewChat: true, pushNewVisitor: false, pushMessages: true },
        );
      }
      case "registerPush": {
        const p = z
          .object({
            soundMode: z
              .enum(["mill", "voice", "silent", "system"])
              .default("mill"),
            pushNewChat: z.boolean().optional(),
            pushNewVisitor: z.boolean().optional(),
            pushMessages: z.boolean().optional(),
            installationId: z.string().uuid(),
            token: z
              .string()
              .max(256)
              .regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/),
          })
          .strict()
          .parse(input);
        if (
          process.env.MOBILE_VISITOR_PUSH_ENABLED !== "1" &&
          (p.pushNewChat !== undefined ||
            p.pushNewVisitor !== undefined ||
            p.pushMessages !== undefined)
        )
          throw new MobileError(
            503,
            "FEATURE_UNAVAILABLE",
            "Push preferences are not available yet.",
          );
        const { error } = await mobileService().rpc("register_mobile_push", {
          p_user_id: context.user.id,
          p_member_id: memberId,
          p_workspace_id: workspaceId,
          p_installation_id: p.installationId,
          p_token: p.token,
          p_sound_mode: p.soundMode,
          ...(p.pushNewChat === undefined
            ? {}
            : { p_push_new_chat: p.pushNewChat }),
          ...(p.pushNewVisitor === undefined
            ? {}
            : { p_push_new_visitor: p.pushNewVisitor }),
          ...(p.pushMessages === undefined
            ? {}
            : { p_push_messages: p.pushMessages }),
        });
        if (error) throw error;
        return ok({ enabled: true });
      }
      case "conversations":
        return ok(
          await inbox.fetchConversations(
            client,
            workspaceId,
            listConversationsQuerySchema.parse(input ?? {}),
          ),
        );
      case "conversation": {
        const p = conversationInput.parse(input);
        return ok(
          await inbox.fetchConversation(client, workspaceId, p.conversationId),
        );
      }
      case "messages": {
        const p = conversationInput.parse(input);
        return ok(
          await inbox.fetchMessages(
            client,
            workspaceId,
            p.conversationId,
            listMessagesQuerySchema.parse(p.query ?? {}),
          ),
        );
      }
      case "send": {
        const p = sendMessageSchema
          .extend({ clientMessageId: z.string().uuid() })
          .parse(input);
        return ok(
          await inbox.sendOperatorMessage(
            client,
            workspaceId,
            p.conversationId,
            p.body,
            p.clientMessageId,
          ),
        );
      }
      case "take": {
        const p = takeConversationSchema.parse(input);
        return ok(
          await inbox.takeConversation(
            client,
            workspaceId,
            p.conversationId,
            p.expectedVersion,
          ),
        );
      }
      case "assign": {
        const p = assignConversationSchema.parse(input);
        return ok(
          p.assigneeMemberId
            ? await inbox.assignConversation(
                client,
                workspaceId,
                p.conversationId,
                p.assigneeMemberId,
                p.expectedVersion,
              )
            : await inbox.unassignConversation(
                client,
                workspaceId,
                p.conversationId,
                p.expectedVersion,
              ),
        );
      }
      case "status": {
        const p = updateConversationStatusSchema.parse(input);
        return ok(
          await inbox.updateConversationStatus(
            client,
            workspaceId,
            p.conversationId,
            p.status,
          ),
        );
      }
      case "read": {
        const p = markConversationReadSchema.parse(input);
        return ok(
          await inbox.markConversationRead(
            client,
            workspaceId,
            p.conversationId,
            p.throughSequence,
          ),
        );
      }
      case "members":
        return ok(await inbox.fetchAssignableMembers(client, workspaceId));
      case "notes": {
        const p = conversationInput.parse(input);
        return ok(
          await inbox.fetchInternalNotes(
            client,
            workspaceId,
            p.conversationId,
            listInternalNotesQuerySchema.parse(p.query ?? {}),
          ),
        );
      }
      case "note":
        return ok(
          await inbox.createInternalNote(
            client,
            workspaceId,
            createInternalNoteSchema
              .extend({ clientNoteId: z.string().uuid() })
              .parse(input),
          ),
        );
      case "updateNote":
        return ok(
          await inbox.updateInternalNote(
            client,
            workspaceId,
            updateInternalNoteSchema.parse(input),
          ),
        );
      case "deleteNote":
        return ok(
          await inbox.softDeleteInternalNote(
            client,
            workspaceId,
            softDeleteInternalNoteSchema.parse(input),
          ),
        );
      case "initiateUpload": {
        const p = operatorInitiateUploadsRequestSchema
          .extend({ clientMessageId: z.string().uuid() })
          .parse(input);
        await inbox.fetchConversation(client, workspaceId, p.conversationId);
        return ok(
          await initiateOperatorUploads({ ...p, workspaceId, memberId }),
        );
      }
      case "completeUpload": {
        const p = completeUploadsRequestSchema
          .extend({
            conversationId: z.string().uuid(),
            clientMessageId: z.string().uuid(),
          })
          .parse(input);
        await inbox.fetchConversation(client, workspaceId, p.conversationId);
        // Service upload validation must also bind intents to this authenticated member.
        const service = createServiceClient();
        const { data: uploads, error } = await service
          .from("attachment_uploads")
          .select("id,agent_member_id,conversation_id")
          .eq("workspace_id", workspaceId)
          .eq("batch_id", p.batchId)
          .in("id", p.uploadIds);
        if (
          error ||
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Do not authorize an upload if provider data is unexpectedly absent.
          !uploads ||
          uploads.length !== p.uploadIds.length ||
          uploads.some(
            (u) =>
              u.agent_member_id !== memberId ||
              u.conversation_id !== p.conversationId,
          )
        )
          throw new MobileError(403, "FORBIDDEN", "Upload access denied.");
        return ok(
          await completeOperatorUploads({
            ...p,
            workspaceId,
            authedClient: client,
          }),
        );
      }
      case "downloads": {
        const p = z
          .object({
            attachmentIds: z.array(z.string().uuid()).min(1).max(20),
            variant: z.enum(["full", "thumbnail"]).default("thumbnail"),
          })
          .strict()
          .parse(input);
        const ids = [...new Set(p.attachmentIds)];
        const { data, error } = await client
          .from("message_attachments")
          .select("id")
          .eq("workspace_id", workspaceId)
          .in("id", ids)
          .overrideTypes<{ id: string }[], { merge: false }>();
        if (error)
          throw new MobileError(503, "UNAVAILABLE", "Attachments unavailable.");
        const allowed = new Set(data.map((row) => row.id));
        const items: (
          | { attachmentId: string; url: string; expiresAt: string }
          | { attachmentId: string; error: string }
        )[] = [];
        for (let index = 0; index < ids.length; index += 4) {
          items.push(
            ...(await Promise.all(
              ids.slice(index, index + 4).map(async (attachmentId) => {
                if (!allowed.has(attachmentId))
                  return { attachmentId, error: "Unavailable" };
                try {
                  const result = await createAttachmentDownloadUrl({
                    workspaceId,
                    attachmentId,
                    variant: p.variant,
                  });
                  return {
                    attachmentId,
                    url: result.url,
                    expiresAt: result.expiresAt,
                  };
                } catch {
                  return { attachmentId, error: "Unavailable" };
                }
              }),
            )),
          );
        }
        return ok({ items });
      }
      case "download": {
        const p = z
          .object({
            attachmentId: z.string().uuid(),
            variant: z.enum(["full", "thumbnail"]).default("full"),
          })
          .strict()
          .parse(input);
        const { error } = await client
          .from("message_attachments")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", p.attachmentId)
          .single();
        if (error)
          throw new MobileError(404, "NOT_FOUND", "Attachment not found.");
        return ok(
          await createAttachmentDownloadUrl({
            workspaceId,
            attachmentId: p.attachmentId,
            variant: p.variant,
          }),
        );
      }
      case "availability": {
        const p = z
          .object({
            status: z.enum(["available", "away", "offline"]).optional(),
            active: z.boolean().optional(),
          })
          .strict()
          .parse(input ?? {});
        const service = createServiceClient();
        const { error: initError } = await service
          .from("operator_availability")
          .upsert(
            { member_id: memberId },
            { onConflict: "member_id", ignoreDuplicates: true },
          );
        if (initError) throw initError;
        const now = new Date().toISOString();
        const { data, error } = await service
          .from("operator_availability")
          .update({
            last_seen_at: now,
            ...(p.status ? { status: p.status } : {}),
            ...(p.active || p.status === "available"
              ? { last_activity_at: now }
              : {}),
          })
          .eq("member_id", memberId)
          .select("status,last_activity_at,idle_timeout_minutes")
          .single();
        if (error) throw error;
        return ok({
          status: effectiveOperatorStatus(data),
          selectedStatus: data.status,
        });
      }
      default:
        throw new MobileError(400, "UNKNOWN_OPERATION", "Unknown operation.");
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail(400, "INVALID_INPUT", "Invalid request.");
    if (error instanceof TranslationServiceError)
      return fail(error.status, error.code, error.message);
    if (error instanceof AIError) {
      const safe = toPublicAIError(error);
      return fail(safe.status, safe.code, safe.message);
    }
    if (error instanceof AccountDeletionError)
      return fail(400, "ACCOUNT_DELETION_FAILED", error.message);
    if (error instanceof MobileError)
      return fail(error.status, error.code, error.message);
    // Never echo provider/database errors or request credentials to the client.
    return fail(
      503,
      "OPERATION_FAILED",
      "Unable to complete the operation. Refresh and try again.",
    );
  }
}
function ok(data: unknown) {
  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
function fail(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

async function readBody(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 65536)
    throw new MobileError(413, "TOO_LARGE", "Request is too large.");
  return JSON.parse(text) as unknown;
}
