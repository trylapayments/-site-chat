"use client";

import {
  CONTACT_EMAIL_MAX_LENGTH,
  CONTACT_JOB_TITLE_MAX_LENGTH,
  CONTACT_LOCALE_MAX_LENGTH,
  CONTACT_NAME_MAX_LENGTH,
  CONTACT_PHONE_MAX_LENGTH,
  crmMessagesEn,
  type ContactProfile,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateContactProfileAction } from "@/lib/crm/actions";

const messages = crmMessagesEn;

export function ContactIdentityForm({
  workspaceSlug,
  profile,
  canEdit,
}: {
  workspaceSlug: string;
  profile: ContactProfile;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(profile.name ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [jobTitle, setJobTitle] = useState(profile.job_title ?? "");
  const [locale, setLocale] = useState(profile.locale ?? "");
  const [countryCode, setCountryCode] = useState(profile.country_code ?? "");

  useEffect(() => {
    setName(profile.name ?? "");
    setEmail(profile.email ?? "");
    setPhone(profile.phone ?? "");
    setJobTitle(profile.job_title ?? "");
    setLocale(profile.locale ?? "");
    setCountryCode(profile.country_code ?? "");
    setError(null);
  }, [profile]);

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

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await updateContactProfileAction(workspaceSlug, {
            contactId: profile.id,
            name: name.trim() === "" ? null : name,
            email: email.trim() === "" ? null : email,
            phone: phone.trim() === "" ? null : phone,
            job_title: jobTitle.trim() === "" ? null : jobTitle,
            locale: locale.trim() === "" ? null : locale,
            country_code: countryCode.trim() === "" ? null : countryCode,
          });
          if (result.success) {
            router.refresh();
          } else {
            setError(result.message);
          }
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">{messages.fieldName}</Label>
          <Input
            id="contact-name"
            value={name}
            disabled={isPending}
            maxLength={CONTACT_NAME_MAX_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-email">{messages.fieldEmail}</Label>
          <Input
            id="contact-email"
            type="email"
            value={email}
            disabled={isPending}
            maxLength={CONTACT_EMAIL_MAX_LENGTH}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-phone">{messages.fieldPhone}</Label>
          <Input
            id="contact-phone"
            type="tel"
            value={phone}
            disabled={isPending}
            maxLength={CONTACT_PHONE_MAX_LENGTH}
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-job-title">{messages.fieldJobTitle}</Label>
          <Input
            id="contact-job-title"
            value={jobTitle}
            disabled={isPending}
            maxLength={CONTACT_JOB_TITLE_MAX_LENGTH}
            onChange={(event) => {
              setJobTitle(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-locale">{messages.fieldLocale}</Label>
          <Input
            id="contact-locale"
            value={locale}
            disabled={isPending}
            maxLength={CONTACT_LOCALE_MAX_LENGTH}
            onChange={(event) => {
              setLocale(event.target.value);
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="contact-country">{messages.fieldCountryCode}</Label>
          <Input
            id="contact-country"
            value={countryCode}
            disabled={isPending}
            maxLength={2}
            onChange={(event) => {
              setCountryCode(event.target.value.toUpperCase());
            }}
          />
        </div>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? messages.saving : messages.save}
      </Button>
    </form>
  );
}
