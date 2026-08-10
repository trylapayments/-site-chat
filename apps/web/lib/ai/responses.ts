import { toPublicAIError, type AIErrorCode } from "@site-chat/ai";
import { NextResponse } from "next/server";

export function aiJsonError(error: unknown): NextResponse {
  const publicError = toPublicAIError(error);
  return NextResponse.json(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
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

export function encodeSseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export type SuggestedReplySseError = {
  type: "error";
  code: AIErrorCode;
  message: string;
};
