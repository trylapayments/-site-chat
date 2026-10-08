import { AUTH_ROUTES } from "@/lib/auth/constants";
import { sanitizeInviteClearDestination } from "@/lib/auth/redirect";

const INVITE_INVALID_DESTINATION = `${AUTH_ROUTES.authError}?code=invite_invalid`;

export function buildInviteClearUrl(destination: string): string {
  const safeDestination =
    sanitizeInviteClearDestination(destination) ?? INVITE_INVALID_DESTINATION;

  return `${AUTH_ROUTES.inviteClear}?destination=${encodeURIComponent(safeDestination)}`;
}
