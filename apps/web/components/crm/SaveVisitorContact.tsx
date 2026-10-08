"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { visitorContactMembership } from "@/lib/crm/address-book";
import { createClient } from "@/lib/supabase/client";
import type { AppSupabaseClient } from "@/lib/supabase/server";

export function SaveVisitorContact({
  workspaceId,
  visitorSessionId,
  canSave,
}: {
  workspaceId: string;
  visitorSessionId: string;
  canSave: boolean;
}) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void visitorContactMembership(
      createClient() as AppSupabaseClient,
      workspaceId,
      { visitorSessionId },
    )
      .then((result) => {
        if (active) setSaved(result.saved);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [workspaceId, visitorSessionId]);
  if (!canSave) return null;
  if (saved)
    return <p className="mt-3 text-xs text-inbox-muted">Saved to contacts</p>;
  return (
    <div className="mt-3">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || (saved === null && !error)}
        onClick={() => {
          setBusy(true);
          setError(false);
          void visitorContactMembership(
            createClient() as AppSupabaseClient,
            workspaceId,
            { visitorSessionId },
            true,
          )
            .then((result) => {
              setSaved(result.saved);
            })
            .catch(() => {
              setError(true);
            })
            .finally(() => {
              setBusy(false);
            });
        }}
      >
        {busy ? "Saving…" : "Save to contacts"}
      </Button>
      {error && (
        <p role="status" className="mt-2 text-xs text-destructive">
          Unable to save contact. Please try again.
        </p>
      )}
    </div>
  );
}
