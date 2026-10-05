import { describe, expect, it } from "vitest";
import { shouldShowWaitingAcknowledgement } from "./waiting";

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
