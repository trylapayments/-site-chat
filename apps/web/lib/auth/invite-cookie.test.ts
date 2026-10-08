import { describe, expect, it } from "vitest";

import {
  createInviteCookieValue,
  INVITE_COOKIE_MAX_AGE_SECONDS,
  verifyInviteCookieValue,
} from "@/lib/auth/invite-cookie";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";

describe("invite cookie", () => {
  it("round-trips a signed invitation token", () => {
    const value = createInviteCookieValue(
      TEST_SECRET,
      "invite-token-value",
      1_700_000_000,
    );
    const result = verifyInviteCookieValue(value, TEST_SECRET, {
      nowSeconds: 1_700_000_000,
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.invitation_token).toBe("invite-token-value");
      expect(result.payload.purpose).toBe("workspace_invitation");
    }
  });

  it("rejects tampered cookies", () => {
    const value = createInviteCookieValue(
      TEST_SECRET,
      "invite-token-value",
      1_700_000_000,
    );
    const tampered = `${value}x`;

    expect(verifyInviteCookieValue(tampered, TEST_SECRET).valid).toBe(false);
  });

  it("rejects expired cookies", () => {
    const value = createInviteCookieValue(
      TEST_SECRET,
      "invite-token-value",
      1_700_000_000,
    );

    expect(
      verifyInviteCookieValue(value, TEST_SECRET, {
        nowSeconds: 1_700_000_000 + INVITE_COOKIE_MAX_AGE_SECONDS + 1,
      }).valid,
    ).toBe(false);
  });
});
