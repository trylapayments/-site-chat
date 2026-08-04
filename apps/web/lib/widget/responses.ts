import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import type { z } from "zod";

import {
  widgetApiErrorSchema,
  widgetApiSuccessSchema,
} from "@site-chat/shared";

import { createRequestId } from "@/lib/widget/embed-token";

export type WidgetErrorCode =
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "SESSION_EXPIRED"
  | "RATE_LIMITED"
  | "EMBED_TOKEN_INVALID"
  | "INTERNAL_ERROR";

export function widgetJsonSuccess<T extends z.ZodTypeAny>(
  dataSchema: T,
  data: z.infer<T>,
  requestId: string,
  init?: ResponseInit,
) {
  const body = widgetApiSuccessSchema(dataSchema).parse({
    data,
    meta: { requestId },
  });

  return NextResponse.json(body, init);
}

export function widgetJsonError(
  code: WidgetErrorCode,
  message: string,
  status: number,
  requestId: string = createRequestId(),
  headers?: HeadersInit,
) {
  const body = widgetApiErrorSchema.parse({
    error: {
      code,
      message,
      requestId,
    },
  });

  return NextResponse.json(body, { status, headers });
}

export function widgetOptionsResponse(
  request: Request,
  allowedOrigin: string | null,
) {
  const headers = new Headers();

  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Vary", "Origin");
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  return null;
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function newRequestId(): string {
  return randomUUID();
}

export const GENERIC_FORBIDDEN_MESSAGE = "Request not allowed";
export const GENERIC_SESSION_MESSAGE = "Session invalid or expired";
export const GENERIC_VALIDATION_MESSAGE = "Invalid request";
export const GENERIC_INTERNAL_MESSAGE = "Something went wrong";
