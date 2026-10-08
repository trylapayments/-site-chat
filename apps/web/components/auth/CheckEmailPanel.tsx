"use client";

import { useActionState } from "react";

import {
  AuthLink,
  AuthShell,
  FieldError,
  FormMessage,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { resendConfirmationEmailAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/errors";

function maskEmail(email: string): string {
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) {
    return "your email";
  }

  const visible = localPart.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(localPart.length - 1, 2))}@${domain}`;
}

export function CheckEmailPanel({ email }: { email?: string }) {
  const [state, formAction, pending] = useActionState(
    resendConfirmationEmailAction,
    initialAuthActionState,
  );

  const masked = email ? maskEmail(email) : "your email";

  return (
    <AuthShell
      title="Check your email"
      description={`If an account exists, we sent a confirmation link to ${masked}.`}
      footer={
        <>
          Wrong address? <AuthLink href="/signup">Try again</AuthLink>
        </>
      }
    >
      {email ? (
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="email" value={email} />
          <FormMessage message={state.message} />
          <FieldError message={state.fieldErrors?.email?.[0]} />
          <Button
            type="submit"
            variant="outline"
            className="w-full"
            disabled={pending}
          >
            {pending ? "Sending..." : "Resend confirmation email"}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">
          Open the link in your inbox to confirm your account, then sign in.
        </p>
      )}
      <p className="text-sm">
        <AuthLink href="/login">Back to sign in</AuthLink>
      </p>
    </AuthShell>
  );
}
