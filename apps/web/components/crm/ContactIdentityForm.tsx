"use client";

import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_IDENTITY_KEYS,
  CONTACT_JOB_TITLE_MAX_LENGTH,
  CONTACT_LOCALE_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  buildContactIdentityPatch,
  contactIdentityPatchHasChanges,
  crmMessagesEn,
  identityValuesFromProfile,
  identityValuesToDraft,
  reconcileContactIdentityDraft,
  type ContactIdentityDraft,
  type ContactIdentityValues,
  type ContactProfile,
} from "@site-chat/shared";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateContactProfileAction } from "@/lib/crm/actions";

const messages = crmMessagesEn;

function profileToBaseline(profile: ContactProfile): ContactIdentityValues {
  return identityValuesFromProfile(profile);
}

function profileToDraft(profile: ContactProfile): ContactIdentityDraft {
  return identityValuesToDraft(
    CONTACT_IDENTITY_KEYS,
    profileToBaseline(profile),
  );
}

type IdentityState = {
  baseline: ContactIdentityValues;
  draft: ContactIdentityDraft;
};

export function ContactIdentityForm({
  workspaceSlug,
  profile,
  canEdit,
}: {
  workspaceSlug: string;
  /** Authoritative server profile; form owns drafts and reconciles. */
  profile: ContactProfile;
  canEdit: boolean;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<IdentityState>(() => ({
    baseline: profileToBaseline(profile),
    draft: profileToDraft(profile),
  }));
  const contactIdRef = useRef(profile.id);

  useEffect(() => {
    if (contactIdRef.current !== profile.id) {
      contactIdRef.current = profile.id;
      setIdentity({
        baseline: profileToBaseline(profile),
        draft: profileToDraft(profile),
      });
      setError(null);
      return;
    }

    setIdentity((current) =>
      reconcileContactIdentityDraft({
        baseline: current.baseline,
        draft: current.draft,
        server: profileToBaseline(profile),
      }),
    );
    // Field-level deps: avoid wiping drafts on unrelated profile object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft-preserving reconcile
  }, [
    profile.id,
    profile.name,
    profile.email,
    profile.phone,
    profile.job_title,
    profile.locale,
    profile.country_code,
    profile.updated_at,
  ]);

  if (!canEdit) {
    return (
      <div className="space-y-2 text-sm">
        <p>
          <span className="text-muted-foreground">{messages.fieldName}: </span>
          {profile.name || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">{messages.fieldEmail}: </span>
          {profile.email || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">{messages.fieldPhone}: </span>
          {profile.phone || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">
            {messages.fieldJobTitle}:{" "}
          </span>
          {profile.job_title || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">
            {messages.fieldLocale}:{" "}
          </span>
          {profile.locale || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">
            {messages.fieldCountryCode}:{" "}
          </span>
          {profile.country_code || "—"}
        </p>
      </div>
    );
  }

  const { draft, baseline } = identity;

  const updateField = (key: keyof ContactIdentityDraft, value: string) => {
    setIdentity((current) => ({
      ...current,
      draft: { ...current.draft, [key]: value },
    }));
  };

  return (
    <form
      className="space-y-3"
      data-testid="contact-identity-form"
      data-pending={isPending ? "true" : "false"}
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const patch = buildContactIdentityPatch({
          contactId: profile.id,
          baseline,
          draft,
        });
        if (!contactIdentityPatchHasChanges(patch)) {
          return;
        }
        if (isPending) {
          return;
        }
        setIsPending(true);
        void (async () => {
          try {
            const result = await updateContactProfileAction(
              workspaceSlug,
              patch,
            );
            if (result.success) {
              setIdentity({
                baseline: profileToBaseline(result.data),
                draft: profileToDraft(result.data),
              });
              // Do not router.refresh() here — multi-tab RSC refresh can stall
              // the Server Action flight. CDC catch-up + returned profile cover UI.
            } else {
              setError(result.message);
            }
          } finally {
            setIsPending(false);
          }
        })();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">{messages.fieldName}</Label>
          <Input
            id="contact-name"
            value={draft.name}
            disabled={isPending}
            maxLength={CONTACT_NAME_MAX_LENGTH}
            onChange={(event) => {
              updateField("name", event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">{messages.fieldEmail}</Label>
          <Input
            id="contact-email"
            type="email"
            value={draft.email}
            disabled={isPending}
            maxLength={CONTACT_EMAIL_MAX_LENGTH}
            onChange={(event) => {
              updateField("email", event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone">{messages.fieldPhone}</Label>
          <Input
            id="contact-phone"
            type="tel"
            value={draft.phone}
            disabled={isPending}
            maxLength={CONTACT_PHONE_MAX_LENGTH}
            onChange={(event) => {
              updateField("phone", event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-job-title">{messages.fieldJobTitle}</Label>
          <Input
            id="contact-job-title"
            value={draft.job_title}
            disabled={isPending}
            maxLength={CONTACT_JOB_TITLE_MAX_LENGTH}
            onChange={(event) => {
              updateField("job_title", event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-locale">{messages.fieldLocale}</Label>
          <Input
            id="contact-locale"
            value={draft.locale}
            disabled={isPending}
            maxLength={CONTACT_LOCALE_MAX_LENGTH}
            onChange={(event) => {
              updateField("locale", event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-country">{messages.fieldCountryCode}</Label>
          <Input
            id="contact-country"
            value={draft.country_code}
            disabled={isPending}
            maxLength={2}
            onChange={(event) => {
              updateField("country_code", event.target.value.toUpperCase());
            }}
          />
        </div>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <Button
        type="submit"
        size="sm"
        disabled={isPending}
        data-testid="contact-identity-save"
      >
        {isPending ? messages.saving : messages.save}
      </Button>
    </form>
  );
}
