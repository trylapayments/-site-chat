"use client";

import {
  crmMessagesEn,
  type Company,
  type ContactProfile,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCompanyAction,
  linkContactCompanyAction,
  listCompaniesAction,
  unlinkContactCompanyAction,
} from "@/lib/crm/actions";

const messages = crmMessagesEn;
const SEARCH_DEBOUNCE_MS = 250;

export function ContactCompanyEditor({
  workspaceSlug,
  profile,
  companies: initialCompanies,
  canEdit,
}: {
  workspaceSlug: string;
  profile: ContactProfile;
  companies: Company[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    profile.company?.id ?? "",
  );
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [companies, setCompanies] = useState(initialCompanies);
  const [isSearching, setIsSearching] = useState(false);
  const searchRequestRef = useRef(0);
  const initialCompaniesRef = useRef(initialCompanies);
  initialCompaniesRef.current = initialCompanies;

  useEffect(() => {
    setSelectedCompanyId(profile.company?.id ?? "");
  }, [profile.id, profile.company?.id]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setCompanies(initialCompanies);
    }
  }, [initialCompanies, searchQuery]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setCompanies(initialCompaniesRef.current);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(() => {
      const requestId = ++searchRequestRef.current;
      setIsSearching(true);
      void (async () => {
        const result = await listCompaniesAction(workspaceSlug, {
          q: query,
          limit: 100,
        });
        if (requestId !== searchRequestRef.current) {
          return;
        }
        if (result.success) {
          setCompanies(result.data.items);
          setError(null);
        } else {
          setError(result.message);
        }
        setIsSearching(false);
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, workspaceSlug]);

  if (!canEdit) {
    return (
      <div className="space-y-1 text-sm">
        {profile.company ? (
          <>
            <p className="font-medium">{profile.company.name}</p>
            {profile.company.domain ? (
              <p className="text-muted-foreground">{profile.company.domain}</p>
            ) : null}
          </>
        ) : (
          <p className="text-muted-foreground">{messages.noCompany}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profile.company ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">{profile.company.name}</p>
            {profile.company.domain ? (
              <p className="text-muted-foreground text-xs">
                {profile.company.domain}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await unlinkContactCompanyAction(workspaceSlug, {
                  contactId: profile.id,
                });
                if (result.success) {
                  setSelectedCompanyId("");
                  router.refresh();
                } else {
                  setError(result.message);
                }
              });
            }}
          >
            {messages.companyUnlink}
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{messages.noCompany}</p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="company-search">
          {messages.companySearchPlaceholder}
        </Label>
        <Input
          id="company-search"
          value={searchQuery}
          disabled={isPending}
          placeholder={messages.companySearchPlaceholder}
          onChange={(event) => {
            setSearchQuery(event.target.value);
          }}
          autoComplete="off"
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="link-company">{messages.companyLink}</Label>
          <select
            id="link-company"
            className="border-input bg-background h-9 min-w-[12rem] rounded-md border px-2 text-sm"
            value={selectedCompanyId}
            disabled={isPending || isSearching}
            onChange={(event) => {
              setSelectedCompanyId(event.target.value);
            }}
          >
            <option value="">
              {isSearching ? "Searching…" : "Select company…"}
            </option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={isPending || !selectedCompanyId}
          onClick={() => {
            if (!selectedCompanyId) return;
            setError(null);
            startTransition(async () => {
              const result = await linkContactCompanyAction(workspaceSlug, {
                contactId: profile.id,
                companyId: selectedCompanyId,
              });
              if (result.success) {
                router.refresh();
              } else {
                setError(result.message);
              }
            });
          }}
        >
          {messages.companyLink}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setShowCreate((value) => !value);
          }}
        >
          {messages.companyCreate}
        </Button>
      </div>

      {showCreate ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const created = await createCompanyAction(workspaceSlug, {
                name: newName,
              });
              if (!created.success) {
                setError(created.message);
                return;
              }
              const linked = await linkContactCompanyAction(workspaceSlug, {
                contactId: profile.id,
                companyId: created.data.id,
              });
              if (linked.success) {
                setNewName("");
                setShowCreate(false);
                router.refresh();
              } else {
                setError(linked.message);
              }
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="new-company-name">
              {messages.companyNameLabel}
            </Label>
            <Input
              id="new-company-name"
              value={newName}
              disabled={isPending}
              onChange={(event) => {
                setNewName(event.target.value);
              }}
              required
            />
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={isPending || !newName.trim()}
          >
            {messages.create}
          </Button>
        </form>
      ) : null}

      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
