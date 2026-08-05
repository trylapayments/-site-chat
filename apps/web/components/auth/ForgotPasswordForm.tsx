"use client";

import { useActionState } from "react";

import {
  AuthLink,
  AuthShell,
  FieldError,
  FormMessage,
} from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/errors";

export function ForgotPasswordForm({
  defaultEmail,
}: {
  defaultEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialAuthActionState,
  );

  return (
    <AuthShell
      title="Reset your password"
      description="We will email you a secure reset link."
      footer={
        <>
          Remember your password? <AuthLink href="/login">Sign in</AuthLink>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={defaultEmail}
          />
          <FieldError message={state.fieldErrors?.email?.[0]} />
        </div>
        <FormMessage message={state.success ? state.message : state.message} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending..." : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
