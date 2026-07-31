import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  verifyRecoveryCookieValue,
  type RecoveryCookieValidationResult,
} from "@/lib/auth/recovery-cookie";

export type ResetPasswordGateDecision =
  | { action: "allow" }
  | { action: "redirect"; destination: typeof AUTH_ROUTES.forgotPassword }
  | {
      action: "clear_and_redirect";
      destination: typeof AUTH_ROUTES.forgotPassword;
    };

export type AppRecoveryGateDecision =
  | { action: "continue" }
  | { action: "redirect"; destination: typeof AUTH_ROUTES.resetPassword }
  | { action: "clear_and_continue" };

export function evaluateRecoveryCookie(
  rawValue: string | undefined,
  secret: string,
  options: {
    nowSeconds?: number;
    sessionId?: string;
  } = {},
): RecoveryCookieValidationResult {
  return verifyRecoveryCookieValue(rawValue, secret, options);
}

export function resolveResetPasswordGate(input: {
  hasAuthenticatedUser: boolean;
  cookieValidation: RecoveryCookieValidationResult;
}): ResetPasswordGateDecision {
  if (!input.hasAuthenticatedUser) {
    return { action: "redirect", destination: AUTH_ROUTES.forgotPassword };
  }

  if (input.cookieValidation.valid) {
    return { action: "allow" };
  }

  if (input.cookieValidation.reason === "missing") {
    return { action: "redirect", destination: AUTH_ROUTES.forgotPassword };
  }

  return {
    action: "clear_and_redirect",
    destination: AUTH_ROUTES.forgotPassword,
  };
}

export function resolveAppRecoveryGate(
  cookieValidation: RecoveryCookieValidationResult,
): AppRecoveryGateDecision {
  if (cookieValidation.valid) {
    return { action: "redirect", destination: AUTH_ROUTES.resetPassword };
  }

  if (cookieValidation.reason === "missing") {
    return { action: "continue" };
  }

  return { action: "clear_and_continue" };
}
