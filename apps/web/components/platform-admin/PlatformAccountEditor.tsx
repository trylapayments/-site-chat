"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  changePlatformAccountEmail,
  deletePlatformAccount,
  type PlatformAccount,
} from "@/lib/platform-admin/account-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function PlatformAccountEditor({
  account,
}: {
  account: PlatformAccount;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"email" | "delete" | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  if (!account.email) return <span>No email account</span>;
  const expectedEmail = account.email;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => { setMode(mode === "email" ? null : "email"); }}
        >
          Change email
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-700"
          onClick={() => { setMode(mode === "delete" ? null : "delete"); }}
        >
          Delete account
        </Button>
      </div>
      {mode && (
        <section className="rounded-lg border bg-slate-50 p-4 space-y-3">
          <h3 className="font-semibold">
            {mode === "email"
              ? "Change login email"
              : "Permanently delete account"}
          </h3>
          {mode === "email" ? (
            <>
              <p className="text-xs text-muted-foreground">
                The new email will be confirmed by Mill administration. The
                previous email becomes available for registration.
              </p>
              <label className="block text-xs">
                New email
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); }}
                  disabled={pending}
                />
              </label>
            </>
          ) : (
            <>
              <p className="text-xs text-red-700">
                This permanently removes the login account. Personal companies
                are removed from the portal. Shared companies and conversation
                history remain. Connected subscriptions must be cancelled first.
              </p>
              <ul className="text-xs">
                {account.workspaces.map((w) => (
                  <li key={w.id}>
                    {w.name}:{" "}
                    {w.personal
                      ? "personal company — remove"
                      : "shared company — retain"}
                  </li>
                ))}
              </ul>
              <label className="block text-xs">
                Type DELETE {expectedEmail}
                <Input
                  value={confirmation}
                  onChange={(e) => { setConfirmation(e.target.value); }}
                  disabled={pending}
                />
              </label>
            </>
          )}
          <label className="block text-xs">
            Reason
            <Input
              value={reason}
              onChange={(e) => { setReason(e.target.value); }}
              disabled={pending}
            />
          </label>
          <Button
            disabled={
              pending ||
              reason.trim().length < 3 ||
              (mode === "email"
                ? !email
                : confirmation !== `DELETE ${expectedEmail}`)
            }
            onClick={() => {
              if (
                !window.confirm(
                  mode === "email"
                    ? `Change ${expectedEmail} to ${email}?`
                    : `Permanently delete ${expectedEmail} and remove its personal companies?`,
                )
              )
                return;
              start(async () => {
                try {
                  const result =
                    mode === "email"
                      ? await changePlatformAccountEmail({
                          userId: account.id,
                          expectedEmail,
                          email,
                          reason,
                        })
                      : await deletePlatformAccount({
                          userId: account.id,
                          expectedEmail,
                          reason,
                          confirmation,
                        });
                  setMessage(result.message);
                  if (result.success) {
                    setMode(null);
                    router.refresh();
                  }
                } catch {
                  setMessage("Unable to save. Refresh and try again.");
                }
              });
            }}
          >
            {pending
              ? "Saving…"
              : mode === "email"
                ? "Save email"
                : "Permanently delete"}
          </Button>
        </section>
      )}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </div>
  );
}
