export type OperatorStatus = "available" | "away" | "offline";
export type OperatorAvailabilitySnapshot = {
  status: OperatorStatus;
  selectedStatus: OperatorStatus;
  idleTimeoutMinutes: number;
  autoAway: boolean;
};

export function effectiveOperatorStatus(
  input: {
    status: string;
    last_activity_at: string;
    idle_timeout_minutes: number;
  },
  now = Date.now(),
): OperatorStatus {
  if (input.status === "offline" || input.status === "away")
    return input.status;
  if (input.status !== "available") return "offline";
  const idle = now - Date.parse(input.last_activity_at);
  return input.idle_timeout_minutes > 0 &&
    idle >= input.idle_timeout_minutes * 60_000
    ? "away"
    : "available";
}
export function aggregateOperatorStatus(
  statuses: readonly string[],
): OperatorStatus {
  return statuses.includes("available")
    ? "available"
    : statuses.includes("away")
      ? "away"
      : "offline";
}
