export const NOTE_ERROR_CODES = [
  "FORBIDDEN",
  "NOTE_NOT_FOUND",
  "NOTE_DELETED",
  "CONVERSATION_NOT_FOUND",
  "MEMBER_NOT_FOUND",
  "MEMBER_NOT_MENTIONABLE",
  "INVALID_BODY",
] as const;

export type NoteErrorCode = (typeof NOTE_ERROR_CODES)[number];

export class NoteError extends Error {
  readonly code: NoteErrorCode;

  constructor(code: NoteErrorCode, message: string) {
    super(message);
    this.name = "NoteError";
    this.code = code;
  }
}

const CODE_PREFIX =
  /^(FORBIDDEN|NOTE_NOT_FOUND|NOTE_DELETED|CONVERSATION_NOT_FOUND|MEMBER_NOT_FOUND|MEMBER_NOT_MENTIONABLE|INVALID_BODY):\s*(.*)$/;

/**
 * Map PostgREST / Postgres exception messages to typed note errors.
 * Never expose raw SQL internals to clients.
 */
export function parseNoteErrorMessage(raw: string | null | undefined): NoteError | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.replace(/\s+/g, " ").trim();
  const match = CODE_PREFIX.exec(trimmed);
  if (match) {
    const code = match[1] as NoteErrorCode;
    const detail = match[2]?.trim() || defaultMessageForCode(code);
    return new NoteError(code, detail);
  }

  if (/insufficient permissions/i.test(trimmed)) {
    return new NoteError("FORBIDDEN", "You do not have permission to manage internal notes.");
  }

  if (/workspace not accessible/i.test(trimmed) || /not authenticated/i.test(trimmed)) {
    return new NoteError("FORBIDDEN", "You do not have access to this workspace.");
  }

  if (/conversation not found/i.test(trimmed)) {
    return new NoteError("CONVERSATION_NOT_FOUND", "Conversation not found.");
  }

  if (/note not found/i.test(trimmed)) {
    return new NoteError("NOTE_NOT_FOUND", "Internal note not found.");
  }

  return null;
}

function defaultMessageForCode(code: NoteErrorCode): string {
  switch (code) {
    case "FORBIDDEN":
      return "You do not have permission to manage internal notes.";
    case "NOTE_NOT_FOUND":
      return "Internal note not found.";
    case "NOTE_DELETED":
      return "This note has been deleted.";
    case "CONVERSATION_NOT_FOUND":
      return "Conversation not found.";
    case "MEMBER_NOT_FOUND":
      return "Mentioned member was not found in this workspace.";
    case "MEMBER_NOT_MENTIONABLE":
      return "That member cannot be mentioned.";
    case "INVALID_BODY":
      return "Note body must be 1–4000 characters.";
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

export function isNoteErrorCode(value: string): value is NoteErrorCode {
  return (NOTE_ERROR_CODES as readonly string[]).includes(value);
}
