const cache = new Map<string, { value: unknown; expires: number }>();
export const cacheKey = (userId: string, workspaceId: string, resource: string) =>
  `${userId}:${workspaceId}:${resource}`;
export function cached<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    cache.delete(key);
    return;
  }
  return entry.value as T;
}
export function remember<T>(key: string, value: T, ttl = 300000) {
  if (!cache.has(key) && cache.size >= 100) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, expires: Date.now() + ttl });
}
export function forget(key: string) {
  cache.delete(key);
}
export function clearCache() {
  cache.clear();
}
export function clearAccountCache(userId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${userId}:`)) cache.delete(key);
}
