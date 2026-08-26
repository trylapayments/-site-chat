/**
 * Presentation helpers for team member identity.
 * Names are derived from email until a dedicated profile store exists.
 */
export function teamMemberDisplayName(email: string, fallback = "Unknown member"): string {
  const trimmed = email.trim();
  if (!trimmed) {
    return fallback;
  }
  const local = trimmed.split("@")[0] ?? trimmed;
  const words = local
    .split(/[._+-]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));
  return words.length > 0 ? words.join(" ") : fallback;
}

export function teamMemberInitials(label: string): string {
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

export function interpolateTeamCount(template: string, count: number): string {
  return template.replace("{{count}}", String(count));
}
