"use client";

import {
  GLOBAL_SEARCH_DEBOUNCE_MS,
  clampSearchIndex,
  emptyGlobalSearchResult,
  flattenSearchHits,
  groupLabelForType,
  normalizeSearchQuery,
  resolveSearchKeyboardAction,
  visibleSearchCategories,
  type GlobalSearchCategory,
  type GlobalSearchHit,
  type GlobalSearchResult,
  type GlobalSearchResultType,
} from "@site-chat/shared";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toAppRoute } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";
import { globalSearchAction } from "@/lib/search/actions";
import { hrefForSearchHit } from "@/lib/search/href";
import { createGlobalSearchRequestGuard } from "@/lib/search/request-guard";

const CATEGORY_LABELS: Record<GlobalSearchCategory, string> = {
  all: "All",
  contacts: "Contacts",
  conversations: "Conversations",
  messages: "Messages",
  notes: "Internal Notes",
  attachments: "Attachments",
};

const GROUP_ORDER: GlobalSearchResultType[] = [
  "contact",
  "conversation",
  "message",
  "note",
  "attachment",
];

function groupsForCategory(
  result: GlobalSearchResult,
  category: GlobalSearchCategory,
): Array<{ type: GlobalSearchResultType; hits: GlobalSearchHit[] }> {
  const map: Record<GlobalSearchResultType, GlobalSearchHit[]> = {
    contact: result.groups.contacts,
    conversation: result.groups.conversations,
    message: result.groups.messages,
    note: result.groups.notes,
    attachment: result.groups.attachments,
  };

  return GROUP_ORDER.filter((type) => {
    if (category === "all") {
      return map[type].length > 0;
    }
    if (category === "contacts") return type === "contact";
    if (category === "conversations") return type === "conversation";
    if (category === "messages") return type === "message";
    if (category === "notes") return type === "note";
    return type === "attachment";
  })
    .map((type) => ({ type, hits: map[type] }))
    .filter((group) => group.hits.length > 0 || category !== "all");
}

