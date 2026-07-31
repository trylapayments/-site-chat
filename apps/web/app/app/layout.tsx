import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/SignOutButton";
import { AUTH_ROUTES } from "@/lib/auth/constants";
import { buildLoginUrl, toAppRoute } from "@/lib/auth/redirect";
import { isEmailConfirmed, requireUser } from "@/lib/auth/session";
import {
  clearRecoveryCookie,
  readRecoveryCookieValidationForSession,
} from "@/lib/auth/recovery-cookie.server";
import { resolveAppRecoveryGate } from "@/lib/auth/recovery-gate";
import { createClient } from "@/lib/supabase/server";

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

  const recoveryGate = resolveAppRecoveryGate(
    await readRecoveryCookieValidationForSession(supabase),
  );

  if (recoveryGate.action === "clear_and_continue") {
    await clearRecoveryCookie();
  }

  if (recoveryGate.action === "redirect") {
    redirect(toAppRoute(recoveryGate.destination));
  }

  return (
    <div className="bg-background min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-semibold">Site Chat</p>
            <p className="text-muted-foreground text-sm">{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
