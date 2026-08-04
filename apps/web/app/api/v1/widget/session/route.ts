import {
  widgetSessionDataSchema,
  widgetSessionRequestSchema,
} from "@site-chat/shared";

import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import {
  hashClientIp,
  hashSessionRateLimitKey,
  WIDGET_RATE_LIMITS,
} from "@/lib/widget/rate-limit";
import { getClientIp, getRequestOrigin } from "@/lib/widget/origin";
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
  createOrResumeVisitorSession,
} from "@/lib/widget/service";

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    const json = (await request.json()) as unknown;
    const parsed = widgetSessionRequestSchema.safeParse(json);

    if (!parsed.success) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
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

    const ipBucket = hashClientIp(getClientIp(request));
    const ipAllowed = await consumeWidgetRateLimit(
      ipBucket,
      WIDGET_RATE_LIMITS.session.windowSeconds,
      WIDGET_RATE_LIMITS.session.limit,
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

    const resumeToken = getBearerToken(request);
    if (resumeToken) {
      const sessionAllowed = await consumeWidgetRateLimit(
        hashSessionRateLimitKey(resumeToken),
        WIDGET_RATE_LIMITS.session.windowSeconds,
        WIDGET_RATE_LIMITS.session.limit,
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
    }

    const session = await createOrResumeVisitorSession({
      workspaceId: embedContext.workspaceId,
      sessionToken: resumeToken,
      locale: parsed.data.locale,
      pageUrl: parsed.data.pageUrl,
      referrer: parsed.data.referrer,
    });

    return widgetJsonSuccess(widgetSessionDataSchema, session, requestId, {
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

    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}

export function OPTIONS(request: Request) {
  const origin = getRequestOrigin(request);
  return (
    widgetOptionsResponse(request, origin) ??
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
    (error.message.includes("Session invalid or expired") ||
      error.message.includes("invalid or expired"))
  );
}
