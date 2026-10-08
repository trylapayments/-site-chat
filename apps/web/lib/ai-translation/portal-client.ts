import type { translateInPortal as translateAction, loadOperatorReplyOriginals as originalsAction } from "./actions";
async function post<T>(body: unknown): Promise<T> {
  const response = await fetch("/api/portal/translation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Unable to load translation.");
  return response.json() as Promise<T>;
}
export function translateInPortal(raw: unknown) { return post<Awaited<ReturnType<typeof translateAction>>>(raw); }
export function loadOperatorReplyOriginals(raw: unknown) { return post<Awaited<ReturnType<typeof originalsAction>>>({ operation: "originals", input: raw }); }
