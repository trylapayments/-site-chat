import { describe, expect, it } from "vitest";

import {
  applyRemoteReceiptEvent,
  buildReceiptBroadcastPayload,
  computeUnreadAfterMarkRead,
  computeUnreadAfterVisitorMessage,
  deriveMessageReceiptStatus,
  mergeReceiptCursors,
  parseReceiptBroadcastPayload,
  unreadTotalFromConversations,
} from "./receipts.js";

describe("deriveMessageReceiptStatus", () => {
  it("derives sent → delivered → seen from peer cursors", () => {
    const peer = { lastDeliveredSequence: 2, lastReadSequence: 1 };

    expect(deriveMessageReceiptStatus({ sequenceNumber: 1, peer })).toBe("seen");
    expect(deriveMessageReceiptStatus({ sequenceNumber: 2, peer })).toBe("delivered");
    expect(deriveMessageReceiptStatus({ sequenceNumber: 3, peer })).toBe("sent");
  });

  it("never regresses from seen when delivered watermark lags read", () => {
    const peer = { lastDeliveredSequence: 1, lastReadSequence: 3 };
    expect(deriveMessageReceiptStatus({ sequenceNumber: 2, peer })).toBe("seen");
    expect(deriveMessageReceiptStatus({ sequenceNumber: 3, peer })).toBe("seen");
  });
});

describe("mergeReceiptCursors", () => {
  it("is monotonic and coalesces read into delivered", () => {
    const { next, advanced } = mergeReceiptCursors(
      { lastDeliveredSequence: 2, lastReadSequence: 1 },
      { lastReadSequence: 4 },
    );

    expect(advanced).toBe(true);
    expect(next).toEqual({ lastDeliveredSequence: 4, lastReadSequence: 4 });
  });

  it("reports no advance for duplicate / lower watermarks", () => {
    const { advanced } = mergeReceiptCursors(
      { lastDeliveredSequence: 5, lastReadSequence: 5 },
      { lastDeliveredSequence: 3, lastReadSequence: 4 },
    );
    expect(advanced).toBe(false);
  });
});

describe("applyRemoteReceiptEvent", () => {
  it("suppresses local echo and wrong role", () => {
    const cursors = { lastDeliveredSequence: 1, lastReadSequence: 0 };
    const payload = buildReceiptBroadcastPayload({
      actorRole: "visitor",
      actorKey: "me",
      kind: "read",
      lastDeliveredSequence: 9,
      lastReadSequence: 9,
    });

    expect(
      applyRemoteReceiptEvent({
        cursors,
        payload,
        localActorKey: "me",
      }).advanced,
    ).toBe(false);

    expect(
      applyRemoteReceiptEvent({
        cursors,
        payload,
        expectedRole: "operator",
      }).advanced,
    ).toBe(false);
  });

  it("applies peer advances", () => {
    const payload = buildReceiptBroadcastPayload({
      actorRole: "visitor",
      actorKey: "vis_1",
      kind: "delivered",
      lastDeliveredSequence: 3,
      lastReadSequence: 0,
    });

    const result = applyRemoteReceiptEvent({
      cursors: { lastDeliveredSequence: 1, lastReadSequence: 0 },
      payload,
      expectedRole: "visitor",
    });

    expect(result.advanced).toBe(true);
    expect(result.cursors.lastDeliveredSequence).toBe(3);
  });
});

describe("receipt broadcast schema", () => {
  it("rejects unknown fields", () => {
    expect(
      parseReceiptBroadcastPayload({
        v: 1,
        actorRole: "visitor",
        actorKey: "a",
        kind: "read",
        lastDeliveredSequence: 1,
        lastReadSequence: 1,
        extra: true,
      }),
    ).toBeNull();
  });
});

describe("unread helpers", () => {
  it("increments and clears unread in O(1)", () => {
    expect(computeUnreadAfterVisitorMessage(2)).toBe(3);
    expect(computeUnreadAfterMarkRead({ currentUnread: 4, cleared: true })).toBe(0);
    expect(
      computeUnreadAfterMarkRead({
        currentUnread: 4,
        cleared: false,
        remainingUnread: 1,
      }),
    ).toBe(1);
  });

  it("sums conversation unread for global badge", () => {
    expect(
      unreadTotalFromConversations([
        { unread_count: 2 },
        { unread_count: 0 },
        { has_unread: true },
      ]),
    ).toBe(3);
  });
});
