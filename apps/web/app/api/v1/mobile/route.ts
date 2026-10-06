import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  takeConversationSchema,
  assignConversationSchema,
  updateConversationStatusSchema,
  markConversationReadSchema,
  createInternalNoteSchema,
  listInternalNotesQuerySchema,
  operatorInitiateUploadsRequestSchema,
  completeUploadsRequestSchema,
  type DashboardCapability,
} from "@site-chat/shared";
import * as inbox from "@/lib/inbox/queries";
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
  send: "send_messages",
  take: "assign_conversations",
  assign: "assign_conversations",
  status: "update_conversation_status",
  notes: "manage_internal_notes",
  note: "manage_internal_notes",
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
    if (operation === "workspaces")
      return ok(await fetchAccessibleWorkspaces(context.client));
    if (operation === "unregisterPush") {
      const p = z
        .object({ installationId: z.string().uuid() })
        .strict()
        .parse(input);
      const { error } = await mobileService()
        .from("mobile_push_devices")
        .delete()
        .eq("user_id", context.user.id)
        .eq("installation_id", p.installationId);
      if (error) throw error;
      return ok({ removed: true });
    }
    if (!workspaceId)
      throw new MobileError(400, "INVALID_INPUT", "Workspace is required.");
    const { memberId } = await authorizeMobile(
      context,
      workspaceId,
      mutationCapabilities[operation],
    );
    const client = context.client;
    switch (operation) {
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
      case "download": {
        const p = z
          .object({ attachmentId: z.string().uuid() })
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
      case "registerPush": {
        const p = z
          .object({
            token: z
              .string()
              .regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/),
            installationId: z.string().uuid(),
          })
          .strict()
          .parse(input);
        // Table is service-only and introduced by the separately reviewed mobile migration.
        const { error } = await mobileService()
          .from("mobile_push_devices")
          .upsert(
            {
              user_id: context.user.id,
              member_id: memberId,
              workspace_id: workspaceId,
              installation_id: p.installationId,
              token: p.token,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "installation_id,workspace_id" },
          );
        if (error) throw error;
        return ok({ registered: true });
      }
      default:
        throw new MobileError(400, "UNKNOWN_OPERATION", "Unknown operation.");
    }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return fail(400, "INVALID_INPUT", "Invalid request.");
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
