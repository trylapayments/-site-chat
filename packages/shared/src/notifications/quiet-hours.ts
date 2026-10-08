/**
 * Shared quiet-hours / DND evaluator.
 *
 * Must stay in parity with `app_private.notification_in_quiet_hours`:
 * - dnd_enabled false → not quiet
 * - dnd_enabled true + null/missing window → always quiet
 * - dnd_enabled true + equal start/end → always quiet
 * - dnd_enabled true + daytime window → quiet only inside [start, end)
 * - overnight window (start > end) supported (e.g. 22:00 → 07:00)
 * - invalid timezone falls back to UTC
 *
 * Durable in-app history is NOT gated by this result — only side effects
 * (browser, sound, email).
 */

export type QuietHoursInput = {
  dnd_enabled: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  timezone?: string | null;
};

/** Parse "HH:MM" or "HH:MM:SS" into seconds since midnight. */
export function parseClockToSeconds(value: string): number | null {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? "0");
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    !Number.isInteger(seconds) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59 ||
    seconds < 0 ||
    seconds > 59
  ) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Local wall-clock seconds since midnight in `timeZone`.
 * Invalid timezones fall back to UTC (mirrors SQL EXCEPTION path).
 */
export function localSecondsInTimeZone(now: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);

    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "NaN");
    const second = Number(parts.find((p) => p.type === "second")?.value ?? "NaN");

    if (!Number.isFinite(hour) || !Number.isFinite(minute) || !Number.isFinite(second)) {
      throw new Error("invalid parts");
    }

    return hour * 3600 + minute * 60 + second;
  } catch {
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    const utcSeconds = now.getUTCSeconds();
    return utcHours * 3600 + utcMinutes * 60 + utcSeconds;
  }
}

/**
 * Returns true when side-effect channels (browser / sound / email) should be suppressed.
 */
export function isQuietHoursActive(input: QuietHoursInput, now: Date = new Date()): boolean {
  if (!input.dnd_enabled) {
    return false;
  }

  const startRaw = input.quiet_hours_start ?? null;
  const endRaw = input.quiet_hours_end ?? null;

  if (startRaw == null || endRaw == null) {
    return true;
  }

  const start = parseClockToSeconds(startRaw);
  const end = parseClockToSeconds(endRaw);
  if (start == null || end == null || start === end) {
    return true;
  }

  const timeZone =
    input.timezone && input.timezone.trim().length > 0 ? input.timezone.trim() : "UTC";
  const local = localSecondsInTimeZone(now, timeZone);

  if (start < end) {
    return local >= start && local < end;
  }

  // Overnight.
  return local >= start || local < end;
}
