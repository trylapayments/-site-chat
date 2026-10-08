export const CANNED_ERROR_CODES = [
  "FORBIDDEN",
  "CANNED_NOT_FOUND",
  "CANNED_DELETED",
  "FOLDER_NOT_FOUND",
  "FOLDER_DELETED",
  "FOLDER_SCOPE_MISMATCH",
  "SHORTCUT_TAKEN",
  "INVALID_TITLE",
  "INVALID_BODY",
  "INVALID_NAME",
  "INVALID_SHORTCUT",
  "INVALID_VISIBILITY",
  "INVALID_SORT_ORDER",
  "INVALID_QUERY",
] as const;

export type CannedErrorCode = (typeof CANNED_ERROR_CODES)[number];

export class CannedError extends Error {
  readonly code: CannedErrorCode;

  constructor(code: CannedErrorCode, message: string) {
    super(message);
    this.name = "CannedError";
    this.code = code;
  }
}

const CODE_PREFIX = new RegExp(`^(${CANNED_ERROR_CODES.join("|")}):\\s*(.*)$`);

/**
 * Map PostgREST / Postgres exception messages to typed canned-response errors.
 * Never expose raw SQL internals to clients.
 */
export function parseCannedErrorMessage(raw: string | null | undefined): CannedError | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.replace(/\s+/g, " ").trim();
  const match = CODE_PREFIX.exec(trimmed);
  if (match) {
    const code = match[1] as CannedErrorCode;
    const detail = match[2]?.trim() || defaultMessageForCode(code);
    return new CannedError(code, detail);
  }

  if (/insufficient permissions/i.test(trimmed)) {
    return new CannedError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/workspace not accessible/i.test(trimmed) || /not authenticated/i.test(trimmed)) {
    return new CannedError("FORBIDDEN", "You do not have access to this workspace.");
  }

  // Shortcut uniqueness is also enforced by two partial unique indexes; a raced
  // insert can surface the index name instead of the typed prefix.
  if (/uq_canned_responses_(workspace|personal)_shortcut/i.test(trimmed)) {
    return new CannedError("SHORTCUT_TAKEN", defaultMessageForCode("SHORTCUT_TAKEN"));
  }

  return null;
}

function defaultMessageForCode(code: CannedErrorCode): string {
  switch (code) {
    case "FORBIDDEN":
      return "You do not have permission to manage canned responses.";
    case "CANNED_NOT_FOUND":
      return "Canned response not found.";
    case "CANNED_DELETED":
      return "This canned response was deleted.";
    case "FOLDER_NOT_FOUND":
      return "Folder not found.";
    case "FOLDER_DELETED":
      return "This folder was deleted.";
    case "FOLDER_SCOPE_MISMATCH":
      return "That folder belongs to a different visibility scope.";
    case "SHORTCUT_TAKEN":
      return "That shortcut is already in use.";
    case "INVALID_TITLE":
      return "Title must be 1–200 characters.";
    case "INVALID_BODY":
      return "Body must be 1–4000 characters.";
    case "INVALID_NAME":
      return "Folder name must be 1–100 characters.";
    case "INVALID_SHORTCUT":
      return "Shortcut must use lowercase letters, digits, hyphen or underscore.";
    case "INVALID_VISIBILITY":
      return 'Visibility must be "workspace" or "personal".';
    case "INVALID_SORT_ORDER":
      return "Folder position is out of range.";
    case "INVALID_QUERY":
      return "Invalid canned response query.";
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

export function isCannedErrorCode(value: string): value is CannedErrorCode {
  return (CANNED_ERROR_CODES as readonly string[]).includes(value);
}

export function cannedErrorMessageForCode(code: CannedErrorCode): string {
  return defaultMessageForCode(code);
}
