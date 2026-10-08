import type { OperatorAvailabilitySnapshot } from "./status";

/** Background presence must not occupy Next's serialized Server Action queue. */
export async function heartbeatOperator(
  slug: string,
  active: boolean,
): Promise<OperatorAvailabilitySnapshot> {
  const response = await fetch(
    `/api/portal/${encodeURIComponent(slug)}/heartbeat`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("Status unavailable");
  return response.json() as Promise<OperatorAvailabilitySnapshot>;
}
