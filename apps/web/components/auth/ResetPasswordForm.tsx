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
import {
  initialAuthActionState,
  updatePasswordAction,
} from "@/lib/auth/actions";

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePasswordAction,
    initialAuthActionState,
  );

  return (
    <AuthShell
      title="Choose a new password"
      description="Your recovery session is active. Set a new password to continue."
      footer={
        <>
          Need a new link?{" "}
          <AuthLink href="/forgot-password">Request another reset</AuthLink>
        </>
      }
    >
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
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
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
          <FieldError message={state.fieldErrors?.confirmPassword?.[0]} />
        </div>
        <FormMessage message={state.message} />
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Updating..." : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
