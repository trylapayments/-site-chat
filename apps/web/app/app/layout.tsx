import { redirect } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/constants";
import { readRecoveryGateContext } from "@/lib/auth/recovery-cookie.server";
import { resolveAppRecoveryGate } from "@/lib/auth/recovery-gate";
import { buildRecoveryClearUrl } from "@/lib/auth/recovery-clear.server";
import { buildLoginUrl, toAppRoute } from "@/lib/auth/redirect";
import { isEmailConfirmed, requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env.server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { user } = await requireUser(supabase);

  if (!user) {
    redirect(toAppRoute(buildLoginUrl("/app")));
  }

  if (!isEmailConfirmed(user)) {
    redirect(
      toAppRoute(
        `${AUTH_ROUTES.checkEmail}?email=${encodeURIComponent(user.email ?? "")}`,
      ),
    );
  }

  const recoveryContext = await readRecoveryGateContext(supabase);
  const recoveryGate = resolveAppRecoveryGate(recoveryContext);

  if (recoveryGate.action === "clear_via_handler") {
    redirect(
      toAppRoute(
        buildRecoveryClearUrl(
          recoveryGate.destination,
          env.AUTH_COOKIE_SECRET,
          {
            signOutRecoverySession: recoveryGate.signOutRecoverySession,
          },
        ),
      ),
    );
  }

  if (recoveryGate.action === "redirect") {
    redirect(toAppRoute(recoveryGate.destination));
  }

  return <div className="bg-background min-h-screen">{children}</div>;
}
