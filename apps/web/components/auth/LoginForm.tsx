"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

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

  const [showPassword, setShowPassword] = useState(false);

  return (
    <AuthShell
      title="Welcome back."
      description="Sign in to your workspace. Your next great conversation is waiting."
      footer={
        <>
          Don&apos;t have an account?{" "}
          <AuthLink href="/signup">Start your free trial</AuthLink>
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
            placeholder="you@company.com"
            required
            defaultValue={defaultEmail}
          />
          <FieldError message={state.fieldErrors?.email?.[0]} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              className="pr-12"
              autoComplete="current-password"
              placeholder="Enter your password"
              required
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => {
                setShowPassword(!showPassword);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-blue-500"
            >
              {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
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
