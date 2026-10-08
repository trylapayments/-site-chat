/**
 * CRM-lite constants aligned with
 * supabase/migrations/20260816200000_visitor_profile_crm.sql.
 */

export const CUSTOM_FIELD_TYPES = ["text", "number", "boolean", "date", "select"] as const;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1001+"] as const;

/** Default tag color (#RRGGBB) when the operator does not pick one. */
export const CONTACT_TAG_COLOR_DEFAULT = "#64748B";

export const CONTACT_TAG_NAME_MAX_LENGTH = 64;
export const CONTACT_TAG_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const COMPANY_NAME_MAX_LENGTH = 200;
export const COMPANY_DOMAIN_MAX_LENGTH = 253;
export const COMPANY_WEBSITE_MAX_LENGTH = 2048;
export const COMPANY_INDUSTRY_MAX_LENGTH = 120;

export const CUSTOM_FIELD_KEY_MAX_LENGTH = 64;
export const CUSTOM_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const CUSTOM_FIELD_LABEL_MAX_LENGTH = 120;
export const CUSTOM_FIELD_OPTION_MAX_LENGTH = 64;
export const CUSTOM_FIELD_OPTIONS_MAX = 50;
export const CUSTOM_FIELD_TEXT_VALUE_MAX_LENGTH = 2000;
export const CUSTOM_FIELD_SORT_ORDER_MIN = -100_000;
export const CUSTOM_FIELD_SORT_ORDER_MAX = 100_000;

export const CONTACT_NAME_MAX_LENGTH = 120;
export const CONTACT_EMAIL_MAX_LENGTH = 254;
export const CONTACT_PHONE_MAX_LENGTH = 64;
export const CONTACT_JOB_TITLE_MAX_LENGTH = 120;
export const CONTACT_LOCALE_MAX_LENGTH = 35;
export const CONTACT_SEARCH_MAX_LENGTH = 200;

export const LIST_CONTACTS_DEFAULT_PAGE_SIZE = 25;
export const LIST_CONTACTS_MAX_PAGE_SIZE = 50;
export const LIST_COMPANIES_DEFAULT_PAGE_SIZE = 50;
export const LIST_COMPANIES_MAX_PAGE_SIZE = 100;
