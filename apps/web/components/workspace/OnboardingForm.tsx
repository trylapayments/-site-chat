"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createWorkspaceAction } from "@/lib/workspace/actions";
import { initialWorkspaceActionState } from "@/lib/workspace/action-state";
import { generateSlugFromName } from "@/lib/auth/slug";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    createWorkspaceAction,
    initialWorkspaceActionState,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(generateSlugFromName(name));
    }
  }, [name, slugTouched]);

  return (
    <form action={formAction} className="max-w-lg space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          name="name"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          required
          maxLength={100}
        />
        {state.fieldErrors?.name?.[0] ? (
          <p className="text-destructive text-sm">
            {state.fieldErrors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">Workspace slug</Label>
        <Input
          id="slug"
          name="slug"
          value={slug}
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
          required
          maxLength={63}
        />
        {state.fieldErrors?.slug?.[0] ? (
          <p className="text-destructive text-sm">
            {state.fieldErrors.slug[0]}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Your workspace URL will be /app/{slug || "your-slug"}.
          </p>
        )}
      </div>

      {state.message ? (
        <p className="text-destructive text-sm">{state.message}</p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Creating workspace..." : "Create workspace"}
      </Button>
    </form>
  );
}
