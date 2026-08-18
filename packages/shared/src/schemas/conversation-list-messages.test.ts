import { describe, expect, it } from "vitest";

import { listMessagesQuerySchema } from "./conversation.js";

describe("listMessagesQuerySchema", () => {
  it("accepts around_message_id alone", () => {
    const parsed = listMessagesQuerySchema.parse({
      limit: 50,
      around_message_id: "22222222-2222-2222-2222-222222222222",
    });
    expect(parsed.around_message_id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("rejects around_message_id with before_sequence", () => {
    const result = listMessagesQuerySchema.safeParse({
      around_message_id: "22222222-2222-2222-2222-222222222222",
      before_sequence: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects around_message_id with after_sequence", () => {
    const result = listMessagesQuerySchema.safeParse({
      around_message_id: "22222222-2222-2222-2222-222222222222",
      after_sequence: 10,
    });
    expect(result.success).toBe(false);
  });

  it("still rejects before_sequence with after_sequence", () => {
    const result = listMessagesQuerySchema.safeParse({
      before_sequence: 10,
      after_sequence: 5,
    });
    expect(result.success).toBe(false);
  });
});
