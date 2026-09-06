export const TEAM_ERROR_CODES = [
  "FORBIDDEN",
  "MEMBER_NOT_FOUND",
  "INVITATION_NOT_FOUND",
  "INVITATION_EXISTS",
  "LAST_OWNER",
  "INVALID_ROLE",
  "INVALID_EMAIL",
  "CONFLICT",
] as const;

export type TeamErrorCode = (typeof TEAM_ERROR_CODES)[number];

export class TeamError extends Error {
  readonly code: TeamErrorCode;

  constructor(code: TeamErrorCode, message: string) {
    super(message);
    this.name = "TeamError";
    this.code = code;
  }
}

/**
 * Map PostgREST / Postgres exception messages to typed team errors.
 * Never expose raw SQL internals to clients.
 */
export function parseTeamErrorMessage(raw: string | null | undefined): TeamError | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.replace(/\s+/g, " ").trim();

  if (/insufficient permissions/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/workspace not accessible/i.test(trimmed) || /not authenticated/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", "You do not have access to this workspace.");
  }

  if (/not authorized/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/only owners and admins can/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/only owners can/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/admins cannot modify owners/i.test(trimmed)) {
    return new TeamError("FORBIDDEN", "Admins cannot change an owner's membership.");
  }

  if (/use owner promotion or demotion/i.test(trimmed)) {
    return new TeamError("INVALID_ROLE", "Owner role changes must use promotion or demotion.");
  }

  if (/cannot invite with owner role/i.test(trimmed) || /invalid invitation role/i.test(trimmed)) {
    return new TeamError("INVALID_ROLE", "Invitations cannot use the owner role.");
  }

  if (/invalid target role/i.test(trimmed)) {
    return new TeamError("INVALID_ROLE", "That role is not allowed for this member.");
  }

  if (/only active members can be promoted/i.test(trimmed)) {
    return new TeamError("INVALID_ROLE", "Only active members can be promoted to owner.");
  }

  if (/target member is not an owner/i.test(trimmed)) {
    return new TeamError("INVALID_ROLE", "That member is not an owner.");
  }

  if (/an active invitation already exists/i.test(trimmed)) {
    return new TeamError(
      "INVITATION_EXISTS",
      "An active invitation already exists for this email.",
    );
  }

  if (/invitation not found or already resolved/i.test(trimmed)) {
    return new TeamError("INVITATION_NOT_FOUND", "This invitation is no longer pending.");
  }

  if (/member not found/i.test(trimmed)) {
    return new TeamError("MEMBER_NOT_FOUND", defaultMessageForCode("MEMBER_NOT_FOUND"));
  }

  if (/workspace must have at least one active owner/i.test(trimmed)) {
    return new TeamError("LAST_OWNER", "The workspace must keep at least one active owner.");
  }

  if (/invalid email/i.test(trimmed)) {
    return new TeamError("INVALID_EMAIL", "Enter a valid email address.");
  }

  return null;
}

function defaultMessageForCode(code: TeamErrorCode): string {
  switch (code) {
    case "FORBIDDEN":
      return "You do not have permission to manage team members.";
    case "MEMBER_NOT_FOUND":
      return "Member not found in this workspace.";
    case "INVITATION_NOT_FOUND":
      return "This invitation is no longer pending.";
    case "INVITATION_EXISTS":
      return "An active invitation already exists for this email.";
    case "LAST_OWNER":
      return "The workspace must keep at least one active owner.";
    case "INVALID_ROLE":
      return "That role change is not allowed.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    case "CONFLICT":
      return "This membership was changed by someone else. Refresh and try again.";
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

export function teamErrorMessageForCode(code: TeamErrorCode): string {
  return defaultMessageForCode(code);
}
