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
import { signInAction } from "@/lib/auth/actions";
import { initialAuthActionState } from "@/lib/auth/errors";

export function LoginForm({
  nextPath,
  defaultEmail,
}: {
  nextPath?: string;
  defaultEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialAuthActionState,
  );

  return (
    <AuthShell
      title="Sign in"
      description="Access your Site Chat workspace."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <AuthLink href="/signup">Sign up</AuthLink>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}
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
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <FieldError message={state.fieldErrors?.password?.[0]} />
        </div>
        <FormMessage message={state.message} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>
      <p className="text-sm">
        <AuthLink href="/forgot-password">Forgot your password?</AuthLink>
      </p>
    </AuthShell>
  );
}
