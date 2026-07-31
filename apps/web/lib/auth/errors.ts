export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_NOT_CONFIRMED: "EMAIL_NOT_CONFIRMED",
  WEAK_PASSWORD: "WEAK_PASSWORD",
  RESET_EMAIL_SENT: "RESET_EMAIL_SENT",
  RECOVERY_EXPIRED: "RECOVERY_EXPIRED",
  CONFIRMATION_EXPIRED: "CONFIRMATION_EXPIRED",
  CONFIRMATION_SENT: "CONFIRMATION_SENT",
  RECOVERY_IN_PROGRESS: "RECOVERY_IN_PROGRESS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  UNKNOWN: "UNKNOWN",
} as const;

export type AuthErrorCode =
  (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

const USER_MESSAGES: Record<AuthErrorCode, string> = {
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: "Invalid email or password.",
  [AUTH_ERROR_CODES.EMAIL_NOT_CONFIRMED]:
    "Check your email to confirm your account.",
  [AUTH_ERROR_CODES.WEAK_PASSWORD]: "Password must be at least 10 characters.",
  [AUTH_ERROR_CODES.RESET_EMAIL_SENT]:
    "If an account exists, we sent a reset link.",
  [AUTH_ERROR_CODES.RECOVERY_EXPIRED]: "This reset link has expired.",
  [AUTH_ERROR_CODES.CONFIRMATION_EXPIRED]:
    "This confirmation link has expired.",
  [AUTH_ERROR_CODES.CONFIRMATION_SENT]:
    "If an account exists, check your email to continue.",
  [AUTH_ERROR_CODES.RECOVERY_IN_PROGRESS]:
    "Complete your password reset to continue.",
  [AUTH_ERROR_CODES.SESSION_EXPIRED]:
    "Your session has expired. Please sign in again.",
  [AUTH_ERROR_CODES.UNKNOWN]: "Something went wrong. Please try again.",
};

export function getUserMessage(code: AuthErrorCode): string {
  return USER_MESSAGES[code];
}

export type AuthActionState = {
  success: boolean;
  message?: string;
  errorCode?: AuthErrorCode;
  fieldErrors?: Record<string, string[]>;
};

export const initialAuthActionState: AuthActionState = {
  success: false,
};
