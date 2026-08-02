import Link from "next/link";

import { AuthLink, AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { AUTH_ERROR_CODES, getUserMessage } from "@/lib/auth/errors";

const ERROR_COPY: Record<
  string,
  { title: string; code: keyof typeof AUTH_ERROR_CODES }
> = {
  confirmation_expired: {
    title: "Confirmation link expired",
    code: "CONFIRMATION_EXPIRED",
  },
  recovery_expired: {
    title: "Reset link expired",
    code: "RECOVERY_EXPIRED",
  },
  invite_invalid: {
    title: "Invitation unavailable",
    code: "UNKNOWN",
  },
};

const INVITE_INVALID_MESSAGE =
  "This invitation is invalid, expired, or has already been used.";

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const copy = ERROR_COPY[params.code ?? ""] ?? {
    title: "Authentication error",
    code: "UNKNOWN" as const,
  };

  const message =
    params.code === "invite_invalid"
      ? INVITE_INVALID_MESSAGE
      : getUserMessage(AUTH_ERROR_CODES[copy.code]);

  return (
    <AuthShell title={copy.title} description={message}>
      <div className="flex flex-col gap-3">
        {params.code === "recovery_expired" ? (
          <Button asChild>
            <Link href="/forgot-password">Request a new reset link</Link>
          </Button>
        ) : null}
        {params.code === "confirmation_expired" ? (
          <Button asChild>
            <Link href="/check-email">Go to check email</Link>
          </Button>
        ) : null}
        <p className="text-sm">
          <AuthLink href="/login">Back to sign in</AuthLink>
        </p>
      </div>
    </AuthShell>
  );
}
