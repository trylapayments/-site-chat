import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { readRecoveryGateContext } from "@/lib/auth/recovery-cookie.server";
import { resolveResetPasswordGate } from "@/lib/auth/recovery-gate";
import { buildRecoveryClearUrl } from "@/lib/auth/recovery-clear.server";
import { toAppRoute } from "@/lib/auth/redirect";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);
  const recoveryContext = await readRecoveryGateContext(supabase);
  const gate = resolveResetPasswordGate({
    hasAuthenticatedUser: Boolean(user),
    ...recoveryContext,
  });

  if (gate.action === "clear_via_handler") {
    redirect(
      toAppRoute(
        buildRecoveryClearUrl(gate.destination, env.AUTH_COOKIE_SECRET, {
          signOutRecoverySession: gate.signOutRecoverySession,
        }),
      ),
    );
  }

  if (gate.action === "redirect") {
    redirect(toAppRoute(gate.destination));
  }

  return <ResetPasswordForm />;
}
