import { describe, expect, it } from "vitest";

import { CONTACT_TAG_COLOR_DEFAULT, COMPANY_SIZES, CUSTOM_FIELD_TYPES } from "./constants.js";
import { CrmError, parseCrmErrorMessage } from "./errors.js";
import {
  contactProfileSchema,
  createContactTagSchema,
  createCustomFieldDefinitionSchema,
  listContactsQuerySchema,
  listContactsResultSchema,
  updateContactProfileSchema,
} from "../schemas/crm.js";

describe("CRM constants", () => {
  it("exposes field types and company sizes matching the migration", () => {
    expect(CUSTOM_FIELD_TYPES).toEqual(["text", "number", "boolean", "date", "select"]);
    expect(COMPANY_SIZES).toContain("1-10");
    expect(COMPANY_SIZES).toContain("1001+");
    expect(CONTACT_TAG_COLOR_DEFAULT).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("parseCrmErrorMessage", () => {
  it("parses CODE: message exceptions", () => {
    const error = parseCrmErrorMessage("TAG_NAME_TAKEN: A tag with this name already exists.");
    expect(error).toBeInstanceOf(CrmError);
    expect(error?.code).toBe("TAG_NAME_TAKEN");
    expect(error?.message).toBe("A tag with this name already exists.");
  });

  it("maps unique index races to typed codes", () => {
    const error = parseCrmErrorMessage(
      'duplicate key value violates unique constraint "uq_companies_workspace_domain_active"',
    );
    expect(error?.code).toBe("COMPANY_DOMAIN_TAKEN");
  });

  it("returns null for unknown messages", () => {
    expect(parseCrmErrorMessage("something else")).toBeNull();
  });
});

describe("CRM schemas", () => {
  it("parses a contact profile JSON shape", () => {
    const parsed = contactProfileSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Ada",
      email: "ada@example.com",
      phone: null,
      job_title: "Engineer",
      locale: "en-US",
      country_code: "US",
      attributes: {},
      first_seen_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-02T00:00:00.000Z",
      visit_count: 2,
      conversation_count: 1,
      attachment_count: 0,
      company: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Acme",
        domain: "acme.com",
        website: null,
        industry: null,
        size: "11-50",
      },
      tags: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          name: "VIP",
          color: "#64748B",
        },
      ],
      custom_fields: [
        {
          field_id: "44444444-4444-4444-8444-444444444444",
          key: "plan",
          label: "Plan",
          field_type: "select",
          options: ["free", "pro"],
          value: "pro",
        },
      ],
      current_assignee: null,
      device_summary: null,
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses list_contacts result", () => {
    const parsed = listContactsResultSchema.safeParse({
      items: [],
      next_before: null,
      has_more: false,
    });
    expect(parsed.success).toBe(true);
  });

  it("defaults list_contacts query limit", () => {
    const parsed = listContactsQuerySchema.parse({});
    expect(parsed.limit).toBe(25);
  });

  it("requires at least one update_contact_profile field", () => {
    const parsed = updateContactProfileSchema.safeParse({
      contactId: "11111111-1111-4111-8111-111111111111",
    });
    expect(parsed.success).toBe(false);
  });

  it("defaults tag color on create", () => {
    const parsed = createContactTagSchema.parse({ name: "VIP" });
    expect(parsed.color).toBe(CONTACT_TAG_COLOR_DEFAULT);
  });

  it("requires options for select custom fields", () => {
    const parsed = createCustomFieldDefinitionSchema.safeParse({
      key: "plan",
      label: "Plan",
      field_type: "select",
      options: [],
    });
    expect(parsed.success).toBe(false);
  });
});
