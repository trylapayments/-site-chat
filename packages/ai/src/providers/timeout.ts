import { AIError } from "../types/errors";

function asUnknownReason(reason: unknown): unknown {
  return reason;
}

function toError(reason: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }
  return new Error("AI request failed.");
}

function errorFromAbortReason(reason: unknown): AIError {
  if (reason instanceof AIError) {
    return reason;
  }

  // Caller/client AbortSignal (or unknown abort) is cancellation, not timeout.
  return new AIError("AI_CANCELLED", "AI request was cancelled.", {
    status: 499,
    retryable: false,
    cause: reason,
  });
}

/**
 * Map a transport AbortError to AI_TIMEOUT only when the combined signal was
 * aborted with an AI_TIMEOUT reason. Caller aborts map to AI_CANCELLED.
 */
export function abortErrorForSignal(signal: AbortSignal | undefined, cause?: unknown): AIError {
  if (signal?.aborted) {
    return errorFromAbortReason(asUnknownReason(signal.reason));
  }
  return errorFromAbortReason(cause);
}

export function combineAbortSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal | undefined; cleanup: () => void } {
  if (!timeoutMs && !signal) {
    return { signal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const onAbort = () => {
    controller.abort(asUnknownReason(signal?.reason));
  };

  if (signal) {
    if (signal.aborted) {
      controller.abort(asUnknownReason(signal.reason));
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(
        new AIError("AI_TIMEOUT", "AI request timed out.", {
          retryable: true,
        }),
      );
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }

  throw errorFromAbortReason(asUnknownReason(signal.reason));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  options: { timeoutMs?: number; signal?: AbortSignal },
): Promise<T> {
  const { signal, cleanup } = combineAbortSignals(options.signal, options.timeoutMs);

  try {
    throwIfAborted(signal);

    if (!signal) {
      return await promise;
    }

    return await new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(errorFromAbortReason(asUnknownReason(signal.reason)));
      };

      if (signal.aborted) {
        onAbort();
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(toError(error));
        },
      );
    });
  } finally {
    cleanup();
  }
}
