import { describe, expect, it } from "vitest";

import {
  claimsIndicateRecoverySession,
  isRecoveryExchangePermitted,
} from "@/lib/auth/recovery-exchange";

describe("recovery exchange AMR verification", () => {
  it("permits only recovery sessions with a session_id", () => {
    expect(
      isRecoveryExchangePermitted({
        session_id: "bdd743e0-4844-49c5-b3b2-2cb4632a0b87",
        amr: [{ method: "recovery", timestamp: 1_700_000_000 }],
      } as never),
    ).toBe(true);
  });

  it("rejects normal password confirmation sessions sent to /auth/recovery", () => {
    const passwordClaims = {
      session_id: "1c574637-81d9-478f-b8a2-08fe28a93bb5",
      amr: [{ method: "password", timestamp: 1_700_000_000 }],
    } as never;

    expect(claimsIndicateRecoverySession(passwordClaims)).toBe(false);
    expect(isRecoveryExchangePermitted(passwordClaims)).toBe(false);
  });

  it("rejects signup confirmation sessions without recovery AMR", () => {
    const signupClaims = {
      session_id: "1c574637-81d9-478f-b8a2-08fe28a93bb5",
      amr: [{ method: "otp", timestamp: 1_700_000_000 }],
    } as never;

    expect(isRecoveryExchangePermitted(signupClaims)).toBe(false);
  });
});
