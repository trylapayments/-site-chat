export const AI_ERROR_CODES = [
  "AI_DISABLED",
  "AI_NOT_CONFIGURED",
  "AI_RATE_LIMITED",
  "AI_PROVIDER_ERROR",
  "AI_TIMEOUT",
  "AI_CANCELLED",
  "AI_INVALID_RESPONSE",
  "AI_UNAVAILABLE",
] as const;

export type AIErrorCode = (typeof AI_ERROR_CODES)[number];

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;
  readonly retryable: boolean;

  constructor(
    code: AIErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AIError";
    this.code = code;
    this.status = options?.status ?? defaultStatusForCode(code);
    this.retryable = options?.retryable ?? defaultRetryableForCode(code);
  }
}

function defaultStatusForCode(code: AIErrorCode): number {
  switch (code) {
    case "AI_DISABLED":
    case "AI_NOT_CONFIGURED":
      return 403;
    case "AI_RATE_LIMITED":
      return 429;
    case "AI_CANCELLED":
      return 499;
    case "AI_TIMEOUT":
      return 504;
    case "AI_INVALID_RESPONSE":
      return 502;
    case "AI_PROVIDER_ERROR":
    case "AI_UNAVAILABLE":
      return 503;
    default:
      return 500;
  }
}

function defaultRetryableForCode(code: AIErrorCode): boolean {
  return (
    code === "AI_RATE_LIMITED" ||
    code === "AI_TIMEOUT" ||
    code === "AI_PROVIDER_ERROR" ||
    code === "AI_UNAVAILABLE"
  );
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError;
}

export function isAICancellation(error: unknown): boolean {
  return isAIError(error) && error.code === "AI_CANCELLED";
}

export function toPublicAIError(error: unknown): {
  code: AIErrorCode;
  message: string;
  status: number;
  retryable: boolean;
} {
  if (isAIError(error)) {
    return {
      code: error.code,
      message: publicMessageForCode(error.code),
      status: error.status,
      retryable: error.retryable,
    };
  }

  return {
    code: "AI_UNAVAILABLE",
    message: publicMessageForCode("AI_UNAVAILABLE"),
    status: 503,
    retryable: true,
  };
}

export function publicMessageForCode(code: AIErrorCode): string {
  switch (code) {
    case "AI_DISABLED":
      return "AI features are disabled for this workspace.";
    case "AI_NOT_CONFIGURED":
      return "AI is not configured for this workspace.";
    case "AI_RATE_LIMITED":
      return "Too many AI requests. Please try again shortly.";
    case "AI_TIMEOUT":
      return "The AI provider timed out. Please try again.";
    case "AI_CANCELLED":
      return "The AI request was cancelled.";
    case "AI_INVALID_RESPONSE":
      return "The AI provider returned an invalid response.";
    case "AI_PROVIDER_ERROR":
      return "The AI provider failed to generate a response.";
    case "AI_UNAVAILABLE":
      return "AI is temporarily unavailable.";
    default:
      return "AI is temporarily unavailable.";
  }
}
