"use client";

import {
  crmMessagesEn,
  parseCustomFieldValueForType,
  type ContactCustomFieldEntry,
  type ContactProfile,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearContactCustomFieldValueAction,
  setContactCustomFieldValueAction,
} from "@/lib/crm/actions";

const messages = crmMessagesEn;

function valueToInput(entry: ContactCustomFieldEntry): string {
  if (entry.value === null) {
    return "";
  }
  if (typeof entry.value === "boolean") {
    return entry.value ? "true" : "false";
  }
  return String(entry.value);
}

function FieldEditor({
  workspaceSlug,
  contactId,
  entry,
  canEdit,
}: {
  workspaceSlug: string;
  contactId: string;
  entry: ContactCustomFieldEntry;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(valueToInput(entry));
  const [dirty, setDirty] = useState(false);
  const serverValue = valueToInput(entry);

  useEffect(() => {
    // Live profile refresh creates new entry object identities; only reset
    // pristine drafts so in-progress edits survive CDC / router.refresh.
    if (!dirty) {
      setDraft(serverValue);
      setError(null);
    }
  }, [dirty, serverValue, entry.field_id]);

  if (!canEdit) {
    return (
      <div className="space-y-0.5" data-testid={`custom-field-${entry.key}`}>
        <p className="text-muted-foreground text-xs">{entry.label}</p>
        <p className="text-sm">
          {entry.value === null ? "—" : String(entry.value)}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid={`custom-field-${entry.key}`}>
      <Label htmlFor={`cf-${entry.field_id}`}>{entry.label}</Label>
      {entry.field_type === "boolean" ? (
        <select
          id={`cf-${entry.field_id}`}
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          value={draft}
          disabled={isPending}
          onChange={(event) => {
            setDirty(true);
            setDraft(event.target.value);
          }}
        >
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      ) : entry.field_type === "select" ? (
        <select
          id={`cf-${entry.field_id}`}
          className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
          value={draft}
          disabled={isPending}
          onChange={(event) => {
            setDirty(true);
            setDraft(event.target.value);
          }}
        >
          <option value="">—</option>
          {entry.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={`cf-${entry.field_id}`}
          type={
            entry.field_type === "number"
              ? "number"
              : entry.field_type === "date"
                ? "date"
                : "text"
          }
          value={draft}
          disabled={isPending}
          onChange={(event) => {
            setDirty(true);
            setDraft(event.target.value);
          }}
        />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              let raw: string | number | boolean | null = draft;
              if (draft.trim() === "") {
                raw = null;
              } else if (entry.field_type === "number") {
                raw = Number(draft);
              } else if (entry.field_type === "boolean") {
                raw = draft === "true";
              }

              const typed = parseCustomFieldValueForType(entry.field_type, raw);
              if (!typed.success) {
                setError(typed.message);
                return;
              }

              const result = await setContactCustomFieldValueAction(
                workspaceSlug,
                {
                  contactId,
                  fieldId: entry.field_id,
                  value: typed.value,
                },
              );
              if (result.success) {
                setDirty(false);
                router.refresh();
              } else {
                setError(result.message);
              }
            });
          }}
        >
          {messages.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending || entry.value === null}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await clearContactCustomFieldValueAction(
                workspaceSlug,
                {
                  contactId,
                  fieldId: entry.field_id,
                },
              );
              if (result.success) {
                setDirty(false);
                setDraft("");
                router.refresh();
              } else {
                setError(result.message);
              }
            });
          }}
        >
          {messages.clear}
        </Button>
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}

export function ContactCustomFieldsEditor({
  workspaceSlug,
  profile,
  canEdit,
}: {
  workspaceSlug: string;
  profile: ContactProfile;
  canEdit: boolean;
}) {
  if (profile.custom_fields.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{messages.noCustomFields}</p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {profile.custom_fields.map((entry) => (
        <FieldEditor
          key={entry.field_id}
          workspaceSlug={workspaceSlug}
          contactId={profile.id}
          entry={entry}
          canEdit={canEdit}
        />
      ))}
    </div>
  );
}
