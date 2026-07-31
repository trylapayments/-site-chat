"use server";

import {
  forgotPasswordSchema,
  resendConfirmationSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@site-chat/shared";
import { redirect } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import {
  AUTH_ERROR_CODES,
  getUserMessage,
  initialAuthActionState,
  type AuthActionState,
} from "@/lib/auth/errors";
import { resolveSafeRedirectPath, toAppRoute } from "@/lib/auth/redirect";
import { isEmailConfirmed, requireUser } from "@/lib/auth/session";
import {
  clearRecoveryCookie,
  readRecoveryCookieValidationForSession,
} from "@/lib/auth/recovery-cookie.server";
import { resolveResetPasswordGate } from "@/lib/auth/recovery-gate";
import { createClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { revalidatePath } from "next/cache";

function mapFieldErrors(
  issues: { path: PropertyKey[]; message: string }[],
): Record<string, string[]> {
  return issues.reduce<Record<string, string[]>>((acc, issue) => {
    const key = String(issue.path[0] ?? "form");
    acc[key] ??= [];
    acc[key].push(issue.message);
    return acc;
  }, {});
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    email: getFormString(formData, "email"),
    password: getFormString(formData, "password"),
    confirmPassword: getFormString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  const supabase = await createClient();
  const redirectTo = `${clientEnv.NEXT_PUBLIC_APP_URL}${AUTH_ROUTES.authCallback}`;

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  if (error) {
    // Generic response to reduce account enumeration.
    redirect(
      toAppRoute(
        `${AUTH_ROUTES.checkEmail}?email=${encodeURIComponent(parsed.data.email)}`,
      ),
    );
  }

  redirect(
    toAppRoute(
      `${AUTH_ROUTES.checkEmail}?email=${encodeURIComponent(parsed.data.email)}`,
    ),
  );
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: getFormString(formData, "email"),
    password: getFormString(formData, "password"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      success: false,
      errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      message: getUserMessage(AUTH_ERROR_CODES.INVALID_CREDENTIALS),
    };
  }

  const user = data.user;

  if (!isEmailConfirmed(user)) {
    redirect(
      toAppRoute(
        `${AUTH_ROUTES.checkEmail}?email=${encodeURIComponent(parsed.data.email)}`,
      ),
    );
  }

  redirect(
    toAppRoute(resolveSafeRedirectPath(getFormString(formData, "next"))),
  );
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await clearRecoveryCookie();
  await supabase.auth.signOut();
  redirect(toAppRoute(AUTH_ROUTES.login));
}

export async function requestPasswordResetAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: getFormString(formData, "email"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  const supabase = await createClient();
  const redirectTo = `${clientEnv.NEXT_PUBLIC_APP_URL}${AUTH_ROUTES.authRecovery}`;

  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo,
  });

  return {
    success: true,
    errorCode: AUTH_ERROR_CODES.RESET_EMAIL_SENT,
    message: getUserMessage(AUTH_ERROR_CODES.RESET_EMAIL_SENT),
  };
}

export async function updatePasswordAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: getFormString(formData, "password"),
    confirmPassword: getFormString(formData, "confirmPassword"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  const cookieValidation =
    await readRecoveryCookieValidationForSession(supabase);
  const gate = resolveResetPasswordGate({
    hasAuthenticatedUser: Boolean(user),
    cookieValidation,
  });

  if (gate.action === "clear_and_redirect") {
    await clearRecoveryCookie();
    redirect(toAppRoute(gate.destination));
  }

  if (gate.action === "redirect") {
    redirect(toAppRoute(gate.destination));
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });

  if (error) {
    return {
      success: false,
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  await supabase.auth.refreshSession();
  await clearRecoveryCookie();
  revalidatePath(AUTH_ROUTES.app);
  redirect(toAppRoute(AUTH_ROUTES.app));
}

export async function resendConfirmationEmailAction(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = resendConfirmationSchema.safeParse({
    email: getFormString(formData, "email"),
  });

  if (!parsed.success) {
    return {
      success: false,
      fieldErrors: mapFieldErrors(parsed.error.issues),
      errorCode: AUTH_ERROR_CODES.UNKNOWN,
      message: getUserMessage(AUTH_ERROR_CODES.UNKNOWN),
    };
  }

  const supabase = await createClient();
  const redirectTo = `${clientEnv.NEXT_PUBLIC_APP_URL}${AUTH_ROUTES.authCallback}`;

  await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: {
      emailRedirectTo: redirectTo,
    },
  });

  return {
    success: true,
    errorCode: AUTH_ERROR_CODES.CONFIRMATION_SENT,
    message: getUserMessage(AUTH_ERROR_CODES.CONFIRMATION_SENT),
  };
}

export { initialAuthActionState };
