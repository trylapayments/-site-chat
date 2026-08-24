import { describe, expect, it } from "vitest";

import {
  contactDisplayLabel,
  contactLocationLabel,
  formatContactListTime,
  initialsFromLabel,
} from "@/components/contacts/contact-display";

describe("contact-display helpers", () => {
  it("prefers name, then email, then public_id", () => {
    expect(
      contactDisplayLabel({
        name: "Jane Cooper",
        email: "jane@example.com",
        public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toBe("Jane Cooper");
    expect(
      contactDisplayLabel({
        name: null,
        email: "jane@example.com",
        public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toBe("jane@example.com");
    expect(
      contactDisplayLabel({
        name: "  ",
        email: null,
        public_id: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }),
    ).toBe("vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("builds initials from the display label", () => {
    expect(initialsFromLabel("Jane Cooper")).toBe("JC");
    expect(initialsFromLabel("Acme")).toBe("AC");
    expect(initialsFromLabel("")).toBe("?");
  });

  it("formats location from country and locale", () => {
    expect(contactLocationLabel({ country_code: "US", locale: "en-US" })).toBe(
      "US · en-US",
    );
    expect(contactLocationLabel({ country_code: null, locale: null })).toBe(
      null,
    );
  });

  it("formats list times without Date.now when nowMs is omitted", () => {
    expect(formatContactListTime(null)).toBe("—");
    expect(formatContactListTime("2026-01-15T12:00:00.000Z")).toBe("Jan 15");
  });

  it("formats relative list times when nowMs is provided", () => {
    const now = Date.parse("2026-01-15T12:30:00.000Z");
    expect(formatContactListTime("2026-01-15T12:29:30.000Z", now)).toBe("now");
    expect(formatContactListTime("2026-01-15T12:00:00.000Z", now)).toBe("30m");
    expect(formatContactListTime("2026-01-15T10:00:00.000Z", now)).toBe("2h");
    expect(formatContactListTime("2026-01-13T12:30:00.000Z", now)).toBe("2d");
    expect(formatContactListTime("2025-12-01T12:00:00.000Z", now)).toBe(
      "Dec 1",
    );
  });
});
