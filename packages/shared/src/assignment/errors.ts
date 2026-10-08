export const ASSIGNMENT_ERROR_CODES = [
  "ASSIGNMENT_CONFLICT",
  "MEMBER_NOT_FOUND",
  "MEMBER_NOT_ASSIGNABLE",
  "FORBIDDEN",
  "CONVERSATION_NOT_FOUND",
] as const;

export type AssignmentErrorCode = (typeof ASSIGNMENT_ERROR_CODES)[number];

export class AssignmentError extends Error {
  readonly code: AssignmentErrorCode;

  constructor(code: AssignmentErrorCode, message: string) {
    super(message);
    this.name = "AssignmentError";
    this.code = code;
  }
}

const CODE_PREFIX =
  /^(ASSIGNMENT_CONFLICT|MEMBER_NOT_FOUND|MEMBER_NOT_ASSIGNABLE|FORBIDDEN|CONVERSATION_NOT_FOUND):\s*(.*)$/;

/**
 * Map PostgREST / Postgres exception messages to typed assignment errors.
 * Never expose raw SQL internals to clients.
 */
export function parseAssignmentErrorMessage(
  raw: string | null | undefined,
): AssignmentError | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.replace(/\s+/g, " ").trim();
  const match = CODE_PREFIX.exec(trimmed);
  if (match) {
    const code = match[1] as AssignmentErrorCode;
    const detail = match[2]?.trim() || defaultMessageForCode(code);
    return new AssignmentError(code, detail);
  }

  if (/insufficient permissions/i.test(trimmed)) {
    return new AssignmentError("FORBIDDEN", "You do not have permission to assign conversations.");
  }

  if (/workspace not accessible/i.test(trimmed) || /not authenticated/i.test(trimmed)) {
    return new AssignmentError("FORBIDDEN", "You do not have access to this workspace.");
  }

  if (/conversation not found/i.test(trimmed)) {
    return new AssignmentError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }

  if (/assignee is not an active/i.test(trimmed) || /assignee is not a member/i.test(trimmed)) {
    return new AssignmentError("MEMBER_NOT_ASSIGNABLE", "Assignee is not assignable.");
  }

  return null;
}

function defaultMessageForCode(code: AssignmentErrorCode): string {
  switch (code) {
    case "ASSIGNMENT_CONFLICT":
      return "This conversation was assigned by someone else.";
    case "MEMBER_NOT_FOUND":
      return "Member not found in this workspace.";
    case "MEMBER_NOT_ASSIGNABLE":
      return "That member cannot be assigned conversations.";
    case "FORBIDDEN":
      return "You do not have permission to assign conversations.";
    case "CONVERSATION_NOT_FOUND":
      return "Conversation not found.";
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

export function isAssignmentErrorCode(value: string): value is AssignmentErrorCode {
  return (ASSIGNMENT_ERROR_CODES as readonly string[]).includes(value);
}
