import {
  initiateUploadsDataSchema,
  widgetInitiateUploadsRequestSchema,
} from "@site-chat/shared";

import {
  AttachmentValidationError,
  initiateVisitorUploads,
} from "@/lib/attachments/service";
import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import { createRequestId } from "@/lib/widget/embed-token";
import { getClientIp } from "@/lib/widget/origin";
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

export async function OPTIONS(request: Request) {
  const embedToken = getEmbedTokenFromRequest(request);
  let corsOrigin: string | null = null;
  if (embedToken) {
    const embedContext = await verifyEmbedContext(embedToken);
    if (embedContext) {
      corsOrigin = corsOriginFromEmbed(embedContext.parentOrigin);
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
    const body = (await request.json().catch(() => null)) as unknown;
    const embedToken =
      getEmbedTokenFromRequest(request) ??
      (body && typeof body === "object" && !Array.isArray(body)
        ? (body as { embedToken?: string }).embedToken
        : undefined);

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
    const options = widgetOptionsResponse(request, corsOrigin);
    if (options) {
      return options;
    }

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

    const parsed = widgetInitiateUploadsRequestSchema.safeParse(body);
    if (!parsed.success) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const result = await initiateVisitorUploads({
      workspaceId: embedContext.workspaceId,
      sessionToken,
      files: parsed.data.files,
      body: parsed.data.body,
      clientMessageId: parsed.data.clientMessageId,
      pageUrl: parsed.data.pageUrl,
      referrer: parsed.data.referrer,
    });

    return widgetJsonSuccess(initiateUploadsDataSchema, result, requestId, {
      headers: Object.fromEntries(corsHeaders(corsOrigin).entries()),
    });
  } catch (error) {
    if (error instanceof AttachmentValidationError) {
      return widgetJsonError("VALIDATION_ERROR", error.message, 400, requestId);
    }

    if (error instanceof Error && error.message === "SESSION_EXPIRED") {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
        requestId,
      );
    }

    console.error("widget attachments initiate failed", {
      requestId,
      error,
      ip: getClientIp(request),
    });
    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}
