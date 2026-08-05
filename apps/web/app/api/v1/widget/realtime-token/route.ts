import {
  widgetRealtimeTokenDataSchema,
  widgetRealtimeTokenRequestSchema,
} from "@site-chat/shared";

import { verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import { getClientIp } from "@/lib/widget/origin";
import {
  hashClientIp,
  hashSessionRateLimitKey,
  WIDGET_RATE_LIMITS,
} from "@/lib/widget/rate-limit";
import { createWidgetRealtimeToken } from "@/lib/widget/realtime-token";
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
  resolveWidgetRealtimeTopic,
} from "@/lib/widget/service";

function isRetriableWidgetRealtimeError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("no active conversation")) {
      return true;
    }
    if (message.includes("session invalid or expired")) {
      return true;
    }
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    const message = error.message.toLowerCase();
    return (
      message.includes("no active conversation") ||
      message.includes("session invalid or expired")
    );
  }

  return false;
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const json = (await request.json()) as unknown;
    const parsed = widgetRealtimeTokenRequestSchema.safeParse(json);

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

    const corsOrigin = embedContext.parentOrigin;
    const options = widgetOptionsResponse(request, corsOrigin);
    if (options) {
      return options;
    }

    const ipAllowed = await consumeWidgetRateLimit(
      hashClientIp(getClientIp(request)),
      WIDGET_RATE_LIMITS.realtimeToken.windowSeconds,
      WIDGET_RATE_LIMITS.realtimeToken.limit,
    );

    if (!ipAllowed) {
      return widgetJsonError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const sessionAllowed = await consumeWidgetRateLimit(
      hashSessionRateLimitKey(sessionToken),
      WIDGET_RATE_LIMITS.realtimeToken.windowSeconds,
      WIDGET_RATE_LIMITS.realtimeToken.limit,
    );

    if (!sessionAllowed) {
      return widgetJsonError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const resolved = await resolveWidgetRealtimeTopic({
      workspaceId: embedContext.workspaceId,
      sessionToken,
    });

    const token = createWidgetRealtimeToken({
      topic: resolved.topic,
      subject: resolved.subject,
    });

    return widgetJsonSuccess(
      widgetRealtimeTokenDataSchema,
      {
        token: token.token,
        topic: resolved.topic,
        expiresAt: token.expiresAt.toISOString(),
      },
      requestId,
      {
        headers: Object.fromEntries(corsHeaders(corsOrigin).entries()),
      },
    );
  } catch (error) {
    if (isSessionError(error) || isRetriableWidgetRealtimeError(error)) {
      return widgetJsonError(
        "SESSION_EXPIRED",
        GENERIC_SESSION_MESSAGE,
        401,
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
