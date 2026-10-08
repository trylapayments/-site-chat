"use client";
import { useState, useTransition } from "react";
import { deleteOwnAccountAction } from "@/lib/account/actions";
import type { AccountDeletionPreview } from "@/lib/account/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function DeleteOwnAccount({
  initial,
}: {
  initial: AccountDeletionPreview;
}) {
  const [preview, setPreview] = useState(initial);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, start] = useTransition();
  return (
    <section className="rounded-xl border border-red-200 bg-white p-6">
      <h2 className="text-xl font-semibold">Delete account</h2>
      <p className="mt-3 text-muted-foreground">
        Permanently delete your Mill login, profile and access to all companies.
        This cannot be undone.
      </p>
      {preview.personalCompanies.length > 0 && (
        <div className="mt-4">
          <p className="font-medium">
            Your personal companies and their data will be deleted:
          </p>
          <ul className="mt-2 list-inside list-disc">
            {preview.personalCompanies.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.sharedCompanies.length > 0 && (
        <p className="mt-4 text-muted-foreground">
          You will leave {preview.sharedCompanies.length} shared{" "}
          {preview.sharedCompanies.length === 1 ? "company" : "companies"}.
          Company conversations and business records remain available to their
          authorized members.
        </p>
      )}
      <p className="mt-4 text-sm text-muted-foreground">
        Invoices, security records and backups may be retained where required.
        Your access ends immediately. File and company data cleanup continues in
        the background. Shared company business records stay with that company.{" "}
        <a
          className="underline"
          href="https://mill.chat/privacy#your-choices"
          target="_blank"
          rel="noreferrer"
        >
          Privacy and deletion details
        </a>
      </p>
      {preview.blockers.length > 0 ? (
        <div
          className="mt-5 space-y-2 rounded-lg bg-amber-50 p-4"
          role="status"
        >
          {preview.blockers.map((b, i) => (
            <p key={i}>{b.message}</p>
          ))}
          <a className="underline" href="mailto:support@mill.chat">
            Contact support
          </a>
        </div>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setNotice("");
            start(async () => {
              try {
                const result = await deleteOwnAccountAction({
                  confirmation,
                  password,
                });
                setPassword("");
                if (!result.success) setNotice(result.message);
                else if (!result.result.deleted) {
                  setPreview(result.result.preview);
                  setNotice(
                    "Please resolve the issues above before deleting your account.",
                  );
                } else {
                  window.localStorage.clear();
                  window.sessionStorage.clear();
                  window.location.replace("/login?accountDeleted=1");
                }
              } catch {
                setPassword("");
                setNotice(
                  "Unable to complete deletion. Please sign in again to check your account before retrying.",
                );
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="delete-confirmation">
              Type {preview.email} to confirm
            </Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(e) => {
                setConfirmation(e.target.value);
              }}
              autoComplete="off"
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delete-password">Your password</Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              required
              disabled={pending}
            />
            <a className="text-sm underline" href="/forgot-password">
              Forgot your password?
            </a>
          </div>
          <Button
            type="submit"
            variant="destructive"
            disabled={pending || confirmation !== preview.email || !password}
          >
            {pending ? "Deleting account…" : "Permanently delete my account"}
          </Button>
        </form>
      )}
      {notice && (
        <p className="mt-4 text-red-700" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}
