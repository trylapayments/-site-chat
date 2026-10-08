import { describe, expect, it } from "vitest";

import { buildConversationContext } from "./build-conversation-context";

describe("buildConversationContext", () => {
  it("orders messages deterministically by sequence, then time, then id", () => {
    const context = buildConversationContext({
      workspace: { id: "w1", name: "Acme" },
      messages: [
        {
          id: "b",
          sequenceNumber: 2,
          senderType: "agent",
          body: "second",
          createdAt: "2026-08-10T10:00:02Z",
        },
        {
          id: "a",
          sequenceNumber: 1,
          senderType: "visitor",
          body: "first",
          createdAt: "2026-08-10T10:00:01Z",
        },
        {
          id: "c",
          sequenceNumber: 2,
          senderType: "system",
          body: "tie-breaker",
          createdAt: "2026-08-10T10:00:02Z",
        },
      ],
    });

    expect(context.messages.map((message) => message.id)).toEqual(["a", "b", "c"]);
  });

  it("bounds context size to the recent message limit", () => {
    const context = buildConversationContext(
      {
        workspace: { id: "w1", name: "Acme" },
        messages: Array.from({ length: 30 }, (_, index) => ({
          id: `m-${String(index)}`,
          sequenceNumber: index + 1,
          senderType: "visitor" as const,
          body: `msg ${String(index)}`,
          createdAt: `2026-08-10T10:00:${String(index).padStart(2, "0")}Z`,
        })),
      },
      { messageLimit: 5 },
    );

    expect(context.messages).toHaveLength(5);
    expect(context.messages[0]?.body).toBe("msg 25");
    expect(context.messages.at(-1)?.body).toBe("msg 29");
  });

  it("does not include secrets and sanitizes bodies", () => {
    const context = buildConversationContext({
      workspace: { id: "w1", name: "Acme" },
      operator: { id: "op1", displayName: "Alex" },
      visitor: { displayName: "Sam" },
      messages: [
        {
          id: "m1",
          sequenceNumber: 1,
          senderType: "visitor",
          body: "hello\u0000<script>alert(1)</script>",
          createdAt: "2026-08-10T10:00:00Z",
        },
      ],
    });

    expect(JSON.stringify(context)).not.toContain("apiKey");
    expect(context.messages[0]?.body).toContain("<script>");
    expect(context.messages[0]?.body).not.toContain("\u0000");
  });
});
