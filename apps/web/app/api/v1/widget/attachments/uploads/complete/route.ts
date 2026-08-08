import {
  completeUploadsRequestSchema,
  widgetSendMessageDataSchema,
} from "@site-chat/shared";

import {
  AttachmentValidationError,
  completeVisitorUploads,
} from "@/lib/attachments/service";
import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import { createRequestId } from "@/lib/widget/embed-token";
import {
  hashSessionRateLimitKey,
  WIDGET_RATE_LIMITS,
} from "@/lib/widget/rate-limit";
import {
  GENERIC_FORBIDDEN_MESSAGE,
  GENERIC_INTERNAL_MESSAGE,
  GENERIC_SESSION_MESSAGE,
  GENERIC_VALIDATION_MESSAGE,
  getBearerToken,
  widgetJsonError,
  widgetJsonSuccess,
  widgetOptionsResponse,
} from "@/lib/widget/responses";
import { consumeWidgetRateLimit } from "@/lib/widget/service";

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers();
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function mapCompleteResponse(data: unknown) {
  return widgetSendMessageDataSchema.parse(
    (() => {
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Invalid complete response");
      }
      const record = data as Record<string, unknown>;
      const message = record.message as Record<string, unknown>;
      return {
        message: {
          id: message.id,
          sequence_number: message.sequence_number,
          sender_type: message.sender_type,
          body: message.body,
          created_at: message.created_at,
          client_message_id: message.client_message_id ?? null,
          attachments: message.attachments ?? [],
        },
        conversationStatus: record.conversation_status,
      };
    })(),
  );
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

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const raw = (await request.json().catch(() => null)) as unknown;
    const parsed = completeUploadsRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
      );
    }

    const embedToken =
      getEmbedTokenFromRequest(request) ?? parsed.data.embedToken ?? null;
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

    const allowed = await consumeWidgetRateLimit(
      hashSessionRateLimitKey(sessionToken),
      WIDGET_RATE_LIMITS.attachments.windowSeconds,
      WIDGET_RATE_LIMITS.attachments.limit,
    );

    if (!allowed) {
      return widgetJsonError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const data = await completeVisitorUploads({
      workspaceId: embedContext.workspaceId,
      sessionToken,
      batchId: parsed.data.batchId,
      uploadIds: parsed.data.uploadIds,
      body: parsed.data.body,
      clientMessageId: parsed.data.clientMessageId,
      pageUrl: parsed.data.pageUrl,
      referrer: parsed.data.referrer,
    });

    return widgetJsonSuccess(
      widgetSendMessageDataSchema,
      mapCompleteResponse(data),
      requestId,
      { headers: Object.fromEntries(corsHeaders(corsOrigin).entries()) },
    );
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return widgetJsonError("VALIDATION_ERROR", error.message, 400, requestId);
    }

    console.error("widget attachments complete failed", { requestId, error });
    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}
