"use client";

import {
  cannedResponsesMessagesEn,
  formatShortcutDisplay,
  listCannedVariables,
  rankCannedResponses,
  unknownCannedVariables,
  CANNED_BODY_MAX_LENGTH,
  CANNED_FOLDER_NAME_MAX_LENGTH,
  CANNED_SHORTCUT_MAX_LENGTH,
  CANNED_TITLE_MAX_LENGTH,
  type CannedFolder,
  type CannedResponse,
  type CannedVisibility,
} from "@site-chat/shared";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCannedResponseAction,
  createCannedResponseFolderAction,
  listCannedResponsesAction,
  setCannedResponseFavoriteAction,
  softDeleteCannedResponseAction,
  softDeleteCannedResponseFolderAction,
  updateCannedResponseAction,
  updateCannedResponseFolderAction,
} from "@/lib/canned/actions";
import { useLiveCannedResponses } from "@/lib/realtime/use-canned-responses";

const messages = cannedResponsesMessagesEn;

const SEARCH_DEBOUNCE_MS = 250;

type Tab = "all" | "workspace" | "personal" | "favorites";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "all", label: messages.tabAll },
  { id: "workspace", label: messages.tabWorkspace },
  { id: "personal", label: messages.tabPersonal },
  { id: "favorites", label: messages.tabFavorites },
];

/** Sentinel filter value; folder ids are UUIDs so it cannot collide with one. */
const UNFILED_FILTER = "unfiled";

/** `null` = every folder, {@link UNFILED_FILTER} = unfiled only, else a folder id. */
type FolderFilter = string | null;

type FormState = {
  mode: "create" | "edit";
  id: string | null;
  title: string;
  body: string;
  shortcut: string;
  visibility: CannedVisibility;
  folderId: string;
};

function emptyForm(visibility: CannedVisibility, folderId: string): FormState {
  return {
    mode: "create",
    id: null,
    title: "",
    body: "",
    shortcut: "",
    visibility,
    folderId,
  };
}

function formFromResponse(item: CannedResponse): FormState {
  return {
    mode: "edit",
    id: item.id,
    title: item.title,
    body: item.body,
    shortcut: item.shortcut ?? "",
    visibility: item.visibility,
    folderId: item.folder_id ?? "",
  };
}

