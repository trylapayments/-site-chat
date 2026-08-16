"use client";

import { crmMessagesEn, type ContactTag } from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceContactsPath } from "@/lib/dashboard/routes";

const messages = crmMessagesEn;

export function ContactsSearchForm({
  workspaceSlug,
  initialQuery,
  tags,
  selectedTagId,
}: {
  workspaceSlug: string;
  initialQuery: string;
  tags: ContactTag[];
  selectedTagId: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState(initialQuery);
  const [tagId, setTagId] = useState(selectedTagId);

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const params = new URLSearchParams();
        if (query.trim()) {
          params.set("q", query.trim());
        }
        if (tagId) {
          params.set("tag", tagId);
        }
        const qs = params.toString();
        startTransition(() => {
          router.push(
            toAppRoute(
              `${workspaceContactsPath(workspaceSlug)}${qs ? `?${qs}` : ""}`,
            ),
          );
        });
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="contacts-search">{messages.contactsSearchLabel}</Label>
        <Input
          id="contacts-search"
          value={query}
          disabled={isPending}
          placeholder={messages.contactsSearchPlaceholder}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className="min-w-[16rem]"
        />
      </div>
      {tags.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor="contacts-tag">Tag</Label>
          <select
            id="contacts-tag"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={tagId}
            disabled={isPending}
            onChange={(event) => {
              setTagId(event.target.value);
            }}
          >
            <option value="">All tags</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending}>
        Search
      </Button>
    </form>
  );
}
