import { SAFE_REDIRECT_FALLBACK } from "@/lib/auth/constants";
import { createRecoveryCleanupToken } from "@/lib/auth/recovery-cleanup-token";
import { sanitizeRecoveryClearDestination } from "@/lib/auth/redirect";

export function buildRecoveryClearUrl(
  destination: string,
  secret: string,
  options: {
    signOutRecoverySession?: boolean;
    nowSeconds?: number;
  } = {},
): string {
  const safeDestination =
    sanitizeRecoveryClearDestination(destination) ?? SAFE_REDIRECT_FALLBACK;
  const token = createRecoveryCleanupToken(secret, safeDestination, {
    signOut: options.signOutRecoverySession ?? false,
    nowSeconds: options.nowSeconds,
  });

  return `/auth/clear-recovery?destination=${encodeURIComponent(safeDestination)}&token=${encodeURIComponent(token)}`;
}