export function CannedResponsesManager({
  workspaceId,
  workspaceSlug,
  memberId,
  initialResponses,
  initialFolders,
  initialHasMore,
  canUse,
  canManageWorkspace,
}: {
  workspaceId: string;
  workspaceSlug: string;
  memberId: string;
  initialResponses: CannedResponse[];
  initialFolders: CannedFolder[];
  initialHasMore: boolean;
  canUse: boolean;
  canManageWorkspace: boolean;
}) {
  const {
    responses,
    folders,
    hasMore,
    connectionState,
    error: liveError,
    applyResponse,
    markResponseDeleted,
    applyFolder,
    markFolderDeleted,
    retry,
  } = useLiveCannedResponses({
    workspaceId,
    workspaceSlug,
    memberId,
    initialResponses,
    initialFolders,
    initialHasMore,
    includeFolders: true,
    enabled: Boolean(memberId),
  });

  const [tab, setTab] = useState<Tab>("all");
  const [folderFilter, setFolderFilter] = useState<FolderFilter>(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [remoteMatches, setRemoteMatches] = useState<CannedResponse[] | null>(
    null,
  );

  const defaultVisibility: CannedVisibility = canManageWorkspace
    ? "workspace"
    : "personal";

  // Large libraries are truncated at 200 rows, so searching them has to reach
  // the database ranking rather than filtering an incomplete local list.
  useEffect(() => {
    const query = search.trim();
    if (!hasMore || query.length === 0) {
      setRemoteMatches(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await listCannedResponsesAction(workspaceSlug, {
          q: query,
          limit: 200,
          include_folders: false,
        });
        if (cancelled) {
          return;
        }
        if (result.success) {
          setRemoteMatches(result.data.items);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasMore, search, workspaceSlug]);

  const visible = useMemo(() => {
    const base = remoteMatches ?? responses;
    const scoped = base.filter((item) => {
      if (tab === "workspace" && item.visibility !== "workspace") return false;
      if (tab === "personal" && item.visibility !== "personal") return false;
      if (tab === "favorites" && !item.is_favorited) return false;
      if (folderFilter === UNFILED_FILTER && item.folder_id !== null)
        return false;
      if (
        folderFilter !== null &&
        folderFilter !== UNFILED_FILTER &&
        item.folder_id !== folderFilter
      ) {
        return false;
      }
      return true;
    });

    const query = search.trim();
    // Remote results are already ranked by the RPC, which is typo-tolerant in
    // ways the client scorer is not — re-ranking them here would discard the
    // trigram and full-text matches that made the round trip worthwhile.
    if (query.length === 0 || remoteMatches) {
      return scoped;
    }
    return rankCannedResponses(scoped, query);
  }, [folderFilter, remoteMatches, responses, search, tab]);

  function canManageItem(item: CannedResponse): boolean {
    if (!canUse) {
      return false;
    }
    if (item.visibility === "workspace") {
      return canManageWorkspace;
    }
    return item.owner_member_id === memberId;
  }

  function canManageFolder(folder: CannedFolder): boolean {
    if (!canUse) {
      return false;
    }
    if (folder.visibility === "workspace") {
      return canManageWorkspace;
    }
    return folder.owner_member_id === memberId;
  }

  async function toggleFavorite(item: CannedResponse) {
    setActionError(null);
    // Optimistic pin so the Favorites tab reacts immediately.
    applyResponse({ ...item, is_favorited: !item.is_favorited });
    const result = await setCannedResponseFavoriteAction(workspaceSlug, {
      cannedResponseId: item.id,
      favorited: !item.is_favorited,
    });
    if (!result.success) {
      applyResponse(item);
      setActionError(result.message);
      return;
    }
    applyResponse(result.data);
  }

  async function removeResponse(item: CannedResponse) {
    setActionError(null);
    // Await the Server Action before removing from the list. Optimistic removal
    // raced with reload/navigation and could resurrect a still-active SSR row.
    const result = await softDeleteCannedResponseAction(workspaceSlug, {
      cannedResponseId: item.id,
    });
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    markResponseDeleted(item.id);
    if (form?.id === item.id) {
      setForm(null);
    }
  }

  const emptyMessage =
    search.trim().length > 0
      ? messages.searchEmpty
      : tab === "personal"
        ? messages.emptyPersonal
        : tab === "favorites"
          ? messages.emptyFavorites
          : messages.empty;

  return (
    <div className="space-y-4" data-testid="canned-responses-page">
      {memberId ? <ConnectionBanner state={connectionState} /> : null}

      {!canUse ? (
        <p
          className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm"
          data-testid="canned-viewer-notice"
        >
          {messages.viewerNotice}
        </p>
      ) : !canManageWorkspace ? (
        <p
          className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm"
          data-testid="canned-agent-notice"
        >
          {messages.agentNotice}
        </p>
      ) : null}

      {liveError ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p className="text-destructive" data-testid="canned-live-error">
            {liveError}
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={retry}>
            {messages.retry}
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <p
          className="text-destructive text-sm"
          role="alert"
          data-testid="canned-action-error"
        >
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FolderSidebar
          folders={folders}
          activeFilter={folderFilter}
          canUse={canUse}
          canManageWorkspace={canManageWorkspace}
          canManageFolder={canManageFolder}
          onSelect={setFolderFilter}
          workspaceSlug={workspaceSlug}
          onFolderSaved={applyFolder}
          onFolderDeleted={markFolderDeleted}
          onError={setActionError}
        />

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label="Canned response scope"
              data-testid="canned-tabs"
            >
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id}
                  data-testid={`canned-tab-${entry.id}`}
                  className={
                    tab === entry.id
                      ? "border-foreground border-b-2 px-3 py-2 text-sm font-medium"
                      : "text-muted-foreground px-3 py-2 text-sm"
                  }
                  onClick={() => {
                    setTab(entry.id);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {canUse ? (
              <Button
                type="button"
                size="sm"
                data-testid="canned-create"
                onClick={() => {
                  setActionError(null);
                  setForm(
                    emptyForm(
                      defaultVisibility,
                      folderFilter && folderFilter !== UNFILED_FILTER
                        ? folderFilter
                        : "",
                    ),
                  );
                }}
              >
                {messages.create}
              </Button>
            ) : null}
          </div>

          <div className="max-w-sm">
            <Label className="sr-only" htmlFor="canned-search">
              {messages.searchLabel}
            </Label>
            <Input
              id="canned-search"
              type="search"
              data-testid="canned-search"
              placeholder={messages.searchPlaceholder}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </div>

          {form ? (
            <CannedForm
              key={form.id ?? "create"}
              form={form}
              folders={folders}
              memberId={memberId}
              canManageWorkspace={canManageWorkspace}
              workspaceSlug={workspaceSlug}
              onChange={setForm}
              onClose={() => {
                setForm(null);
              }}
              onSaved={(item) => {
                applyResponse(item);
                setForm(null);
              }}
            />
          ) : null}

          {hasMore ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="canned-truncated"
            >
              {messages.truncated}
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p
              className="text-muted-foreground rounded-md border border-dashed px-4 py-8 text-sm"
              data-testid="canned-empty"
            >
              {emptyMessage}
            </p>
          ) : (
            <ul className="space-y-3" data-testid="canned-list">
              {visible.map((item) => (
                <li key={item.id}>
                  <CannedRow
                    item={item}
                    folderName={
                      folders.find((folder) => folder.id === item.folder_id)
                        ?.name ?? null
                    }
                    canUse={canUse}
                    canManage={canManageItem(item)}
                    onEdit={() => {
                      setActionError(null);
                      setForm(formFromResponse(item));
                    }}
                    onDelete={() => {
                      void removeResponse(item);
                    }}
                    onToggleFavorite={() => {
                      void toggleFavorite(item);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function CannedRow({
  item,
  folderName,
  canUse,
  canManage,
  onEdit,
  onDelete,
  onToggleFavorite,
}: {
  item: CannedResponse;
  folderName: string | null;
  canUse: boolean;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <article
      className="rounded-md border p-3"
      data-testid="canned-item"
      data-canned-id={item.id}
      data-visibility={item.visibility}
      data-favorited={item.is_favorited ? "true" : "false"}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium" data-testid="canned-item-title">
              {item.title}
            </h3>
            {item.shortcut ? (
              <code
                className="bg-muted rounded px-1.5 py-0.5 text-xs"
                data-testid="canned-item-shortcut"
              >
                {formatShortcutDisplay(item.shortcut)}
              </code>
            ) : null}
            <span className="text-muted-foreground rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              {item.visibility === "workspace"
                ? messages.badgeWorkspace
                : messages.badgePersonal}
            </span>
            {folderName ? (
              <span className="text-muted-foreground text-xs">
                {folderName}
              </span>
            ) : null}
          </div>
          <p
            className="text-muted-foreground line-clamp-3 text-sm whitespace-pre-wrap"
            data-testid="canned-item-body"
          >
            {item.body}
          </p>
          <p className="text-muted-foreground text-xs">
            {item.usage_count} {messages.usageCount}
            {item.owner_display_label ? ` · ${item.owner_display_label}` : ""}
            {!canManage && canUse ? ` · ${messages.readOnlyRow}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {canUse ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={item.is_favorited}
              data-testid="canned-favorite"
              onClick={onToggleFavorite}
            >
              {item.is_favorited ? messages.unfavorite : messages.favorite}
            </Button>
          ) : null}
          {canManage ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                data-testid="canned-edit"
                onClick={onEdit}
              >
                {messages.edit}
              </Button>
              {confirming ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    data-testid="canned-delete-confirm"
                    onClick={() => {
                      setConfirming(false);
                      onDelete();
                    }}
                  >
                    {messages.delete}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setConfirming(false);
                    }}
                  >
                    {messages.cancel}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="canned-delete"
                  onClick={() => {
                    setConfirming(true);
                  }}
                >
                  {messages.delete}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function CannedForm({
  form,
  folders,
  memberId,
  canManageWorkspace,
  workspaceSlug,
  onChange,
  onClose,
  onSaved,
}: {
  form: FormState;
  folders: CannedFolder[];
  memberId: string;
  canManageWorkspace: boolean;
  workspaceSlug: string;
  onChange: (next: FormState) => void;
  onClose: () => void;
  onSaved: (item: CannedResponse) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // A snippet may only live in a folder of the same scope, otherwise the RPC
  // raises FOLDER_SCOPE_MISMATCH.
  const folderOptions = folders.filter(
    (folder) =>
      folder.visibility === form.visibility &&
      (folder.visibility === "workspace" ||
        folder.owner_member_id === memberId),
  );

  const unknownVariables = unknownCannedVariables(form.body);

  function insertVariable(token: string) {
    const textarea = bodyRef.current;
    if (!textarea) {
      onChange({ ...form, body: `${form.body}${token}` });
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const next = `${form.body.slice(0, start)}${token}${form.body.slice(end)}`;
    onChange({ ...form, body: next });
    const caret = start + token.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    });
  }

  function submit() {
    if (isPending) {
      return;
    }
    setError(null);
    setIsPending(true);
    void (async () => {
      try {
        const result =
          form.mode === "create"
            ? await createCannedResponseAction(workspaceSlug, {
                title: form.title,
                body: form.body,
                shortcut: form.shortcut,
                visibility: form.visibility,
                folderId: form.folderId === "" ? null : form.folderId,
              })
            : await updateCannedResponseAction(workspaceSlug, {
                cannedResponseId: form.id,
                title: form.title,
                body: form.body,
                shortcut: form.shortcut,
                folderId: form.folderId === "" ? null : form.folderId,
              });

        if (!result.success) {
          setError(result.message);
          return;
        }
        onSaved(result.data);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unable to save canned response.",
        );
      } finally {
        setIsPending(false);
      }
    })();
  }

  return (
    <form
      className="space-y-3 rounded-md border p-4"
      data-testid="canned-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-sm font-medium">
        {form.mode === "create" ? messages.createTitle : messages.editTitle}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="canned-form-title">{messages.fieldTitle}</Label>
          <Input
            id="canned-form-title"
            data-testid="canned-form-title"
            value={form.title}
            maxLength={CANNED_TITLE_MAX_LENGTH}
            required
            onChange={(event) => {
              onChange({ ...form, title: event.target.value });
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="canned-form-shortcut">{messages.fieldShortcut}</Label>
          <Input
            id="canned-form-shortcut"
            data-testid="canned-form-shortcut"
            value={form.shortcut}
            maxLength={CANNED_SHORTCUT_MAX_LENGTH + 1}
            placeholder="/refund"
            onChange={(event) => {
              onChange({ ...form, shortcut: event.target.value });
            }}
          />
          <p className="text-muted-foreground text-xs">
            {messages.fieldShortcutHint}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="canned-form-visibility">
            {messages.fieldVisibility}
          </Label>
          <select
            id="canned-form-visibility"
            data-testid="canned-form-visibility"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-sm disabled:opacity-50"
            value={form.visibility}
            disabled={form.mode === "edit"}
            onChange={(event) => {
              const visibility =
                event.target.value === "personal" ? "personal" : "workspace";
              // Folder scope must follow visibility.
              onChange({ ...form, visibility, folderId: "" });
            }}
          >
            {canManageWorkspace ? (
              <option value="workspace">
                {messages.fieldVisibilityWorkspace}
              </option>
            ) : null}
            <option value="personal">{messages.fieldVisibilityPersonal}</option>
          </select>
          {form.mode === "edit" ? (
            <p className="text-muted-foreground text-xs">
              {messages.fieldVisibilityLocked}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label htmlFor="canned-form-folder">{messages.fieldFolder}</Label>
          <select
            id="canned-form-folder"
            data-testid="canned-form-folder"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-sm"
            value={form.folderId}
            onChange={(event) => {
              onChange({ ...form, folderId: event.target.value });
            }}
          >
            <option value="">{messages.folderPlaceholder}</option>
            {folderOptions.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="canned-form-body">{messages.fieldBody}</Label>
        <textarea
          id="canned-form-body"
          ref={bodyRef}
          data-testid="canned-form-body"
          className="border-input bg-background min-h-[140px] w-full resize-y rounded-md border px-3 py-2 text-sm shadow-sm"
          value={form.body}
          maxLength={CANNED_BODY_MAX_LENGTH}
          required
          onChange={(event) => {
            onChange({ ...form, body: event.target.value });
          }}
        />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">{messages.variablesTitle}</p>
        <p className="text-muted-foreground text-xs">
          {messages.variablesHint}
        </p>
        <div className="flex flex-wrap gap-2" data-testid="canned-variables">
          {listCannedVariables().map((variable) => (
            <button
              key={variable.name}
              type="button"
              title={variable.description}
              data-testid="canned-variable-chip"
              className="bg-muted hover:bg-muted/70 focus-visible:ring-ring rounded-full px-2.5 py-1 font-mono text-xs focus-visible:ring-1 focus-visible:outline-none"
              onClick={() => {
                insertVariable(variable.token);
              }}
            >
              {variable.token}
            </button>
          ))}
        </div>
        {unknownVariables.length > 0 ? (
          <p
            className="text-muted-foreground text-xs"
            data-testid="canned-unknown-variables"
          >
            Unrecognized and left as-is when inserted:{" "}
            {unknownVariables.map((token) => `{{${token}}}`).join(", ")}
          </p>
        ) : null}
      </div>

      {error ? (
        <p
          className="text-destructive text-sm"
          role="alert"
          data-testid="canned-form-error"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          size="sm"
          data-testid="canned-form-submit"
          disabled={
            isPending ||
            form.title.trim().length === 0 ||
            form.body.trim().length === 0
          }
        >
          {isPending ? messages.saving : messages.save}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          data-testid="canned-form-cancel"
          onClick={onClose}
        >
          {messages.cancel}
        </Button>
      </div>
    </form>
  );
}

function FolderSidebar({
  folders,
  activeFilter,
  canUse,
  canManageWorkspace,
  canManageFolder,
  onSelect,
  workspaceSlug,
  onFolderSaved,
  onFolderDeleted,
  onError,
}: {
  folders: CannedFolder[];
  activeFilter: FolderFilter;
  canUse: boolean;
  canManageWorkspace: boolean;
  canManageFolder: (folder: CannedFolder) => boolean;
  onSelect: (filter: FolderFilter) => void;
  workspaceSlug: string;
  onFolderSaved: (folder: CannedFolder) => void;
  onFolderDeleted: (folderId: string) => void;
  onError: (message: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<CannedVisibility>(
    canManageWorkspace ? "workspace" : "personal",
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isPending, setIsPending] = useState(false);

  async function createFolder() {
    if (isPending || name.trim().length === 0) {
      return;
    }
    setIsPending(true);
    onError(null);
    const result = await createCannedResponseFolderAction(workspaceSlug, {
      name,
      visibility,
    });
    setIsPending(false);
    if (!result.success) {
      onError(result.message);
      return;
    }
    onFolderSaved(result.data);
    setName("");
    setCreating(false);
  }

  async function renameFolder(folder: CannedFolder) {
    if (isPending || renameValue.trim().length === 0) {
      return;
    }
    setIsPending(true);
    onError(null);
    const result = await updateCannedResponseFolderAction(workspaceSlug, {
      folderId: folder.id,
      name: renameValue,
      sortOrder: folder.sort_order,
    });
    setIsPending(false);
    if (!result.success) {
      onError(result.message);
      return;
    }
    onFolderSaved(result.data);
    setRenamingId(null);
  }

  async function deleteFolder(folder: CannedFolder) {
    if (isPending) {
      return;
    }
    setIsPending(true);
    onError(null);
    onFolderDeleted(folder.id);
    const result = await softDeleteCannedResponseFolderAction(workspaceSlug, {
      folderId: folder.id,
    });
    setIsPending(false);
    if (!result.success) {
      onFolderSaved(folder);
      onError(result.message);
    }
  }

  function filterButtonClass(active: boolean): string {
    return active
      ? "bg-muted w-full rounded-md px-2 py-1.5 text-left text-sm font-medium"
      : "hover:bg-muted/60 w-full rounded-md px-2 py-1.5 text-left text-sm";
  }

  return (
    <aside className="space-y-2" data-testid="canned-folders">
      <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {messages.foldersTitle}
      </p>

      <ul className="space-y-1">
        <li>
          <button
            type="button"
            className={filterButtonClass(activeFilter === null)}
            data-testid="canned-folder-all"
            onClick={() => {
              onSelect(null);
            }}
          >
            {messages.folderAll}
          </button>
        </li>
        <li>
          <button
            type="button"
            className={filterButtonClass(activeFilter === UNFILED_FILTER)}
            data-testid="canned-folder-none"
            onClick={() => {
              onSelect(UNFILED_FILTER);
            }}
          >
            {messages.folderNone}
          </button>
        </li>
        {folders.map((folder) => (
          <li key={folder.id} data-testid="canned-folder-item">
            {renamingId === folder.id ? (
              <div className="space-y-1">
                <Label
                  className="sr-only"
                  htmlFor={`folder-rename-${folder.id}`}
                >
                  {messages.folderNameLabel}
                </Label>
                <Input
                  id={`folder-rename-${folder.id}`}
                  value={renameValue}
                  maxLength={CANNED_FOLDER_NAME_MAX_LENGTH}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                  }}
                />
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => {
                      void renameFolder(folder);
                    }}
                  >
                    {messages.save}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenamingId(null);
                    }}
                  >
                    {messages.cancel}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className={filterButtonClass(activeFilter === folder.id)}
                  data-testid="canned-folder-select"
                  onClick={() => {
                    onSelect(folder.id);
                  }}
                >
                  <span className="truncate">{folder.name}</span>
                  <span className="text-muted-foreground ml-1 text-xs">
                    {folder.response_count}
                  </span>
                </button>
                {canManageFolder(folder) ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${messages.folderRename} ${folder.name}`}
                      data-testid="canned-folder-rename"
                      onClick={() => {
                        setRenamingId(folder.id);
                        setRenameValue(folder.name);
                      }}
                    >
                      {messages.folderRename}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`${messages.folderDelete} ${folder.name}`}
                      title={messages.folderDeleteHint}
                      data-testid="canned-folder-delete"
                      onClick={() => {
                        void deleteFolder(folder);
                      }}
                    >
                      {messages.delete}
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>

      {canUse ? (
        creating ? (
          <div className="space-y-2 rounded-md border p-2">
            <Label className="sr-only" htmlFor="canned-folder-name">
              {messages.folderNameLabel}
            </Label>
            <Input
              id="canned-folder-name"
              data-testid="canned-folder-name"
              value={name}
              maxLength={CANNED_FOLDER_NAME_MAX_LENGTH}
              placeholder={messages.folderNameLabel}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Label className="sr-only" htmlFor="canned-folder-visibility">
              {messages.folderVisibilityLabel}
            </Label>
            <select
              id="canned-folder-visibility"
              data-testid="canned-folder-visibility"
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={visibility}
              onChange={(event) => {
                setVisibility(
                  event.target.value === "personal" ? "personal" : "workspace",
                );
              }}
            >
              {canManageWorkspace ? (
                <option value="workspace">{messages.badgeWorkspace}</option>
              ) : null}
              <option value="personal">{messages.badgePersonal}</option>
            </select>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                data-testid="canned-folder-submit"
                disabled={isPending || name.trim().length === 0}
                onClick={() => {
                  void createFolder();
                }}
              >
                {messages.folderCreateSubmit}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  setName("");
                }}
              >
                {messages.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="canned-folder-create"
            onClick={() => {
              setCreating(true);
            }}
          >
            {messages.folderCreate}
          </Button>
        )
      ) : null}
    </aside>
  );
}
