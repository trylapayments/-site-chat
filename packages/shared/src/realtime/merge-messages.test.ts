import { describe, expect, it } from "vitest";

import {
  createOptimisticMessage,
  hasSequenceGap,
  maxSequenceNumber,
  mergeMessages,
  toMessageViewFromWidgetBroadcast,
} from "./merge-messages.js";

describe("mergeMessages", () => {
  it("deduplicates by message id", () => {
    const existing = [
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000001",
        sequenceNumber: 1,
        senderType: "visitor",
        body: "Hi",
        createdAt: "2026-08-04T12:00:00.000Z",
        clientMessageId: null,
      }),
    ];

    const incoming = [
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000001",
        sequenceNumber: 1,
        senderType: "visitor",
        body: "Hi",
        createdAt: "2026-08-04T12:00:00.000Z",
        clientMessageId: null,
      }),
    ];

    expect(mergeMessages(existing, incoming)).toHaveLength(1);
  });

  it("reconciles optimistic messages by clientMessageId", () => {
    const pending = [
      createOptimisticMessage({
        tempId: "temp-1",
        clientMessageId: "11111111-1111-1111-1111-111111111111",
        body: "Hello",
        senderType: "visitor",
        nextSequence: 2,
      }),
    ];

    const incoming = [
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000002",
        sequenceNumber: 2,
        senderType: "visitor",
        body: "Hello",
        createdAt: "2026-08-04T12:00:01.000Z",
        clientMessageId: "11111111-1111-1111-1111-111111111111",
      }),
    ];

    const merged = mergeMessages([], incoming, pending);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("00000000-0000-4000-8000-000000000002");
    expect(merged[0]?.isOptimistic).toBeUndefined();
  });

  it("orders out-of-order events by sequence number", () => {
    const incoming = [
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000003",
        sequenceNumber: 3,
        senderType: "agent",
        body: "Third",
        createdAt: "2026-08-04T12:00:03.000Z",
        clientMessageId: null,
      }),
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000002",
        sequenceNumber: 2,
        senderType: "agent",
        body: "Second",
        createdAt: "2026-08-04T12:00:02.000Z",
        clientMessageId: null,
      }),
    ];

    const merged = mergeMessages([], incoming);
    expect(merged.map((item) => item.sequenceNumber)).toEqual([2, 3]);
  });
});

describe("sequence helpers", () => {
  it("detects sequence gaps", () => {
    const messages = [
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000001",
        sequenceNumber: 1,
        senderType: "visitor",
        body: "One",
        createdAt: "2026-08-04T12:00:00.000Z",
        clientMessageId: null,
      }),
      toMessageViewFromWidgetBroadcast({
        id: "00000000-0000-4000-8000-000000000003",
        sequenceNumber: 3,
        senderType: "agent",
        body: "Three",
        createdAt: "2026-08-04T12:00:02.000Z",
        clientMessageId: null,
      }),
    ];

    expect(hasSequenceGap(messages)).toBe(true);
    expect(maxSequenceNumber(messages)).toBe(3);
  });
});
