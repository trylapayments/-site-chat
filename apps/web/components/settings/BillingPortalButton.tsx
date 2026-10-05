"use client";
import { useState, useTransition } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openBillingPortalAction } from "@/lib/billing/actions";
export function BillingPortalButton({
  slug,
  enabled,
}: {
  slug: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  return (
    <div>
      <Button
        disabled={!enabled || pending}
        onClick={() => {
          startTransition(async () => {
            const result = await openBillingPortalAction(slug);
            setMessage(result.message);
          });
        }}
      >
        {pending ? "Opening…" : "Manage billing"}
        <ArrowUpRight className="ml-2 size-4" />
      </Button>
      {message ? (
        <p role="status" className="mt-2 text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
