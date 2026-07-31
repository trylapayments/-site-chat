import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { readRecoveryCookieValidationForSession } from "@/lib/auth/recovery-cookie.server";
import { resolveResetPasswordGate } from "@/lib/auth/recovery-gate";
import { buildRecoveryClearUrl, toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  const cookieValidation =
    await readRecoveryCookieValidationForSession(supabase);
  const gate = resolveResetPasswordGate({
    hasAuthenticatedUser: Boolean(user),
    cookieValidation,
  });

  if (gate.action === "clear_via_handler") {
    redirect(toAppRoute(buildRecoveryClearUrl(gate.destination)));
  }

  if (gate.action === "redirect") {
    redirect(toAppRoute(gate.destination));
  }

  return <ResetPasswordForm />;
}
