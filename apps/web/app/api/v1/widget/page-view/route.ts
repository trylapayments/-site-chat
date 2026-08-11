import {
  parseUtmFromUrl,
  sanitizePageTitle,
  sanitizePageUrl,
  sanitizeReferrer,
  visitorPageViewDataSchema,
  visitorPageViewRequestSchema,
} from "@site-chat/shared";

import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import {
  getRequestOrigin,
  requestOriginMatchesEmbed,
} from "@/lib/widget/origin";
import {
  hashPageViewRateLimitKey,
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
import { consumeWidgetRateLimit, recordPageView } from "@/lib/widget/service";

function requireJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  try {
    if (!requireJsonContentType(request)) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
      );
    }

    const json = (await request.json()) as unknown;
    const parsed = visitorPageViewRequestSchema.safeParse(json);

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

    if (!requestOriginMatchesEmbed(request, embedContext.parentOrigin)) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
      );
    }

    const allowed = await consumeWidgetRateLimit(
      hashPageViewRateLimitKey(sessionToken),
      WIDGET_RATE_LIMITS.pageView.windowSeconds,
      WIDGET_RATE_LIMITS.pageView.limit,
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

    const url = sanitizePageUrl(parsed.data.url);
    if (!url) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const title =
      parsed.data.title !== undefined
        ? sanitizePageTitle(parsed.data.title)
        : null;
    const referrer =
      parsed.data.referrer !== undefined
        ? sanitizeReferrer(parsed.data.referrer)
        : null;
    const utm = parseUtmFromUrl(url);

    const result = await recordPageView({
      workspaceId: embedContext.workspaceId,
      sessionToken,
      url,
      title,
      referrer,
      utmSource: utm.utmSource,
      utmMedium: utm.utmMedium,
      utmCampaign: utm.utmCampaign,
      utmContent: utm.utmContent,
      utmTerm: utm.utmTerm,
      tabId: parsed.data.tabId,
    });

    return widgetJsonSuccess(visitorPageViewDataSchema, result, requestId, {
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
