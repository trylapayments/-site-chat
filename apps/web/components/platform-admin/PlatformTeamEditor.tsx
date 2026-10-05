"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPlatformAdministratorAction } from "@/lib/platform-admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export function PlatformTeamEditor() {
  const router = useRouter();
  const [email, setEmail] = useState(""),
    [role, setRole] = useState("viewer"),
    [enabled, setEnabled] = useState(true),
    [reason, setReason] = useState(""),
    [message, setMessage] = useState(""),
    [pending, start] = useTransition();
  return (
    <section className="mt-6 rounded-lg border bg-white p-5">
      <h2 className="font-semibold">Grant or update platform access</h2>
      <p className="mt-2 text-sm text-[#747b80]">
        Requires an existing confirmed Mill account. Platform owners can access
        every company and change security settings.
      </p>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="platform-email">Mill account email</Label>
          <Input
            id="platform-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </div>
        <div>
          <Label htmlFor="platform-role">Platform role</Label>
          <select
            id="platform-role"
            className="block w-full rounded-md border px-3 py-2"
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
            }}
          >
            {["viewer", "support", "finance", "owner"].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="platform-reason">Reason</Label>
          <Input
            id="platform-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
            }}
          />
          Access enabled
        </label>
      </div>
      <Button
        className="mt-5"
        disabled={pending || !email || reason.trim().length < 3}
        onClick={() => {
          if (
            !window.confirm(
              `${enabled ? "Grant" : "Disable"} platform ${role} access for ${email}?`,
            )
          )
            return;
          start(async () => {
            const result = await setPlatformAdministratorAction({
              email,
              role,
              enabled,
              reason,
            });
            setMessage(result.message);
            if (result.success) router.refresh();
          });
        }}
      >
        {pending ? "Saving…" : "Save platform access"}
      </Button>
      {message ? (
        <p role="status" className="mt-4 text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
