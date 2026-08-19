/**
 * Business-hours foundation helpers (online/offline greeting selection).
 * Full routing / SLA is out of scope for Widget Studio v1.
 */

export type WeeklyAvailability = {
  day: number;
  start: string;
  end: string;
};

function parseHm(value: string): number {
  const parts = value.split(":");
  const hours = Number.parseInt(parts[0] ?? "", 10);
  const minutes = Number.parseInt(parts[1] ?? "", 10);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return -1;
  }
  return hours * 60 + minutes;
}

/**
 * Evaluate whether `instant` falls within weekly availability in `timezone`.
 * Invalid timezone falls back to UTC.
 */
export function isWithinBusinessHours(input: {
  enabled: boolean;
  timezone: string;
  weekly: readonly WeeklyAvailability[];
  instant?: Date;
}): boolean {
  if (!input.enabled) {
    return true;
  }
  if (input.weekly.length === 0) {
    return false;
  }

  const instant = input.instant ?? new Date();
  let day: number;
  let minutes: number;

  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: input.timezone || "UTC",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);

    const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
    const hour = Number.parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
    const minute = Number.parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
    const weekdayMap: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    day = weekdayMap[weekday] ?? instant.getUTCDay();
    minutes = hour * 60 + minute;
  } catch {
    day = instant.getUTCDay();
    minutes = instant.getUTCHours() * 60 + instant.getUTCMinutes();
  }

  return input.weekly.some((row) => {
    if (row.day !== day) {
      return false;
    }
    const start = parseHm(row.start);
    const end = parseHm(row.end);
    if (start < 0 || end < 0) {
      return false;
    }
    return minutes >= start && minutes < end;
  });
}
