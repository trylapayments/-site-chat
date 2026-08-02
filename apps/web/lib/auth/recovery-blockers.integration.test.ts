import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRecoveryCleanupToken,
  verifyRecoveryCleanupToken,
} from "@/lib/auth/recovery-cleanup-token";
import {
  createRecoveryCookieValue,
  RECOVERY_COOKIE_NAME,
  verifyExpiredRecoveryCookieBinding,
  verifyRecoveryCookieValue,
} from "@/lib/auth/recovery-cookie";
import {
  RECOVERY_EXPIRED_DESTINATION,
  resolveAppRecoveryGate,
} from "@/lib/auth/recovery-gate";
import { buildRecoveryClearUrl } from "@/lib/auth/recovery-clear.server";

const TEST_SECRET = "test-auth-cookie-secret-min-32-characters";
const SESSION_A = "bdd743e0-4844-49c5-b3b2-2cb4632a0b87";
const NOW = Math.floor(Date.now() / 1000);

const signOutMock = vi.fn(() => ({ error: null }));
const exchangeCodeForSessionMock = vi.fn(() => ({ error: null }));
const getClaimsMock = vi.fn(() => ({
  data: {
    claims: {
      session_id: SESSION_A,
      amr: [{ method: "recovery" }],
    },
  },
  error: null,
}));

vi.mock("@/lib/env", () => ({
  env: {
    AUTH_COOKIE_SECRET: TEST_SECRET,
    NODE_ENV: "test",
  },
  clientEnv: {
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signOut: signOutMock,
        exchangeCodeForSession: exchangeCodeForSessionMock,
        getClaims: getClaimsMock,
      },
    }),
  ),
}));

const resolveAuthenticatedDestinationMock = vi.fn((_nextPath?: string | null) =>
  Promise.resolve("/app"),
);

vi.mock("@/lib/workspace/redirect.server", () => ({
  resolveAuthenticatedDestination: (nextPath?: string | null) =>
    resolveAuthenticatedDestinationMock(nextPath),
  getWorkspaceContext: vi.fn(),
  redirectAuthenticatedUser: vi.fn(),
}));

describe("recovery blocker integration", () => {
  beforeEach(() => {
    signOutMock.mockClear();
    exchangeCodeForSessionMock.mockClear();
    getClaimsMock.mockClear();
    resolveAuthenticatedDestinationMock.mockImplementation(
      (_nextPath?: string | null) => Promise.resolve("/app"),
    );
    exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    getClaimsMock.mockResolvedValue({
      data: {
        claims: {
          session_id: SESSION_A,
          amr: [{ method: "recovery" }],
        },
      },
      error: null,
    });
  });

  describe("Blocker #1: CSRF-protected /auth/clear-recovery", () => {
    it("rejects requests without a cleanup token and does not clear cookies", async () => {
      const { GET } = await import("@/app/auth/clear-recovery/route");
      const request = new NextRequest(
        "http://localhost:3000/auth/clear-recovery?destination=%2Fapp",
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)).toBeUndefined();
      expect(signOutMock).not.toHaveBeenCalled();
    });

    it("rejects tampered cleanup tokens without clearing cookies", async () => {
      const { GET } = await import("@/app/auth/clear-recovery/route");
      const token = `${createRecoveryCleanupToken(TEST_SECRET, "/app", {
        nowSeconds: NOW,
      })}tampered`;
      const request = new NextRequest(
        `http://localhost:3000/auth/clear-recovery?destination=%2Fapp&token=${encodeURIComponent(token)}`,
      );

      const response = await GET(request);

      expect(response.status).toBe(403);
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)).toBeUndefined();
    });

    it("clears sc_recovery only when a valid server-minted token is supplied", async () => {
      const { GET } = await import("@/app/auth/clear-recovery/route");
      const token = createRecoveryCleanupToken(TEST_SECRET, "/app", {
        nowSeconds: NOW,
      });
      const request = new NextRequest(
        `http://localhost:3000/auth/clear-recovery?destination=%2Fapp&token=${encodeURIComponent(token)}`,
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/app",
      );
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)?.value).toBe("");
    });

    it("mints cleanup tokens only through buildRecoveryClearUrl", () => {
      const url = buildRecoveryClearUrl("/app", TEST_SECRET, {
        nowSeconds: NOW,
      });
      const token = new URL(`http://localhost:3000${url}`).searchParams.get(
        "token",
      );

      expect(
        verifyRecoveryCleanupToken(token, TEST_SECRET, {
          nowSeconds: NOW + 10,
        }),
      ).toEqual({
        valid: true,
        destination: "/app",
        signOut: false,
      });
    });
  });

  describe("Blocker #2: expired recovery cookie cannot reach /app", () => {
    it("routes expired session-bound recovery cookies to recovery_expired with sign-out", () => {
      const cookie = createRecoveryCookieValue(TEST_SECRET, SESSION_A, NOW);
      const decision = resolveAppRecoveryGate({
        cookieValidation: verifyRecoveryCookieValue(cookie, TEST_SECRET, {
          nowSeconds: NOW + 901,
          sessionId: SESSION_A,
        }),
        expiredSessionBindingMatches: verifyExpiredRecoveryCookieBinding(
          cookie,
          TEST_SECRET,
          SESSION_A,
        ),
      });

      expect(decision).toEqual({
        action: "clear_via_handler",
        destination: RECOVERY_EXPIRED_DESTINATION,
        signOutRecoverySession: true,
      });
    });

    it("terminates the recovery session when clearing an expired recovery cookie", async () => {
      const { GET } = await import("@/app/auth/clear-recovery/route");
      const token = createRecoveryCleanupToken(
        TEST_SECRET,
        RECOVERY_EXPIRED_DESTINATION,
        {
          signOut: true,
          nowSeconds: NOW,
        },
      );
      const request = new NextRequest(
        `http://localhost:3000/auth/clear-recovery?destination=${encodeURIComponent(RECOVERY_EXPIRED_DESTINATION)}&token=${encodeURIComponent(token)}`,
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/auth-error?code=recovery_expired",
      );
      expect(signOutMock).toHaveBeenCalledTimes(1);
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)?.value).toBe("");
    });
  });

  describe("Blocker #3: /auth/callback recovery exchanges mirror /auth/recovery", () => {
    it("detects recovery sessions after exchange and routes to reset-password with sc_recovery", async () => {
      const { GET } = await import("@/app/auth/callback/route");
      const request = new NextRequest(
        "http://localhost:3000/auth/callback?code=recovery-code&next=%2Fapp",
      );

      const response = await GET(request);

      expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("recovery-code");
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/reset-password",
      );
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)?.value).toBeTruthy();
    });

    it("continues non-recovery callback exchanges to the safe next destination", async () => {
      getClaimsMock.mockResolvedValue({
        data: {
          claims: {
            session_id: SESSION_A,
            amr: [{ method: "password" }],
          },
        },
        error: null,
      });

      const { GET } = await import("@/app/auth/callback/route");
      const request = new NextRequest(
        "http://localhost:3000/auth/callback?code=signup-code&next=%2Fapp",
      );

      const response = await GET(request);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "http://localhost:3000/app",
      );
      expect(resolveAuthenticatedDestinationMock).toHaveBeenCalledWith("/app");
      expect(response.cookies.get(RECOVERY_COOKIE_NAME)).toBeUndefined();
    });
  });
});
