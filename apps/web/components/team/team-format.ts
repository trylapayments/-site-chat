import {
  teamMessagesEn,
  type MemberRole,
  type TeamMemberStatus,
} from "@site-chat/shared";

const messages = teamMessagesEn;

export function formatTeamDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function roleLabel(role: MemberRole): string {
  switch (role) {
    case "owner":
      return messages.roleOwner;
    case "admin":
      return messages.roleAdmin;
    case "agent":
      return messages.roleAgent;
    case "viewer":
      return messages.roleViewer;
    default: {
      const exhaustive: never = role;
      return String(exhaustive);
    }
  }
}

export function statusLabel(status: TeamMemberStatus | "invited"): string {
  switch (status) {
    case "active":
      return messages.statusActive;
    case "deactivated":
      return messages.statusDeactivated;
    case "invited":
      return messages.statusInvited;
    default: {
      const exhaustive: never = status;
      return String(exhaustive);
    }
  }
}
