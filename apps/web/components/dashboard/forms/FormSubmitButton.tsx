"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function FormSubmitButton({
  pending = false,
  pendingLabel = "Saving...",
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  pending?: boolean;
  pendingLabel?: string;
}) {
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
