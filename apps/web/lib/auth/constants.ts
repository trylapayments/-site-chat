/** Application route paths used by auth flows. */
export const AUTH_ROUTES = {
  login: "/login",
  signup: "/signup",
  forgotPassword: "/forgot-password",
  resetPassword: "/reset-password",
  checkEmail: "/check-email",
  authError: "/auth-error",
  authCallback: "/auth/callback",
  authRecovery: "/auth/recovery",
  authClearRecovery: "/auth/clear-recovery",
  inviteClear: "/invite/clear",
  app: "/app",
} as const;

/** Relative path prefixes allowed for post-auth redirects. */
export const SAFE_REDIRECT_PREFIXES = ["/app/", "/invite/"] as const;

export const SAFE_REDIRECT_FALLBACK = AUTH_ROUTES.app;

/** Maximum length for sanitized redirect paths. */
export const MAX_REDIRECT_PATH_LENGTH = 2048;
