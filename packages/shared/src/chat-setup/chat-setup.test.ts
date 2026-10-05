import { describe, expect, it } from "vitest";
import { chatSetupSchema, validatePreChatSubmission } from "./index";
const id = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const base = { requestId, name: "Visitor", email: "visitor@example.com", answers: {} };
describe("custom pre-chat fields", () => {
  it("rejects forged choices, unknown field IDs and invalid numeric answers", () => {
    const choice = chatSetupSchema.parse({
      fields: [{ id, label: "Service", type: "select", required: true, options: ["Legal", "Tax"] }],
    });
    expect(validatePreChatSubmission(choice, { ...base, answers: { [id]: "Other" } }).success).toBe(
      false,
    );
    expect(
      validatePreChatSubmission(choice, {
        ...base,
        answers: { [id]: "Legal", [requestId]: "Extra" },
      }).success,
    ).toBe(false);
    expect(validatePreChatSubmission(choice, { ...base, answers: { [id]: "Legal" } }).success).toBe(
      true,
    );
    const number = chatSetupSchema.parse({
      fields: [{ id, label: "Budget", type: "number", required: true }],
    });
    for (const value of ["NaN", "Infinity", "0x10", "1e999", ""])
      expect(validatePreChatSubmission(number, { ...base, answers: { [id]: value } }).success).toBe(
        false,
      );
    expect(validatePreChatSubmission(number, { ...base, answers: { [id]: "12.50" } }).success).toBe(
      true,
    );
  });
  it("requires true for required checkboxes and does not coerce strings", () => {
    const setup = chatSetupSchema.parse({
      fields: [{ id, label: "Confirm", type: "checkbox", required: true }],
    });
    for (const value of [false, "true", undefined])
      expect(validatePreChatSubmission(setup, { ...base, answers: { [id]: value } }).success).toBe(
        false,
      );
    expect(validatePreChatSubmission(setup, { ...base, answers: { [id]: true } }).success).toBe(
      true,
    );
  });
  it("rejects duplicated field IDs and choices; keeps fields optional by configuration", () => {
    const field = { id, label: "Company", type: "text", required: false };
    expect(chatSetupSchema.safeParse({ fields: [field, field] }).success).toBe(false);
    expect(
      chatSetupSchema.safeParse({
        fields: [{ ...field, type: "select", options: ["Yes", " Yes "] }],
      }).success,
    ).toBe(false);
    expect(
      validatePreChatSubmission(chatSetupSchema.parse({ fields: [field] }), base).success,
    ).toBe(true);
  });
});
