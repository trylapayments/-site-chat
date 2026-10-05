"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { CompanyProfile } from "@/lib/company/schema";
import { saveCompanyAction } from "@/lib/company/actions";
const fields: [keyof CompanyProfile, string, string?][] = [
  ["name", "Company display name"],
  ["legalName", "Legal company name"],
  ["website", "Website", "https://example.com"],
  ["email", "Company email"],
  ["phone", "Phone"],
  ["addressLine1", "Address line 1"],
  ["addressLine2", "Address line 2"],
  ["city", "City"],
  ["region", "State / province"],
  ["postalCode", "ZIP / postal code"],
  ["country", "Country code", "US"],
  ["taxId", "Tax / VAT ID"],
];
export function CompanyProfileEditor({
  slug,
  initial,
  canManage,
}: {
  slug: string;
  initial: CompanyProfile;
  canManage: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <form
      className="max-w-3xl rounded-xl border border-inbox-border bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const r = await saveCompanyAction(slug, draft);
          setMessage(r.message);
          if (r.success) router.refresh();
        });
      }}
    >
      <div className="mb-6 flex items-center gap-3">
        <Building2 className="size-5 text-muted-foreground" />
        <div>
          <h2 className="font-semibold">Company details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Your workspace name and company contact information.
          </p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map(([key, label, placeholder]) => (
          <div key={key} className={key === "name" ? "sm:col-span-2" : ""}>
            <Label htmlFor={`company-${key}`}>{label}</Label>
            <Input
              className="mt-2"
              id={`company-${key}`}
              value={draft[key]}
              placeholder={placeholder}
              required={key === "name"}
              type={
                key === "email" ? "email" : key === "website" ? "url" : "text"
              }
              maxLength={key === "name" ? 100 : 300}
              disabled={!canManage || pending}
              onChange={(e) => {
                setDraft({
                  ...draft,
                  [key]:
                    key === "country"
                      ? e.target.value.toUpperCase()
                      : e.target.value,
                });
                setMessage("");
              }}
            />
            {key === "name" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Shown in your workspace navigation. Your workspace URL stays the
                same.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        {canManage ? (
          <Button disabled={pending} type="submit">
            <Check className="mr-2 size-4" />
            {pending ? "Saving…" : "Save company details"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask an owner or administrator to update these details.
          </p>
        )}
        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
