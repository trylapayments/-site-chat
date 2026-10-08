import {
  widgetMarkReceiptDataSchema,
  widgetMarkReceiptRequestSchema,
} from "@site-chat/shared";

import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
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
import {
  consumeWidgetRateLimit,
  markVisitorConversationReceipt,
} from "@/lib/widget/service";

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const json = (await request.json()) as unknown;
    const parsed = widgetMarkReceiptRequestSchema.safeParse(json);

    if (!parsed.success) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
      );
    }

    const sessionToken = getBearerToken(request);
    if (!sessionToken) {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
        requestId,
      );
    }

    const embedContext = await verifyEmbedContext(parsed.data.embedToken);
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

    const allowed = await consumeWidgetRateLimit(
      hashSessionRateLimitKey(`receipt:${sessionToken}`),
      WIDGET_RATE_LIMITS.receipts.windowSeconds,
      WIDGET_RATE_LIMITS.receipts.limit,
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

    // getClientIp kept for future IP+session composite limits / audit.
    void getClientIp(request);

    const result = await markVisitorConversationReceipt({
      workspaceId: embedContext.workspaceId,
      sessionToken,
      kind: parsed.data.kind,
      throughSequence: parsed.data.throughSequence,
    });

    return widgetJsonSuccess(widgetMarkReceiptDataSchema, result, requestId, {
      headers: Object.fromEntries(corsHeaders(corsOrigin).entries()),
    });
  } catch (error) {
    if (isSessionError(error)) {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
        requestId,
      );
    }

    if (
      error instanceof Error &&
      error.message.includes("Conversation not found")
    ) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
      );
    }

    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}

export function OPTIONS(request: Request) {
  return (
    widgetOptionsResponse(request, request.headers.get("origin")) ??
    new Response(null, { status: 204 })
  );
}

function corsHeaders(origin: string): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return headers;
}

function isSessionError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Session invalid or expired")
  );
}
