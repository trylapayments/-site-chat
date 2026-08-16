"use client";

import {
  crmMessagesEn,
  type ContactProfile,
  type ContactTag,
  type ContactTagSummary,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  assignContactTagAction,
  unassignContactTagAction,
} from "@/lib/crm/actions";

const messages = crmMessagesEn;

export function ContactTagChip({
  tag,
  onRemove,
  disabled,
}: {
  tag: ContactTagSummary;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
      style={{ borderColor: tag.color, color: tag.color }}
    >
      <span
        className="size-2 rounded-full"
        style={{ backgroundColor: tag.color }}
        aria-hidden="true"
      />
      {tag.name}
      {onRemove ? (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground ml-0.5"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`${messages.remove} ${tag.name}`}
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

export function ContactTagsEditor({
  workspaceSlug,
  profile,
  availableTags,
  canEdit,
}: {
  workspaceSlug: string;
  profile: ContactProfile;
  availableTags: ContactTag[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState("");

  const assignedIds = useMemo(
    () => new Set(profile.tags.map((tag) => tag.id)),
    [profile.tags],
  );

  const unassigned = availableTags.filter((tag) => !assignedIds.has(tag.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {profile.tags.length === 0 ? (
          <p className="text-muted-foreground text-sm">{messages.noTags}</p>
        ) : (
          profile.tags.map((tag) => (
            <ContactTagChip
              key={tag.id}
              tag={tag}
              disabled={isPending || !canEdit}
              onRemove={
                canEdit
                  ? () => {
                      setError(null);
                      startTransition(async () => {
                        const result = await unassignContactTagAction(
                          workspaceSlug,
                          { contactId: profile.id, tagId: tag.id },
                        );
                        if (result.success) {
                          router.refresh();
                        } else {
                          setError(result.message);
                        }
                      });
                    }
                  : undefined
              }
            />
          ))
        )}
      </div>

      {canEdit && unassigned.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="sr-only" htmlFor="assign-tag">
            {messages.tagAssign}
          </label>
          <select
            id="assign-tag"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={selectedTagId}
            disabled={isPending}
            onChange={(event) => {
              setSelectedTagId(event.target.value);
            }}
          >
            <option value="">Select tag…</option>
            {unassigned.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending || !selectedTagId}
            onClick={() => {
              if (!selectedTagId) return;
              setError(null);
              startTransition(async () => {
                const result = await assignContactTagAction(workspaceSlug, {
                  contactId: profile.id,
                  tagId: selectedTagId,
                });
                if (result.success) {
                  setSelectedTagId("");
                  router.refresh();
                } else {
                  setError(result.message);
                }
              });
            }}
          >
            {messages.tagAssign}
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
