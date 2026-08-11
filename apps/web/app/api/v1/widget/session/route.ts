import {
  buildPageContext,
  parseUserAgent,
  widgetSessionDataSchema,
  widgetSessionRequestSchema,
} from "@site-chat/shared";

import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import {
  hashSessionIpRateLimitKey,
  hashSessionRateLimitKey,
  WIDGET_RATE_LIMITS,
} from "@/lib/widget/rate-limit";
import {
  getClientIp,
  getRequestOrigin,
  requestOriginMatchesEmbed,
} from "@/lib/widget/origin";
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

    if (!requestOriginMatchesEmbed(request, embedContext.parentOrigin)) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
      );
    }

    const ipAllowed = await consumeWidgetRateLimit(
      hashSessionIpRateLimitKey(getClientIp(request)),
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

    const pageContext = buildPageContext({
      url: parsed.data.pageUrl,
      title: parsed.data.pageTitle,
      referrer: parsed.data.referrer,
      landingUrl: parsed.data.pageUrl,
    });
    const ua = parseUserAgent(request.headers.get("user-agent"));

    const session = await createOrResumeVisitorSession({
      workspaceId: embedContext.workspaceId,
      sessionToken: resumeToken,
      locale: parsed.data.locale,
      pageUrl: pageContext.url,
      referrer: pageContext.referrer,
      continuityToken: parsed.data.continuityToken,
      pageTitle: pageContext.title,
      timezone: parsed.data.timezone,
      language: parsed.data.language,
      browserFamily: ua.browserFamily,
      browserVersion: ua.browserVersion,
      osFamily: ua.osFamily,
      deviceType: ua.deviceType,
      landingUrl: pageContext.landingUrl,
      utmSource: pageContext.utmSource,
      utmMedium: pageContext.utmMedium,
      utmCampaign: pageContext.utmCampaign,
      utmContent: pageContext.utmContent,
      utmTerm: pageContext.utmTerm,
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
