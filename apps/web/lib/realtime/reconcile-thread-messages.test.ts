import { describe, expect, it } from "vitest";

import type { MessageView } from "@site-chat/shared";

import {
  areMessageViewsEquivalent,
  reconcileThreadMessages,
} from "./reconcile-thread-messages";

function message(
  overrides: Partial<MessageView> & Pick<MessageView, "id" | "sequenceNumber">,
): MessageView {
  return {
    senderType: "visitor",
    senderLabel: "Visitor",
    body: "Hello",
    createdAt: "2024-08-06T08:55:00.000Z",
    clientMessageId: null,
    isInternal: false,
    ...overrides,
  };
}

describe("areMessageViewsEquivalent", () => {
  it("returns true for identical content with different array references", () => {
    const a = [message({ id: "m1", sequenceNumber: 1 })];
    const b = [message({ id: "m1", sequenceNumber: 1 })];

    expect(areMessageViewsEquivalent(a, b)).toBe(true);
    expect(a === b).toBe(false);
  });

  it("returns false when a field differs", () => {
    const a = [message({ id: "m1", sequenceNumber: 1, body: "A" })];
    const b = [message({ id: "m1", sequenceNumber: 1, body: "B" })];

    expect(areMessageViewsEquivalent(a, b)).toBe(false);
  });
});

describe("reconcileThreadMessages", () => {
  it("returns the same current reference when initialMessages is rematerialized with identical content", () => {
    const current = [message({ id: "m1", sequenceNumber: 1 })];
    const rematerialized = [message({ id: "m1", sequenceNumber: 1 })];

    const next = reconcileThreadMessages({
      conversationChanged: false,
      current,
      initialMessages: rematerialized,
    });

    expect(next).toBe(current);
  });

  it("resets to initialMessages when the conversation changes", () => {
    const current = [message({ id: "old", sequenceNumber: 1 })];
    const initialMessages = [message({ id: "new", sequenceNumber: 1 })];

    const next = reconcileThreadMessages({
      conversationChanged: true,
      current,
      initialMessages,
    });

    expect(next).toBe(initialMessages);
  });

  it("preserves optimistic / pending local messages", () => {
    const current = [
      message({
        id: "temp",
        sequenceNumber: 2,
        senderType: "agent",
        senderLabel: "Agent",
        body: "Sending",
        status: "pending",
        isOptimistic: true,
        clientMessageId: "c1",
      }),
    ];
    const initialMessages = [message({ id: "m1", sequenceNumber: 1 })];

    const next = reconcileThreadMessages({
      conversationChanged: false,
      current,
      initialMessages,
    });

    expect(next).toBe(current);
  });

  it("keeps local messages when local max sequence is ahead of server props", () => {
    const current = [
      message({ id: "m1", sequenceNumber: 1 }),
      message({ id: "m2", sequenceNumber: 2, body: "Live" }),
    ];
    const initialMessages = [message({ id: "m1", sequenceNumber: 1 })];

    const next = reconcileThreadMessages({
      conversationChanged: false,
      current,
      initialMessages,
    });

    expect(next).toBe(current);
  });

  it("adopts server initialMessages when they are ahead and not equivalent", () => {
    const current = [message({ id: "m1", sequenceNumber: 1 })];
    const initialMessages = [
      message({ id: "m1", sequenceNumber: 1 }),
      message({ id: "m2", sequenceNumber: 2, body: "From server" }),
    ];

    const next = reconcileThreadMessages({
      conversationChanged: false,
      current,
      initialMessages,
    });

    expect(next).toBe(initialMessages);
  });
});
