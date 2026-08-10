import { toPublicAIError, type AIErrorCode } from "@site-chat/ai";
import { AI_SSE_BOUNDS } from "@site-chat/shared";
import { NextResponse } from "next/server";

export function aiJsonError(error: unknown): NextResponse {
  const publicError = toPublicAIError(error);
  return NextResponse.json(
    {
      error: {
        code: publicError.code,
        message: publicError.message.slice(0, AI_SSE_BOUNDS.messageMaxChars),
        retryable: publicError.retryable,
      },
    },
    {
      status: publicError.status,
      headers:
        publicError.code === "AI_RATE_LIMITED"
          ? { "Retry-After": "60" }
          : undefined,
    },
  );
}

function boundText(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

export function encodeSseEvent(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "type" in payload) {
    const event = payload as {
      type: string;
      text?: string;
      suggestion?: string;
      message?: string;
    };

    if (event.type === "delta" && typeof event.text === "string") {
      return `data: ${JSON.stringify({
        ...event,
        text: boundText(event.text, AI_SSE_BOUNDS.deltaMaxChars),
      })}\n\n`;
    }

    if (event.type === "error" && typeof event.message === "string") {
      return `data: ${JSON.stringify({
        ...event,
        message: boundText(event.message, AI_SSE_BOUNDS.messageMaxChars),
      })}\n\n`;
    }

    if (event.type === "done" && typeof event.suggestion === "string") {
      return `data: ${JSON.stringify({
        ...event,
        suggestion: boundText(
          event.suggestion,
          AI_SSE_BOUNDS.suggestionMaxChars,
        ),
      })}\n\n`;
    }
  }

  return `data: ${JSON.stringify(payload)}\n\n`;
}

export type SuggestedReplySseError = {
  type: "error";
  code: AIErrorCode;
  message: string;
};

export const AI_REQUEST_BODY_MAX_BYTES = 8_192;

export function requireJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.toLowerCase().includes("application/json");
}

export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number = AI_REQUEST_BODY_MAX_BYTES,
): Promise<
  | { ok: true; body: unknown }
  | { ok: false; status: number; code: AIErrorCode; message: string }
> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      return {
        ok: false,
        status: 413,
        code: "AI_INVALID_RESPONSE",
        message: "Request body too large.",
      };
    }
  }

  const raw = await request.text();
  if (raw.length > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "AI_INVALID_RESPONSE",
      message: "Request body too large.",
    };
  }

  try {
    return { ok: true, body: JSON.parse(raw) as unknown };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "AI_INVALID_RESPONSE",
      message: "Invalid request body.",
    };
  }
}
