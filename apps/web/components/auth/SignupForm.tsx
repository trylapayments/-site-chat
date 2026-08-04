"use client";

import { useActionState } from "react";

import { AuthLink, AuthShell, FieldError } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUpAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/errors";

export function SignupForm() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    initialAuthActionState,
  );

  return (
    <AuthShell
      title="Create your account"
      description="Start using Site Chat with email and password."
      footer={
        <>
          Already have an account? <AuthLink href="/login">Sign in</AuthLink>
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
          />
          <FieldError message={state.fieldErrors?.email?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
          />
          <FieldError message={state.fieldErrors?.password?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
          <FieldError message={state.fieldErrors?.confirmPassword?.[0]} />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </AuthShell>
  );
}
