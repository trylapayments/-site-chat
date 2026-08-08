import { cancelUploadsRequestSchema } from "@site-chat/shared";
import { z } from "zod";

import { cancelUploads } from "@/lib/attachments/service";
import { corsOriginFromEmbed, verifyEmbedContext } from "@/lib/widget/context";
import { getEmbedTokenFromRequest } from "@/lib/widget/constants";
import { createRequestId } from "@/lib/widget/embed-token";
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

const cancelDataSchema = z
  .object({
    cancelled: z.number().int().nonnegative(),
  })
  .strict();

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
    const parsed = cancelUploadsRequestSchema.safeParse(raw);
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

    const cancelled = await cancelUploads({
      workspaceId: embedContext.workspaceId,
      batchId: parsed.data.batchId,
      uploadIds: parsed.data.uploadIds,
      sessionToken,
    });

    return widgetJsonSuccess(cancelDataSchema, { cancelled }, requestId, {
      headers: Object.fromEntries(corsHeaders(corsOrigin).entries()),
    });
  } catch (error) {
    console.error("widget attachments cancel failed", { requestId, error });
    return widgetJsonError(
      "INTERNAL_ERROR",
      GENERIC_INTERNAL_MESSAGE,
      500,
      requestId,
    );
  }
}