export function GlobalSearch({
  workspaceSlug,
  canSearchNotes,
}: {
  workspaceSlug: string;
  canSearchNotes: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<GlobalSearchCategory>("all");
  const [result, setResult] = useState<GlobalSearchResult>(() =>
    emptyGlobalSearchResult({ can_search_notes: canSearchNotes }),
  );
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createGlobalSearchRequestGuard());

  const categories = visibleSearchCategories(canSearchNotes);
  const flatHits = flattenSearchHits(result.groups).filter((hit) => {
    if (category === "all") return true;
    if (category === "contacts") return hit.type === "contact";
    if (category === "conversations") return hit.type === "conversation";
    if (category === "messages") return hit.type === "message";
    if (category === "notes") return hit.type === "note";
    return hit.type === "attachment";
  });

  const clearDebounce = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const resetPaletteState = useCallback(() => {
    setQuery("");
    setCategory("all");
    setResult(emptyGlobalSearchResult({ can_search_notes: canSearchNotes }));
    setActiveIndex(-1);
    setError(null);
  }, [canSearchNotes]);

  const close = useCallback(() => {
    clearDebounce();
    requestGuardRef.current.invalidate();
    setOpen(false);
    setActiveIndex(-1);
    setError(null);
    setResult(emptyGlobalSearchResult({ can_search_notes: canSearchNotes }));
    setQuery("");
  }, [canSearchNotes, clearDebounce]);

  const openPalette = useCallback(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    clearDebounce();
    requestGuardRef.current.resetWorkspace(workspaceSlug);
    resetPaletteState();
    setOpen(false);
  }, [workspaceSlug, clearDebounce, resetPaletteState]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(id);
    };
  }, [open]);

  const runSearch = useCallback(
    (nextQuery: string, nextCategory: GlobalSearchCategory) => {
      const normalized = normalizeSearchQuery(nextQuery);
      const token = requestGuardRef.current.begin(workspaceSlug);
      startTransition(async () => {
        const response = await globalSearchAction(workspaceSlug, {
          q: normalized,
          category: nextCategory,
          limit_per_type: nextCategory === "all" ? 5 : 15,
        });
        if (!requestGuardRef.current.isCurrent(token)) {
          return;
        }
        if (!response.success) {
          setError(response.message);
          setResult(
            emptyGlobalSearchResult({
              q: normalized,
              category: nextCategory,
              can_search_notes: canSearchNotes,
            }),
          );
          setActiveIndex(-1);
          return;
        }
        setError(null);
        setResult(response.data);
        const hits = flattenSearchHits(response.data.groups);
        setActiveIndex(hits.length > 0 ? 0 : -1);
      });
    },
    [canSearchNotes, workspaceSlug],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const action = resolveSearchKeyboardAction({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        open,
        hasSelection: activeIndex >= 0 && activeIndex < flatHits.length,
      });

      if (action.type === "open" || action.type === "close") {
        event.preventDefault();
        if (action.type === "open") {
          openPalette();
        } else {
          close();
        }
        return;
      }

      if (!open) {
        return;
      }

      if (action.type === "move") {
        event.preventDefault();
        setActiveIndex((current) =>
          clampSearchIndex(
            (current < 0 ? 0 : current) + action.delta,
            flatHits.length,
          ),
        );
        return;
      }

      if (action.type === "select") {
        event.preventDefault();
        const hit = flatHits[activeIndex];
        if (hit) {
          close();
          router.push(toAppRoute(hrefForSearchHit(workspaceSlug, hit)));
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeIndex, close, flatHits, open, openPalette, router, workspaceSlug]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      runSearch(query, category);
    }, GLOBAL_SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [category, open, query, runSearch]);

  const grouped = groupsForCategory(result, category);
  const showEmpty =
    normalizeSearchQuery(query).length > 0 &&
    !isPending &&
    flatHits.length === 0 &&
    !error;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="text-muted-foreground hidden h-9 gap-2 md:inline-flex"
        onClick={openPalette}
        data-testid="global-search-trigger"
        aria-keyshortcuts="Meta+K Control+K"
      >
        <Search className="size-4" aria-hidden="true" />
        <span>Search</span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none ml-1 hidden rounded px-1.5 py-0.5 font-mono text-[10px] font-medium sm:inline-block">
          ⌘K
        </kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="md:hidden"
        onClick={openPalette}
        data-testid="global-search-trigger-mobile"
        aria-label="Search"
      >
        <Search className="size-4" aria-hidden="true" />
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            data-testid="global-search-dialog"
            className="bg-background border-border w-full max-w-xl overflow-hidden rounded-lg border shadow-lg"
          >
            <div className="border-border border-b p-3">
              <h2 id={titleId} className="sr-only">
                Global search
              </h2>
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder="Search contacts, conversations, messages…"
                data-testid="global-search-input"
                aria-autocomplete="list"
                aria-controls="global-search-results"
                autoComplete="off"
                spellCheck={false}
              />
              <div
                className="mt-2 flex flex-wrap gap-1"
                role="tablist"
                aria-label="Search categories"
              >
                {categories.map((item) => (
                  <button
                    key={item}
                    type="button"
                    role="tab"
                    aria-selected={category === item}
                    data-testid={`global-search-category-${item}`}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium transition-colors",
                      category === item
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setCategory(item);
                    }}
                  >
                    {CATEGORY_LABELS[item]}
                  </button>
                ))}
              </div>
            </div>

            <div
              id="global-search-results"
              role="listbox"
              aria-label="Search results"
              className="max-h-[50vh] overflow-y-auto p-2"
              data-testid="global-search-results"
            >
              {error ? (
                <p className="text-destructive px-2 py-3 text-sm" role="alert">
                  {error}
                </p>
              ) : null}
              {normalizeSearchQuery(query).length === 0 ? (
                <p className="text-muted-foreground px-2 py-6 text-center text-sm">
                  Type to search this workspace
                </p>
              ) : null}
              {showEmpty ? (
                <p
                  className="text-muted-foreground px-2 py-6 text-center text-sm"
                  data-testid="global-search-empty"
                >
                  No results for “{normalizeSearchQuery(query)}”
                </p>
              ) : null}
              {grouped.map((group) => (
                <div key={group.type} className="mb-2">
                  <p className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
                    {groupLabelForType(group.type)}
                  </p>
                  <ul className="space-y-0.5">
                    {group.hits.map((hit) => {
                      const flatIndex = flatHits.findIndex(
                        (candidate) =>
                          candidate.type === hit.type &&
                          candidate.id === hit.id,
                      );
                      const selected = flatIndex === activeIndex;
                      return (
                        <li key={`${hit.type}:${hit.id}`}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            data-testid={`global-search-hit-${hit.type}`}
                            data-search-hit-id={hit.id}
                            className={cn(
                              "hover:bg-muted w-full rounded-md px-2 py-2 text-left transition-colors",
                              selected && "bg-muted",
                            )}
                            onMouseEnter={() => {
                              setActiveIndex(flatIndex);
                            }}
                            onClick={() => {
                              close();
                              router.push(
                                toAppRoute(
                                  hrefForSearchHit(workspaceSlug, hit),
                                ),
                              );
                            }}
                          >
                            <div className="text-sm font-medium">
                              {hit.title}
                            </div>
                            {hit.subtitle ? (
                              <div className="text-muted-foreground text-xs">
                                {hit.subtitle}
                              </div>
                            ) : null}
                            {hit.snippet ? (
                              <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                                {hit.snippet}
                              </div>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
              {isPending ? (
                <p className="text-muted-foreground px-2 py-2 text-xs">
                  Searching…
                </p>
              ) : null}
            </div>

            <div className="border-border text-muted-foreground flex items-center justify-between border-t px-3 py-2 text-[11px]">
              <span>↑↓ navigate · Enter open · Esc close</span>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={close}
                data-testid="global-search-close"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
