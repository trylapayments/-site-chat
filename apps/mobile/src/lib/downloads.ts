import { api } from "./client";
import { cacheKey, cached, remember, forget } from "./cache";
type Result = { attachmentId: string; url?: string; expiresAt?: string; error?: string };
type Pending = { id: string; resolve: (url: string) => void; reject: (error: Error) => void };
const batches = new Map<
  string,
  { userId: string; workspaceId: string; variant: "full" | "thumbnail"; items: Pending[] }
>();
const inflight = new Map<string, Promise<string>>();
export function attachmentUrl(
  userId: string,
  workspaceId: string,
  id: string,
  variant: "full" | "thumbnail" = "thumbnail",
  force = false,
): Promise<string> {
  const key = cacheKey(userId, workspaceId, `attachment:${id}:${variant}`);
  if (force) forget(key);
  const url = cached<string>(key);
  if (url) return Promise.resolve(url);
  const existing = inflight.get(key);
  if (existing) return existing;
  const group = cacheKey(userId, workspaceId, `downloads:${variant}`);
  const promise = new Promise<string>((resolve, reject) => {
    let batch = batches.get(group);
    if (!batch) {
      batch = { userId, workspaceId, variant, items: [] };
      batches.set(group, batch);
      setTimeout(() => void flush(group), 16);
    }
    batch.items.push({ id, resolve, reject });
  });
  inflight.set(key, promise);
  void promise.finally(() => inflight.delete(key)).catch(() => {});
  return promise;
}
async function flush(group: string) {
  const batch = batches.get(group);
  batches.delete(group);
  if (!batch) return;
  for (let start = 0; start < batch.items.length; start += 20) {
    const items = batch.items.slice(start, start + 20);
    try {
      const result = await api<{ items: Result[] }>(
        "downloads",
        batch.workspaceId,
        { attachmentIds: items.map((i) => i.id), variant: batch.variant },
        batch.userId,
      );
      for (const item of items) {
        const row = result.items.find((r) => r.attachmentId === item.id);
        if (row?.url) {
          const expiry = Date.parse(row.expiresAt ?? "");
          const ttl = Number.isFinite(expiry) ? Math.max(0, expiry - Date.now() - 60000) : 60000;
          remember(
            cacheKey(batch.userId, batch.workspaceId, `attachment:${item.id}:${batch.variant}`),
            row.url,
            ttl,
          );
          item.resolve(row.url);
        } else item.reject(new Error("Unable to open this attachment."));
      }
    } catch (error) {
      for (const item of items)
        item.reject(error instanceof Error ? error : new Error("Unable to load attachments."));
    }
  }
}
