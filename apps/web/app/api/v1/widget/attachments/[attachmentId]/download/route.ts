import { attachmentDownloadDataSchema } from "@site-chat/shared";

import {
  createAttachmentDownloadUrl,
  resolveVisitorSessionId,
} from "@/lib/attachments/service";
import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import { createRequestId } from "@/lib/widget/embed-token";
import {
  GENERIC_FORBIDDEN_MESSAGE,
  GENERIC_INTERNAL_MESSAGE,
  GENERIC_SESSION_MESSAGE,
  getBearerToken,
  widgetJsonError,
  widgetJsonSuccess,
  widgetOptionsResponse,
} from "@/lib/widget/responses";
import { createServiceClient } from "@/lib/supabase/service";

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

export async function OPTIONS(request: Request) {
  const embedToken = getEmbedTokenFromRequest(request);
  let corsOrigin: string | null = null;
  if (embedToken) {
    const ctx = await verifyEmbedContext(embedToken);
    if (ctx) {
      corsOrigin = corsOriginFromEmbed(ctx.parentOrigin);
    }
  }
  return (
    widgetOptionsResponse(request, corsOrigin) ??
    new Response(null, { status: 204 })
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const requestId = createRequestId();
  const { attachmentId } = await context.params;

  try {
    const embedToken = getEmbedTokenFromRequest(request);
    if (!embedToken) {
      return widgetJsonError(
        "EMBED_TOKEN_INVALID",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
      );
    }

    const embedContext = await verifyEmbedContext(embedToken);
    if (!embedContext) {
      return widgetJsonError(
        "EMBED_TOKEN_INVALID",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
      );
    }

    const corsOrigin = corsOriginFromEmbed(embedContext.parentOrigin);
    const sessionToken = getBearerToken(request);
    if (!sessionToken) {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    // Ensure the attachment belongs to a conversation visible to this visitor.
    // Resolve session via the same SECURITY DEFINER path as messaging/uploads.
    let visitorSessionId: string;
    try {
      visitorSessionId = await resolveVisitorSessionId(
        embedContext.workspaceId,
        sessionToken,
      );
    } catch {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const supabase = createServiceClient();
    const { data: attachment } = await supabase
      .from("message_attachments")
      .select("id, conversation_id")
      .eq("workspace_id", embedContext.workspaceId)
      .eq("id", attachmentId)
      .maybeSingle();

    if (!attachment) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("workspace_id", embedContext.workspaceId)
      .eq("id", attachment.conversation_id)
      .eq("visitor_session_id", visitorSessionId)
      .maybeSingle();

    if (!conversation) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const url = new URL(request.url);
    const variant =
      url.searchParams.get("variant") === "thumbnail" ? "thumbnail" : "full";

    const download = await createAttachmentDownloadUrl({
      workspaceId: embedContext.workspaceId,
      attachmentId,
      variant,
    });

    return widgetJsonSuccess(
      attachmentDownloadDataSchema,
      download,
      requestId,
      {
        headers: Object.fromEntries(corsHeaders(corsOrigin).entries()),
      },
    );
  } catch (error) {
    console.error("widget attachment download failed", { requestId, error });
    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}
