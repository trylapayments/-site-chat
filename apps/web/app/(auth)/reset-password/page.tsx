import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import {
  clearRecoveryCookie,
  readRecoveryCookieValidation,
} from "@/lib/auth/recovery-cookie.server";
import { resolveResetPasswordGate } from "@/lib/auth/recovery-gate";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  const cookieValidation = await readRecoveryCookieValidation();
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

  return <ResetPasswordForm />;
}
