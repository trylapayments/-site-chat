import {
  normalizeVisitorAttributes,
  normalizeVisitorEmail,
  normalizeVisitorName,
  normalizeVisitorPhone,
  visitorIdentifyDataSchema,
  visitorIdentifyRequestSchema,
  VisitorIdentityError,
} from "@site-chat/shared";

import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import { getRequestOrigin } from "@/lib/widget/origin";
import {
  hashIdentifyRateLimitKey,
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
import { consumeWidgetRateLimit, identifyVisitor } from "@/lib/widget/service";

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
    const parsed = visitorIdentifyRequestSchema.safeParse(json);

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
      hashIdentifyRateLimitKey(sessionToken),
      WIDGET_RATE_LIMITS.identify.windowSeconds,
      WIDGET_RATE_LIMITS.identify.limit,
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

    let name: string | null | undefined;
    let email: string | null | undefined;
    let phone: string | null | undefined;
    let phoneE164: string | null | undefined;
    let attributes:
      Record<string, string | number | boolean | null> | undefined;

    try {
      if (parsed.data.name !== undefined) {
        name = normalizeVisitorName(parsed.data.name);
      }
      if (parsed.data.email !== undefined) {
        email = normalizeVisitorEmail(parsed.data.email);
      }
      if (parsed.data.phone !== undefined) {
        const normalizedPhone = normalizeVisitorPhone(parsed.data.phone);
        phone = normalizedPhone.display;
        phoneE164 = normalizedPhone.normalized;
      }
      if (parsed.data.attributes !== undefined) {
        attributes = normalizeVisitorAttributes(parsed.data.attributes);
      }
    } catch (error) {
      if (error instanceof VisitorIdentityError) {
        return widgetJsonError(
          "VALIDATION_ERROR",
          GENERIC_VALIDATION_MESSAGE,
          400,
          requestId,
          corsHeaders(corsOrigin),
        );
      }
      throw error;
    }

    if (
      name === undefined &&
      email === undefined &&
      phone === undefined &&
      attributes === undefined
    ) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_VALIDATION_MESSAGE,
        400,
        requestId,
        corsHeaders(corsOrigin),
      );
    }

    const result = await identifyVisitor({
      workspaceId: embedContext.workspaceId,
      sessionToken,
      name,
      email,
      phone,
      phoneE164,
      attributes,
    });

    return widgetJsonSuccess(visitorIdentifyDataSchema, result, requestId, {
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
      error.message.includes("Email already belongs to another visitor")
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
