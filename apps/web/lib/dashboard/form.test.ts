import { describe, expect, it } from "vitest";

import { getFormString, mapFieldErrors } from "@/lib/dashboard/form";

describe("dashboard form helpers", () => {
  it("maps zod-style field errors by first path segment", () => {
    expect(
      mapFieldErrors([
        { path: ["email"], message: "Invalid email" },
        { path: ["email"], message: "Required" },
        { path: ["form"], message: "General error" },
      ]),
    ).toEqual({
      email: ["Invalid email", "Required"],
      form: ["General error"],
    });
  });

  it("reads string form values safely", () => {
    const formData = new FormData();
    formData.set("name", "Acme");
    formData.set("empty", "");

    expect(getFormString(formData, "name")).toBe("Acme");
    expect(getFormString(formData, "missing")).toBe("");
  });
});
