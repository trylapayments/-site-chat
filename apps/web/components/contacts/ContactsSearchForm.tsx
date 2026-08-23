"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { crmMessagesEn, type ContactTag } from "@site-chat/shared";

import { toAppRoute } from "@/lib/auth/redirect";
import { workspaceContactsPath } from "@/lib/dashboard/routes";
import { cn } from "@/lib/utils";

const messages = crmMessagesEn;

/**
 * Contacts list search. Preserves contact detail segment when filtering so the
 * master–detail shell stays mounted; clears to contacts root when empty.
 */
export function ContactsSearchForm({
  workspaceSlug,
  tags,
  className,
}: {
  workspaceSlug: string;
  tags: ContactTag[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const currentQuery = searchParams.get("q") ?? "";
  const currentTag = searchParams.get("tag") ?? "";
  const [query, setQuery] = useState(currentQuery);
  const [tagId, setTagId] = useState(currentTag);

  useEffect(() => {
    setQuery(currentQuery);
  }, [currentQuery]);

  useEffect(() => {
    setTagId(currentTag);
  }, [currentTag]);

  function navigate(nextQuery: string, nextTag: string) {
    const params = new URLSearchParams();
    if (nextQuery.trim()) {
      params.set("q", nextQuery.trim());
    }
    if (nextTag) {
      params.set("tag", nextTag);
    }
    const contactsRoot = toAppRoute(workspaceContactsPath(workspaceSlug));
    const onContactsRoot =
      pathname === contactsRoot || pathname === `${contactsRoot}/`;
    // Keep detail selection when filtering; only jump to root from nested paths
    // when clearing would otherwise leave a stale selected contact hidden.
    const base = onContactsRoot
      ? contactsRoot
      : pathname.startsWith(`${contactsRoot}/`)
        ? pathname
        : contactsRoot;
    const qs = params.toString();
    startTransition(() => {
      router.replace(toAppRoute(qs ? `${base}?${qs}` : base));
    });
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (query === currentQuery) {
        return;
      }
      navigate(query, tagId);
    }, 300);
    return () => {
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce query only
  }, [query]);

  return (
    <form
      className={cn("space-y-2", className)}
      data-testid="contacts-search-form"
      onSubmit={(event) => {
        event.preventDefault();
        navigate(query, tagId);
      }}
    >
      <div className="relative w-full">
        <Search
          className="text-inbox-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
          strokeWidth={1.75}
        />
        <input
          id="contacts-search"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder={messages.contactsSearchPlaceholder}
          aria-label={messages.contactsSearchLabel}
          className="border-inbox-border bg-inbox-surface text-[13.5px] placeholder:text-inbox-muted focus-visible:ring-brand/35 h-10 w-full rounded-lg border pr-3 pl-10 shadow-[var(--inbox-shadow)] outline-none focus-visible:ring-2"
        />
      </div>
      {tags.length > 0 ? (
        <label className="sr-only" htmlFor="contacts-tag">
          Tag
        </label>
      ) : null}
      {tags.length > 0 ? (
        <select
          id="contacts-tag"
          className="border-inbox-border bg-inbox-surface text-inbox-muted focus-visible:ring-brand/35 h-9 w-full rounded-lg border px-2.5 text-[13px] outline-none focus-visible:ring-2"
          value={tagId}
          onChange={(event) => {
            const next = event.target.value;
            setTagId(next);
            navigate(query, next);
          }}
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag.id} value={tag.id}>
              {tag.name}
            </option>
          ))}
        </select>
      ) : null}
    </form>
  );
}
