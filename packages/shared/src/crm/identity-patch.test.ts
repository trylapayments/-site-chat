import { describe, expect, it } from "vitest";

import {
  buildContactIdentityPatch,
  buildVisitorIdentityPatch,
  contactIdentityPatchHasChanges,
  identityValuesFromProfile,
  identityValuesToDraft,
  normalizeIdentityFieldValue,
  reconcileContactIdentityDraft,
  reconcileVisitorIdentityDraft,
  visitorIdentityPatchHasChanges,
  CONTACT_IDENTITY_KEYS,
} from "./identity-patch.js";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";

describe("normalizeIdentityFieldValue", () => {
  it("trims and clears empty strings", () => {
    expect(normalizeIdentityFieldValue("name", "  Ada  ")).toBe("Ada");
    expect(normalizeIdentityFieldValue("email", "   ")).toBeNull();
    expect(normalizeIdentityFieldValue("phone", null)).toBeNull();
  });

  it("uppercases country codes", () => {
    expect(normalizeIdentityFieldValue("country_code", " us ")).toBe("US");
  });
});

describe("buildContactIdentityPatch", () => {
  it("returns only dirty keys and maps empty string to null", () => {
    const baseline = identityValuesFromProfile({
      name: "Ada",
      email: "ada@example.com",
      phone: null,
      job_title: "Engineer",
      locale: "en-US",
      country_code: "US",
    });
    const draft = identityValuesToDraft(CONTACT_IDENTITY_KEYS, {
      ...baseline,
      email: "ada@example.com",
      job_title: "Staff Engineer",
      phone: "",
      name: "Ada",
    });

    const patch = buildContactIdentityPatch({
      contactId: CONTACT_ID,
      baseline,
      draft,
    });

    expect(patch).toEqual({
      contactId: CONTACT_ID,
      job_title: "Staff Engineer",
    });
    expect(contactIdentityPatchHasChanges(patch)).toBe(true);
  });

  it("includes null when clearing a previously set field", () => {
    const baseline = identityValuesFromProfile({
      name: "Ada",
      email: "ada@example.com",
      phone: null,
      job_title: null,
      locale: null,
      country_code: null,
    });
    const draft = identityValuesToDraft(CONTACT_IDENTITY_KEYS, {
      ...baseline,
      email: "",
    });

    const patch = buildContactIdentityPatch({
      contactId: CONTACT_ID,
      baseline,
      draft,
    });

    expect(patch).toEqual({
      contactId: CONTACT_ID,
      email: null,
    });
  });

  it("omits all fields when draft matches baseline", () => {
    const baseline = identityValuesFromProfile({
      name: "Ada",
      email: null,
      phone: null,
      job_title: null,
      locale: null,
      country_code: null,
    });
    const draft = identityValuesToDraft(CONTACT_IDENTITY_KEYS, baseline);
    const patch = buildContactIdentityPatch({
      contactId: CONTACT_ID,
      baseline,
      draft,
    });
    expect(patch).toEqual({ contactId: CONTACT_ID });
    expect(contactIdentityPatchHasChanges(patch)).toBe(false);
  });
});

describe("reconcileContactIdentityDraft", () => {
  it("adopts server values for pristine fields and keeps dirty drafts", () => {
    const baseline = identityValuesFromProfile({
      name: "Ada",
      email: "old@example.com",
      phone: null,
      job_title: "Engineer",
      locale: null,
      country_code: null,
    });
    const draft = identityValuesToDraft(CONTACT_IDENTITY_KEYS, {
      ...baseline,
      job_title: "Staff",
    });

    const result = reconcileContactIdentityDraft({
      baseline,
      draft,
      server: {
        name: "Ada Lovelace",
        email: "new@example.com",
        phone: null,
        job_title: "Engineer",
        locale: "en-US",
        country_code: "GB",
      },
    });

    expect(result.draft.name).toBe("Ada Lovelace");
    expect(result.draft.email).toBe("new@example.com");
    expect(result.draft.job_title).toBe("Staff");
    expect(result.draft.locale).toBe("en-US");
    expect(result.baseline.email).toBe("new@example.com");
    expect(result.baseline.job_title).toBe("Engineer");
  });

  it("resets baseline to server even when draft is dirty", () => {
    const baseline = identityValuesFromProfile({
      name: "Ada",
      email: null,
      phone: null,
      job_title: null,
      locale: null,
      country_code: null,
    });
    const draft = identityValuesToDraft(CONTACT_IDENTITY_KEYS, {
      ...baseline,
      name: "Local Name",
    });

    const result = reconcileContactIdentityDraft({
      baseline,
      draft,
      server: {
        name: "Server Name",
        email: "s@example.com",
        phone: null,
        job_title: null,
        locale: null,
        country_code: null,
      },
    });

    expect(result.draft.name).toBe("Local Name");
    expect(result.baseline.name).toBe("Server Name");
    expect(result.draft.email).toBe("s@example.com");
  });
});

describe("visitor identity helpers", () => {
  it("builds dirty-only visitor patches", () => {
    const patch = buildVisitorIdentityPatch({
      baseline: { name: "Ada", email: "a@x.com", phone: null },
      draft: { name: "Ada", email: "b@x.com", phone: "" },
    });
    expect(patch).toEqual({ email: "b@x.com" });
    expect(visitorIdentityPatchHasChanges(patch)).toBe(true);
  });

  it("reconciles visitor drafts without wiping dirty phone", () => {
    const result = reconcileVisitorIdentityDraft({
      baseline: { name: "Ada", email: "a@x.com", phone: "1" },
      draft: { name: "Ada", email: "a@x.com", phone: "999" },
      server: { name: "Ada L", email: "b@x.com", phone: "1" },
    });
    expect(result.draft).toEqual({
      name: "Ada L",
      email: "b@x.com",
      phone: "999",
    });
  });
});
