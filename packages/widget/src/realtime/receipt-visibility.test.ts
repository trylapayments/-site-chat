import { describe, expect, it } from "vitest";

import type { MessageView } from "@site-chat/shared";

import { maxAgentMessageSequence, shouldMarkMessagesRead } from "./receipt-visibility";

describe("shouldMarkMessagesRead", () => {
  it("requires panel open and document visible", () => {
    expect(shouldMarkMessagesRead({ panelOpen: true, visibilityState: "visible" })).toBe(true);
    expect(shouldMarkMessagesRead({ panelOpen: true, visibilityState: "hidden" })).toBe(false);
    expect(shouldMarkMessagesRead({ panelOpen: false, visibilityState: "visible" })).toBe(false);
    expect(shouldMarkMessagesRead({ panelOpen: false, visibilityState: "hidden" })).toBe(false);
  });
});

describe("maxAgentMessageSequence", () => {
  it("ignores visitor/system and returns 0 for empty", () => {
    expect(maxAgentMessageSequence([])).toBe(0);

    const messages = [
      { senderType: "visitor", sequenceNumber: 5 },
      { senderType: "agent", sequenceNumber: 3 },
      { senderType: "system", sequenceNumber: 9 },
      { senderType: "agent", sequenceNumber: 7 },
    ] as MessageView[];

    expect(maxAgentMessageSequence(messages)).toBe(7);
  });
});
