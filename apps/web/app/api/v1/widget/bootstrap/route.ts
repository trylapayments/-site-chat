import {
  widgetBootstrapDataSchema,
  widgetPublicKeySchema,
} from "@site-chat/shared";

import { issueEmbedToken, resolveBootstrapContext } from "@/lib/widget/context";
import { createRequestId } from "@/lib/widget/embed-token";
import { getClientIp, getRequestOrigin } from "@/lib/widget/origin";
import { hashClientIp, WIDGET_RATE_LIMITS } from "@/lib/widget/rate-limit";
import {
  GENERIC_FORBIDDEN_MESSAGE,
  GENERIC_INTERNAL_MESSAGE,
  widgetJsonError,
  widgetJsonSuccess,
  widgetOptionsResponse,
} from "@/lib/widget/responses";
import { consumeWidgetRateLimit } from "@/lib/widget/service";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const origin = getRequestOrigin(request);
  const options = widgetOptionsResponse(request, origin);
  if (options) {
    return options;
  }

  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    const keyResult = widgetPublicKeySchema.safeParse(keyParam);

    if (!keyResult.success) {
      return widgetJsonError(
        "VALIDATION_ERROR",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(origin),
      );
    }

    const bootstrapContext = await resolveBootstrapContext({
      widgetPublicKey: keyResult.data,
      requestOrigin: origin,
    });

    if (!bootstrapContext.ok) {
      return widgetJsonError(
        "FORBIDDEN",
        GENERIC_FORBIDDEN_MESSAGE,
        403,
        requestId,
        corsHeaders(origin),
      );
    }

    const ipBucket = hashClientIp(getClientIp(request));
    const allowed = await consumeWidgetRateLimit(
      ipBucket,
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

    const { token, expiresAt } = issueEmbedToken(
      bootstrapContext.workspace,
      bootstrapContext.parentOrigin,
    );

    return widgetJsonSuccess(
      widgetBootstrapDataSchema,
      {
        widgetPublicKey: bootstrapContext.workspace.widgetPublicKey,
        config: bootstrapContext.workspace.config,
        embedToken: token,
        embedTokenExpiresAt: expiresAt.toISOString(),
      },
      requestId,
      {
        status: 200,
        headers: {
          ...Object.fromEntries(corsHeaders(origin)?.entries() ?? []),
          "Cache-Control": "no-store",
        },
      },
    );
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

function corsHeaders(origin: string | null): Headers | undefined {
  if (!origin) {
    return undefined;
  }

  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  return headers;
}
