import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  verifyRecoveryCookieValue,
  type RecoveryCookieValidationResult,
} from "@/lib/auth/recovery-cookie";

export type RecoveryClearViaHandlerDecision = {
  action: "clear_via_handler";
  destination: string;
  signOutRecoverySession: boolean;
};

export type ResetPasswordGateDecision =
  | { action: "allow" }
  | { action: "redirect"; destination: typeof AUTH_ROUTES.forgotPassword }
  | RecoveryClearViaHandlerDecision;

export type AppRecoveryGateDecision =
  | { action: "continue" }
  | { action: "redirect"; destination: typeof AUTH_ROUTES.resetPassword }
  | RecoveryClearViaHandlerDecision;

const RECOVERY_EXPIRED_DESTINATION = `${AUTH_ROUTES.authError}?code=recovery_expired`;

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
  expiredSessionBindingMatches?: boolean;
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

  if (
    input.cookieValidation.reason === "expired" &&
    input.expiredSessionBindingMatches
  ) {
    return {
      action: "clear_via_handler",
      destination: RECOVERY_EXPIRED_DESTINATION,
      signOutRecoverySession: true,
    };
  }

  return {
    action: "clear_via_handler",
    destination: AUTH_ROUTES.forgotPassword,
    signOutRecoverySession: false,
  };
}

export function resolveAppRecoveryGate(input: {
  cookieValidation: RecoveryCookieValidationResult;
  expiredSessionBindingMatches?: boolean;
}): AppRecoveryGateDecision {
  const { cookieValidation, expiredSessionBindingMatches = false } = input;

  if (cookieValidation.valid) {
    return { action: "redirect", destination: AUTH_ROUTES.resetPassword };
  }

  if (cookieValidation.reason === "missing") {
    return { action: "continue" };
  }

  if (cookieValidation.reason === "expired" && expiredSessionBindingMatches) {
    return {
      action: "clear_via_handler",
      destination: RECOVERY_EXPIRED_DESTINATION,
      signOutRecoverySession: true,
    };
  }

  return {
    action: "clear_via_handler",
    destination: AUTH_ROUTES.app,
    signOutRecoverySession: false,
  };
}

export { RECOVERY_EXPIRED_DESTINATION };
