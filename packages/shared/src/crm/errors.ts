export const CRM_ERROR_CODES = [
  "FORBIDDEN",
  "CONTACT_NOT_FOUND",
  "COMPANY_NOT_FOUND",
  "COMPANY_NAME_REQUIRED",
  "COMPANY_DOMAIN_TAKEN",
  "TAG_NOT_FOUND",
  "TAG_NAME_REQUIRED",
  "TAG_NAME_TAKEN",
  "FIELD_NOT_FOUND",
  "FIELD_KEY_TAKEN",
  "FIELD_KEY_IMMUTABLE",
  "FIELD_TYPE_IMMUTABLE",
  "INVALID_COLOR",
  "INVALID_DOMAIN",
  "INVALID_WEBSITE",
  "INVALID_COUNTRY_CODE",
  "INVALID_FIELD_KEY",
  "INVALID_COMPANY_SIZE",
  "INVALID_FIELD_OPTIONS",
  "INVALID_FIELD_VALUE",
  "INVALID_FIELD_LABEL",
  "INVALID_FIELD_TYPE",
  "INVALID_SORT_ORDER",
  "INVALID_EMAIL",
  "INVALID_COMPANY_ID",
  "INVALID_PATCH",
  "INVALID_QUERY",
  "EMAIL_TAKEN",
] as const;

export type CrmErrorCode = (typeof CRM_ERROR_CODES)[number];

export class CrmError extends Error {
  readonly code: CrmErrorCode;

  constructor(code: CrmErrorCode, message: string) {
    super(message);
    this.name = "CrmError";
    this.code = code;
  }
}

const CODE_PREFIX = new RegExp(`^(${CRM_ERROR_CODES.join("|")}):\\s*(.*)$`);

/**
 * Map PostgREST / Postgres exception messages to typed CRM errors.
 * Never expose raw SQL internals to clients.
 */
export function parseCrmErrorMessage(raw: string | null | undefined): CrmError | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.replace(/\s+/g, " ").trim();
  const match = CODE_PREFIX.exec(trimmed);
  if (match) {
    const code = match[1] as CrmErrorCode;
    const detail = match[2]?.trim() || defaultMessageForCode(code);
    return new CrmError(code, detail);
  }

  if (/insufficient permissions/i.test(trimmed)) {
    return new CrmError("FORBIDDEN", defaultMessageForCode("FORBIDDEN"));
  }

  if (/workspace not accessible/i.test(trimmed) || /not authenticated/i.test(trimmed)) {
    return new CrmError("FORBIDDEN", "You do not have access to this workspace.");
  }

  if (/uq_contact_tags_workspace_lower_name_active/i.test(trimmed)) {
    return new CrmError("TAG_NAME_TAKEN", defaultMessageForCode("TAG_NAME_TAKEN"));
  }

  if (/uq_companies_workspace_domain_active/i.test(trimmed)) {
    return new CrmError("COMPANY_DOMAIN_TAKEN", defaultMessageForCode("COMPANY_DOMAIN_TAKEN"));
  }

  if (/uq_custom_field_definitions_workspace_key_active/i.test(trimmed)) {
    return new CrmError("FIELD_KEY_TAKEN", defaultMessageForCode("FIELD_KEY_TAKEN"));
  }

  if (/uq_contacts_workspace_email/i.test(trimmed)) {
    return new CrmError("EMAIL_TAKEN", defaultMessageForCode("EMAIL_TAKEN"));
  }

  return null;
}

function defaultMessageForCode(code: CrmErrorCode): string {
  switch (code) {
    case "FORBIDDEN":
      return "You do not have permission to perform this CRM action.";
    case "CONTACT_NOT_FOUND":
      return "Contact not found.";
    case "COMPANY_NOT_FOUND":
      return "Company not found.";
    case "COMPANY_NAME_REQUIRED":
      return "Company name is required (1–200 characters).";
    case "COMPANY_DOMAIN_TAKEN":
      return "A company with this domain already exists.";
    case "TAG_NOT_FOUND":
      return "Tag not found.";
    case "TAG_NAME_REQUIRED":
      return "Tag name is required (1–64 characters).";
    case "TAG_NAME_TAKEN":
      return "A tag with this name already exists.";
    case "FIELD_NOT_FOUND":
      return "Custom field definition not found.";
    case "FIELD_KEY_TAKEN":
      return "A custom field with this key already exists.";
    case "FIELD_KEY_IMMUTABLE":
      return "Custom field key cannot be changed after create.";
    case "FIELD_TYPE_IMMUTABLE":
      return "Custom field type cannot be changed after create.";
    case "INVALID_COLOR":
      return "Color must be a #RRGGBB hex value.";
    case "INVALID_DOMAIN":
      return "Domain format is invalid.";
    case "INVALID_WEBSITE":
      return "Website must be a valid http(s) URL.";
    case "INVALID_COUNTRY_CODE":
      return "Country code must be a 2-letter ISO code.";
    case "INVALID_FIELD_KEY":
      return "Key must match ^[a-z][a-z0-9_]{0,63}$.";
    case "INVALID_COMPANY_SIZE":
      return "Size must be one of 1-10, 11-50, 51-200, 201-500, 501-1000, 1001+.";
    case "INVALID_FIELD_OPTIONS":
      return "Invalid select options.";
    case "INVALID_FIELD_VALUE":
      return "Invalid custom field value.";
    case "INVALID_FIELD_LABEL":
      return "Label is required (1–120 characters).";
    case "INVALID_FIELD_TYPE":
      return "field_type must be text, number, boolean, date, or select.";
    case "INVALID_SORT_ORDER":
      return "sort_order must be between -100000 and 100000.";
    case "INVALID_EMAIL":
      return "Invalid email format.";
    case "INVALID_COMPANY_ID":
      return "company_id must be a uuid or null.";
    case "INVALID_PATCH":
      return "Invalid update patch.";
    case "INVALID_QUERY":
      return "Invalid CRM query.";
    case "EMAIL_TAKEN":
      return "Email already belongs to another visitor in this workspace.";
    default: {
      const exhaustive: never = code;
      return String(exhaustive);
    }
  }
}

export function isCrmErrorCode(value: string): value is CrmErrorCode {
  return (CRM_ERROR_CODES as readonly string[]).includes(value);
}

export function crmErrorMessageForCode(code: CrmErrorCode): string {
  return defaultMessageForCode(code);
}
