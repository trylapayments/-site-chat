import {
  widgetPublicAppearanceSchema,
  widgetPublicKeySchema,
} from "@site-chat/shared";

import { resolveBootstrapContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import { getRequestOrigin } from "@/lib/widget/origin";
import {
  hashBootstrapRateLimitKey,
  WIDGET_RATE_LIMITS,
} from "@/lib/widget/rate-limit";
import {
  GENERIC_FORBIDDEN_MESSAGE,
  GENERIC_INTERNAL_MESSAGE,
  widgetJsonError,
  widgetJsonSuccess,
  widgetOptionsResponse,
} from "@/lib/widget/responses";
import { consumeWidgetRateLimit } from "@/lib/widget/service";
import { widgetPublicConfigEtag } from "@/lib/widget-studio/public-config";

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const origin = getRequestOrigin(request);
  const options = widgetOptionsResponse(request, origin);
  if (options) {
    return options;
  }

  try {
    const keyResult = widgetPublicKeySchema.safeParse(
      new URL(request.url).searchParams.get("key"),
    );
    if (!keyResult.success) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(origin),
      );
    }

    const context = await resolveBootstrapContext({
      widgetPublicKey: keyResult.data,
      requestOrigin: origin,
    });
    if (!context.ok) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(origin),
      );
    }

    const allowed = await consumeWidgetRateLimit(
      hashBootstrapRateLimitKey(keyResult.data),
      WIDGET_RATE_LIMITS.bootstrap.windowSeconds,
      WIDGET_RATE_LIMITS.bootstrap.limit,
    );
    if (!allowed) {
      return widgetJsonError(
        "RATE_LIMITED",
        "Too many requests",
        429,
        requestId,
        corsHeaders(origin),
      );
    }

    const config = widgetPublicAppearanceSchema.parse(context.workspace.config);
    const etag = widgetPublicConfigEtag(
      context.workspace.widgetPublicKey,
      config.version,
    );
    const responseHeaders = cacheHeaders(origin, etag);

    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: responseHeaders });
    }

    return widgetJsonSuccess(widgetPublicAppearanceSchema, config, requestId, {
      status: 200,
      headers: responseHeaders,
    });
  } catch {
    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
      corsHeaders(origin),
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

function cacheHeaders(origin: string | null, etag: string): Headers {
  const headers = corsHeaders(origin) ?? new Headers();
  headers.set("Cache-Control", CACHE_CONTROL);
  headers.set("ETag", etag);
  return headers;
}

function corsHeaders(origin: string | null): Headers | undefined {
  if (!origin) {
    return undefined;
  }
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return headers;
}
