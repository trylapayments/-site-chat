import type { ContactListItem, ContactProfile } from "@site-chat/shared";

export function contactDisplayLabel(
  contact: Pick<
    ContactListItem | ContactProfile,
    "name" | "email" | "public_id"
  >,
): string {
  return (
    contact.name?.trim() ||
    contact.email?.trim() ||
    contact.public_id ||
    "Unknown contact"
  );
}

export function initialsFromLabel(label: string): string {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  const first = parts[0] ?? "";
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const second = parts[1] ?? "";
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}

function formatContactListAbsoluteDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Relative last-seen label. Pass `nowMs` only after client mount so SSR and the
 * first client render match (avoids React hydration error #418).
 */
export function formatContactListTime(
  value: string | null | undefined,
  nowMs?: number,
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  if (nowMs === undefined) {
    return formatContactListAbsoluteDate(date);
  }
  const diffMs = nowMs - date.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return "now";
  }
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${String(hours)}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${String(days)}d`;
  }
  return formatContactListAbsoluteDate(date);
}

export function formatContactDateTime(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

export function contactLocationLabel(
  contact: Pick<ContactListItem | ContactProfile, "country_code" | "locale">,
): string | null {
  const parts = [contact.country_code, contact.locale].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}
