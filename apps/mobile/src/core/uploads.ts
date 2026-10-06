import type { PendingMessage } from "./outbox";

export function reusableUpload(upload: PendingMessage["upload"], now: number) {
  return upload?.uploads.some((target) => target.expiresAt && Date.parse(target.expiresAt) <= now)
    ? undefined
    : upload;
}

export function duplicateUpload(status: number, payload: unknown) {
  if (status === 409) return true;
  if (status !== 400 || !payload || typeof payload !== "object") return false;
  const error = payload as { error?: unknown; statusCode?: unknown };
  return error.error === "Duplicate" || error.statusCode === "409" || error.statusCode === 409;
}
