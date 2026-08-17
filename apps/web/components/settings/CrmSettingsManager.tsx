"use client";

import {
  CONTACT_TAG_COLOR_DEFAULT,
  CONTACT_TAG_NAME_MAX_LENGTH,
  CUSTOM_FIELD_TYPES,
  crmMessagesEn,
  type ContactTag,
  type CustomFieldDefinition,
  type CustomFieldType,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ContactTagChip } from "@/components/crm/ContactTagsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createContactTagAction,
  createCustomFieldDefinitionAction,
  softDeleteContactTagAction,
  softDeleteCustomFieldDefinitionAction,
  updateContactTagAction,
  updateCustomFieldDefinitionAction,
} from "@/lib/crm/actions";

const messages = crmMessagesEn;

export function CrmSettingsManager({
  workspaceSlug,
  initialTags,
  initialDefinitions,
  canManageTags,
  canManageDefinitions,
}: {
  workspaceSlug: string;
  initialTags: ContactTag[];
  initialDefinitions: CustomFieldDefinition[];
  canManageTags: boolean;
  canManageDefinitions: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [tagName, setTagName] = useState("");
  const [tagColor, setTagColor] = useState(CONTACT_TAG_COLOR_DEFAULT);

  const [fieldKey, setFieldKey] = useState("");
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [fieldOptions, setFieldOptions] = useState("");

  return (
    <div className="space-y-10" data-testid="crm-settings-manager">
      {!canManageTags ? (
        <p className="text-muted-foreground text-sm">{messages.viewerNotice}</p>
      ) : null}
      {canManageTags && !canManageDefinitions ? (
        <p className="text-muted-foreground text-sm">
          {messages.agentDefinitionsNotice}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">{messages.tagsTitle}</h2>
        {initialTags.length === 0 ? (
          <p className="text-muted-foreground text-sm">{messages.tagEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {initialTags.map((tag) => (
              <li
                key={tag.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <ContactTagChip tag={tag} />
                {canManageTags ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => {
                        const nextName = window.prompt(
                          messages.tagNameLabel,
                          tag.name,
                        );
                        if (!nextName || nextName === tag.name) return;
                        setError(null);
                        startTransition(async () => {
                          const result = await updateContactTagAction(
                            workspaceSlug,
                            { tagId: tag.id, name: nextName },
                          );
                          if (result.success) {
                            router.refresh();
                          } else {
                            setError(result.message);
                          }
                        });
                      }}
                    >
                      {messages.edit}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => {
                        if (!window.confirm(messages.tagDeleteConfirm)) return;
                        setError(null);
                        startTransition(async () => {
                          const result = await softDeleteContactTagAction(
                            workspaceSlug,
                            { tagId: tag.id },
                          );
                          if (result.success) {
                            router.refresh();
                          } else {
                            setError(result.message);
                          }
                        });
                      }}
                    >
                      {messages.delete}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManageTags ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              startTransition(async () => {
                const result = await createContactTagAction(workspaceSlug, {
                  name: tagName,
                  color: tagColor,
                });
                if (result.success) {
                  setTagName("");
                  setTagColor(CONTACT_TAG_COLOR_DEFAULT);
                  router.refresh();
                } else {
                  setError(result.message);
                }
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="new-tag-name">{messages.tagNameLabel}</Label>
              <Input
                id="new-tag-name"
                value={tagName}
                maxLength={CONTACT_TAG_NAME_MAX_LENGTH}
                disabled={isPending}
                onChange={(event) => {
                  setTagName(event.target.value);
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-tag-color">{messages.tagColorLabel}</Label>
              <Input
                id="new-tag-color"
                type="color"
                value={tagColor}
                disabled={isPending}
                onChange={(event) => {
                  setTagColor(event.target.value.toUpperCase());
                }}
                className="h-9 w-16 p-1"
              />
            </div>
            <Button type="submit" size="sm" disabled={isPending}>
              {messages.tagCreate}
            </Button>
          </form>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold">{messages.customFieldsTitle}</h2>
        {!canManageDefinitions ? (
          <p className="text-muted-foreground text-sm">
            {messages.customFieldDefinitionsLocked}
          </p>
        ) : null}
        {initialDefinitions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {messages.customFieldEmpty}
          </p>
        ) : (
          <ul className="space-y-2">
            {initialDefinitions.map((field) => (
              <li
                key={field.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{field.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {field.key} · {field.field_type}
                  </p>
                </div>
                {canManageDefinitions ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => {
                        const next = window.prompt(
                          messages.customFieldLabelLabel,
                          field.label,
                        );
                        if (!next || next === field.label) return;
                        setError(null);
                        startTransition(async () => {
                          const result =
                            await updateCustomFieldDefinitionAction(
                              workspaceSlug,
                              { fieldId: field.id, label: next },
                            );
                          if (result.success) {
                            router.refresh();
                          } else {
                            setError(result.message);
                          }
                        });
                      }}
                    >
                      {messages.edit}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => {
                        if (
                          !window.confirm(messages.customFieldDeleteConfirm)
                        ) {
                          return;
                        }
                        setError(null);
                        startTransition(async () => {
                          const result =
                            await softDeleteCustomFieldDefinitionAction(
                              workspaceSlug,
                              { fieldId: field.id },
                            );
                          if (result.success) {
                            router.refresh();
                          } else {
                            setError(result.message);
                          }
                        });
                      }}
                    >
                      {messages.delete}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canManageDefinitions ? (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              const options =
                fieldType === "select"
                  ? fieldOptions
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean)
                  : [];
              startTransition(async () => {
                const result = await createCustomFieldDefinitionAction(
                  workspaceSlug,
                  {
                    key: fieldKey,
                    label: fieldLabel,
                    field_type: fieldType,
                    options,
                  },
                );
                if (result.success) {
                  setFieldKey("");
                  setFieldLabel("");
                  setFieldType("text");
                  setFieldOptions("");
                  router.refresh();
                } else {
                  setError(result.message);
                }
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cf-key">{messages.customFieldKeyLabel}</Label>
              <Input
                id="cf-key"
                value={fieldKey}
                disabled={isPending}
                onChange={(event) => {
                  setFieldKey(event.target.value);
                }}
                required
              />
              <p className="text-muted-foreground text-xs">
                {messages.customFieldKeyHint}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-label">{messages.customFieldLabelLabel}</Label>
              <Input
                id="cf-label"
                value={fieldLabel}
                disabled={isPending}
                onChange={(event) => {
                  setFieldLabel(event.target.value);
                }}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-type">{messages.customFieldTypeLabel}</Label>
              <select
                id="cf-type"
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                value={fieldType}
                disabled={isPending}
                onChange={(event) => {
                  setFieldType(event.target.value as CustomFieldType);
                }}
              >
                {CUSTOM_FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            {fieldType === "select" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="cf-options">
                  {messages.customFieldOptionsLabel}
                </Label>
                <textarea
                  id="cf-options"
                  className="border-input bg-background min-h-[6rem] w-full rounded-md border px-3 py-2 text-sm"
                  value={fieldOptions}
                  disabled={isPending}
                  onChange={(event) => {
                    setFieldOptions(event.target.value);
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  {messages.customFieldOptionsHint}
                </p>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={isPending}>
                {messages.customFieldCreate}
              </Button>
            </div>
          </form>
        ) : null}
      </section>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
