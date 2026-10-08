import { describe, expect, it } from "vitest";
import { unansweredSince, shouldShowWaitingAcknowledgement } from "./waiting";

describe("visitor waiting acknowledgement", () => {
  it("does not claim a failed or pending message reached the team", () => {
    expect(shouldShowWaitingAcknowledgement([])).toBe(false);
    expect(shouldShowWaitingAcknowledgement([{ senderType: "visitor", isOptimistic: true }])).toBe(
      false,
    );
    expect(shouldShowWaitingAcknowledgement([{ senderType: "visitor", status: "failed" }])).toBe(
      false,
    );
  });
  it("survives loading accepted visitor messages, without requiring a local send", () => {
    expect(shouldShowWaitingAcknowledgement([{ senderType: "visitor" }])).toBe(true);
  });
  it("does not return after the operator has joined, or for operator invitations", () => {
    expect(shouldShowWaitingAcknowledgement([{ senderType: "agent" }])).toBe(false);
    expect(
      shouldShowWaitingAcknowledgement([
        { senderType: "visitor" },
        { senderType: "agent" },
        { senderType: "visitor" },
      ]),
    ).toBe(false);
  });
});

describe("unanswered email timer", () => {
  const visitor = { senderType: "visitor", sequenceNumber: 1, createdAt: "2026-10-07T10:00:00Z" };
  it("keeps the earliest durable waiting time after reload and further messages", () => {
    expect(
      unansweredSince([
        visitor,
        { ...visitor, sequenceNumber: 2, createdAt: "2026-10-07T10:01:00Z" },
      ]),
    ).toBe(Date.parse(visitor.createdAt));
  });
  it("never returns after the first public reply, including subsequent visitor messages", () => {
    const reply = { ...visitor, senderType: "agent", sequenceNumber: 2 };
    expect(unansweredSince([visitor, reply])).toBeNull();
    expect(
      unansweredSince([
        visitor,
        reply,
        { ...visitor, sequenceNumber: 3, createdAt: "2026-10-07T10:02:00Z" },
      ]),
    ).toBeNull();
  });
  it("does not use an older form event as the start of a new message wait", () => {
    expect(
      unansweredSince([
        {
          ...visitor,
          senderType: "system",
          body: "Chat request submitted.",
          sequenceNumber: 0,
          createdAt: "2026-10-07T09:00:00Z",
        },
        visitor,
      ]),
    ).toBe(Date.parse(visitor.createdAt));
  });
  it("never starts from failed, optimistic, internal, or invalid timestamp messages", () => {
    expect(
      unansweredSince([
        { ...visitor, status: "failed" },
        { ...visitor, isOptimistic: true },
      ]),
    ).toBeNull();
    expect(unansweredSince([{ ...visitor, createdAt: "invalid" }])).toBeNull();
    expect(
      unansweredSince([
        visitor,
        { ...visitor, senderType: "agent", sequenceNumber: 2, isInternal: true },
      ]),
    ).toBe(Date.parse(visitor.createdAt));
  });
});

it("form completion alone never starts waiting or the email timer", () => {
  const form = { senderType: "system", body: "Chat request submitted.", sequenceNumber: 1, createdAt: "2026-10-08T22:00:00Z" };
  expect(shouldShowWaitingAcknowledgement([form])).toBe(false);
  expect(unansweredSince([form])).toBeNull();
});
