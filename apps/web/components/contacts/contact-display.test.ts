import { describe, expect, it } from "vitest";

import {
  contactDisplayLabel,
  contactLocationLabel,
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
});
