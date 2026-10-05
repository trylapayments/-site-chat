"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { saveBillingDetailsAction } from "@/lib/billing/actions";
import type { BillingDetails } from "@/lib/billing/schema";
export function BillingDetailsEditor({
  slug,
  initial,
  enabled,
}: {
  slug: string;
  initial: BillingDetails;
  enabled: boolean;
}) {
  const [details, setDetails] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  const fields: [keyof BillingDetails, string][] = [
    ["name", "Billing name"],
    ["email", "Billing email"],
    ["line1", "Address line 1"],
    ["line2", "Address line 2"],
    ["city", "City"],
    ["state", "State / province"],
    ["postal_code", "Postal code"],
    ["country", "Country code"],
  ];
  return (
    <section className="rounded-xl border border-inbox-border bg-white p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <Building2 className="size-4 text-muted-foreground" />
        Billing details
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Used for future invoices. Existing invoices stay unchanged.
      </p>
      <form
        className="mt-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await saveBillingDetailsAction(slug, details);
            setMessage(result.message);
            if (result.success) router.refresh();
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([field, label]) => (
            <div key={field}>
              <Label htmlFor={`billing-${field}`}>{label}</Label>
              <Input
                id={`billing-${field}`}
                value={details[field]}
                disabled={!enabled || pending}
                required={["name", "email", "country"].includes(field)}
                type={field === "email" ? "email" : "text"}
                maxLength={field === "country" ? 2 : 200}
                placeholder={field === "country" ? "US" : undefined}
                onChange={(e) => {
                  setDetails((current) => ({
                    ...current,
                    [field]:
                      field === "country"
                        ? e.target.value.toUpperCase()
                        : e.target.value,
                  }));
                }}
              />
            </div>
          ))}
        </div>
        <Button disabled={!enabled || pending}>
          {pending ? "Saving…" : "Save billing details"}
        </Button>
        {message ? (
          <p role="status" className="text-sm">
            {message}
          </p>
        ) : null}
      </form>
    </section>
  );
}
