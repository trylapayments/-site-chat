import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import { toAppRoute } from "@/lib/auth/redirect";
import { isRecoverySession, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    redirect(toAppRoute(AUTH_ROUTES.forgotPassword));
  }

  const recoverySession = await isRecoverySession(supabase);
  if (!recoverySession) {
    redirect(toAppRoute(AUTH_ROUTES.forgotPassword));
  }

  return <ResetPasswordForm />;
}
