"use client";

import {
  createClientNoteId,
  detectMentionTrigger,
  filterMentionableMembers,
  formatMentionToken,
  internalNotesMessagesEn,
  mentionIdsForSubmit,
  mergeInternalNotes,
  pruneMentionBindings,
  splitNoteBodyWithMentions,
  type InternalNote,
  type WorkspaceMemberOption,
} from "@site-chat/shared";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { ConnectionBanner } from "@/components/inbox/ConnectionBanner";
import { Button } from "@/components/ui/button";
import {
  createInternalNoteAction,
  softDeleteInternalNoteAction,
  updateInternalNoteAction,
} from "@/lib/inbox/actions";
import { formatRelativeTime } from "@/lib/inbox/search-params";
import { useLiveInternalNotes } from "@/lib/realtime/use-internal-notes";

const messages = internalNotesMessagesEn;

function authorInitials(label: string): string {
  const part = label.split("@")[0] ?? label;
  return part.slice(0, 2).toUpperCase();
}

function NoteBody({ note }: { note: InternalNote }) {
  const segments = splitNoteBodyWithMentions(note.body, note.mentions);
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed">
      {segments.map((segment, index) =>
        segment.type === "mention" ? (
          <span
            key={`${note.id}-m-${String(index)}`}
            className="rounded bg-amber-200/80 px-0.5 font-medium text-amber-950"
          >
            {segment.text}
          </span>
        ) : (
          <span key={`${note.id}-t-${String(index)}`}>{segment.text}</span>
        ),
      )}
    </p>
  );
}

function MentionAutocomplete({
  members,
  query,
  activeIndex,
  onSelect,
}: {
  members: WorkspaceMemberOption[];
  query: string;
  activeIndex: number;
  onSelect: (member: WorkspaceMemberOption) => void;
}) {
  const filtered = filterMentionableMembers(members, query);
  if (filtered.length === 0) {
    return (
      <div
        className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-md border bg-background p-2 text-sm shadow-md"
        data-testid="note-mention-menu"
      >
        <p className="text-muted-foreground">{messages.mentionEmpty}</p>
      </div>
    );
  }

  return (
    <ul
      className="absolute bottom-full left-0 z-20 mb-1 max-h-48 w-72 overflow-auto rounded-md border bg-background py-1 shadow-md"
      role="listbox"
      data-testid="note-mention-menu"
    >
      {filtered.map((member, index) => (
        <li key={member.member_id}>
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            className={
              index === activeIndex
                ? "bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
                : "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/70"
            }
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(member);
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-900">
              {authorInitials(member.display_label)}
            </span>
            <span className="truncate">{member.display_label}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useMentionDraft(
  members: WorkspaceMemberOption[],
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  initialBody = "",
) {
  const [body, setBody] = useState(initialBody);
  const [, setBindings] = useState(() => new Map<string, string>());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  const filteredMentions = useMemo(
    () =>
      mentionQuery === null
        ? []
        : filterMentionableMembers(members, mentionQuery),
    [members, mentionQuery],
  );

  function syncMentionTrigger(value: string, caret: number) {
    const trigger = detectMentionTrigger(value, caret);
    if (!trigger) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(trigger.query);
    setMentionIndex(0);
  }

  function applyBodyChange(value: string, caret: number) {
    setBody(value);
    setBindings((current) => pruneMentionBindings(value, current));
    syncMentionTrigger(value, caret);
  }

  function resetDraft(nextBody = "") {
    setBody(nextBody);
    setBindings(new Map());
    setMentionQuery(null);
    setMentionIndex(0);
  }

  function insertMention(member: WorkspaceMemberOption) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart;
    const trigger = detectMentionTrigger(body, caret);
    if (!trigger) return;

    const token = formatMentionToken(member);
    const before = body.slice(0, trigger.replaceStart);
    const after = body.slice(caret);
    const needsSpace = after.length === 0 || !/^\s/.test(after);
    const nextBody = `${before}${token}${needsSpace ? " " : ""}${after}`;

    setBody(nextBody);
    setBindings((current) => {
      const next = new Map(current);
      next.set(member.member_id, member.display_label);
      return pruneMentionBindings(nextBody, next);
    });
    setMentionQuery(null);
    setMentionIndex(0);

    const nextCaret = before.length + token.length + (needsSpace ? 1 : 0);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function onMentionKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): boolean {
    if (mentionQuery === null) {
      return false;
    }

    if (filteredMentions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => (index + 1) % filteredMentions.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex(
          (index) =>
            (index - 1 + filteredMentions.length) % filteredMentions.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const member = filteredMentions[mentionIndex];
        if (member) {
          insertMention(member);
        }
        return true;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMentionQuery(null);
      return true;
    }

    return false;
  }

  return {
    body,
    mentionQuery,
    mentionIndex,
    applyBodyChange,
    syncMentionTrigger,
    resetDraft,
    insertMention,
    onMentionKeyDown,
  };
}

function NoteComposer({
  workspaceSlug,
  conversationId,
  members,
  canWrite,
  onCreated,
}: {
  workspaceSlug: string;
  conversationId: string;
  members: WorkspaceMemberOption[];
  canWrite: boolean;
  onCreated: (note: InternalNote) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const clientNoteIdRef = useRef(createClientNoteId());
  const {
    body,
    mentionQuery,
    mentionIndex,
    applyBodyChange,
    syncMentionTrigger,
    resetDraft,
    insertMention,
    onMentionKeyDown,
  } = useMentionDraft(members, textareaRef);

  function clearDraft() {
    resetDraft("");
    clientNoteIdRef.current = createClientNoteId();
    setError(null);
    setErrorCode(null);
  }

  function retryAsNew() {
    // Explicit new create after NOTE_DELETED — mint a fresh idempotency key.
    clientNoteIdRef.current = createClientNoteId();
    setError(null);
    setErrorCode(null);
    submit();
  }

  function submit() {
    const trimmed = body.trim();
    if (!trimmed || !canWrite || isPending) return;
    const clientNoteId = clientNoteIdRef.current;
    const mentionIds = mentionIdsForSubmit(body);
    setError(null);
    setErrorCode(null);
    setIsPending(true);
    void (async () => {
      try {
        const result = await createInternalNoteAction(workspaceSlug, {
          conversationId,
          body: trimmed,
          clientNoteId,
          mentionedMemberIds: mentionIds,
        });
        if (!result.success) {
          setError(result.message);
          setErrorCode(result.code ?? null);
          // NOTE_DELETED and other errors must preserve the draft + clientNoteId
          // (except retry-as-new, which mints a new id explicitly).
          return;
        }
        if (result.data && "id" in result.data && "body" in result.data) {
          onCreated(result.data);
        }
        clearDraft();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save note.");
        setErrorCode(null);
      } finally {
        setIsPending(false);
      }
    })();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (onMentionKeyDown(event)) {
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  if (!canWrite) {
    return null;
  }

  return (
    <div className="relative space-y-2 border-t pt-3">
      {mentionQuery !== null ? (
        <MentionAutocomplete
          members={members}
          query={mentionQuery}
          activeIndex={mentionIndex}
          onSelect={insertMention}
        />
      ) : null}
      <label className="sr-only" htmlFor="internal-note-composer">
        {messages.composerPlaceholder}
      </label>
      <textarea
        id="internal-note-composer"
        ref={textareaRef}
        data-testid="internal-note-composer"
        className="min-h-[88px] w-full resize-y rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm outline-none ring-amber-300 focus:ring-2"
        placeholder={messages.composerPlaceholder}
        value={body}
        disabled={isPending}
        onChange={(event) => {
          applyBodyChange(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          syncMentionTrigger(
            event.currentTarget.value,
            event.currentTarget.selectionStart,
          );
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{messages.mentionHint}</p>
        <div className="flex items-center gap-2">
          {errorCode === "NOTE_DELETED" ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              data-testid="internal-note-retry-as-new"
              disabled={isPending || body.trim().length === 0}
              onClick={retryAsNew}
            >
              {messages.retryAsNew}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="internal-note-send"
            disabled={isPending || body.trim().length === 0}
            onClick={submit}
          >
            {isPending ? messages.saving : messages.send}
          </Button>
        </div>
      </div>
      {error ? (
        <p
          className="text-destructive text-sm"
          role="alert"
          data-testid="internal-note-composer-error"
          data-error-code={errorCode ?? undefined}
        >
          {errorCode === "NOTE_DELETED" ? messages.noteDeletedRetry : error}
        </p>
      ) : null}
    </div>
  );
}

function NoteCard({
  note,
  workspaceSlug,
  conversationId,
  members,
  canWrite,
  onUpdated,
  onDeleted,
  onDeleteFailed,
}: {
  note: InternalNote;
  workspaceSlug: string;
  conversationId: string;
  members: WorkspaceMemberOption[];
  canWrite: boolean;
  onUpdated: (note: InternalNote) => void;
  onDeleted: (noteId: string) => void;
  onDeleteFailed: (noteId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    body: draft,
    mentionQuery,
    mentionIndex,
    applyBodyChange,
    syncMentionTrigger,
    resetDraft,
    insertMention,
    onMentionKeyDown,
  } = useMentionDraft(members, textareaRef, note.body);

  useEffect(() => {
    if (editing) {
      return;
    }
    resetDraft(note.body);
    // resetDraft is intentionally omitted: only re-sync when the note identity/body changes while not editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft sync from note props
  }, [note.body, note.id, editing]);

  function save() {
    const trimmed = draft.trim();
    if (!trimmed || isPending) return;
    const mentionIds = mentionIdsForSubmit(draft);
    setError(null);
    setIsPending(true);
    void (async () => {
      try {
        const result = await updateInternalNoteAction(workspaceSlug, {
          noteId: note.id,
          body: trimmed,
          mentionedMemberIds: mentionIds,
          conversationId,
        });
        if (!result.success) {
          setError(result.message);
          return;
        }
        if (result.data && "id" in result.data) {
          onUpdated(result.data);
        }
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to save note.");
      } finally {
        setIsPending(false);
      }
    })();
  }

  function remove() {
    if (isPending) return;
    setError(null);
    setIsPending(true);
    // Optimistic tombstone so a stale catch-up cannot resurrect mid-flight.
    onDeleted(note.id);
    void (async () => {
      try {
        const result = await softDeleteInternalNoteAction(workspaceSlug, {
          noteId: note.id,
          conversationId,
        });
        if (!result.success) {
          onDeleteFailed(note.id);
          setError(result.message);
          return;
        }
      } catch (err) {
        onDeleteFailed(note.id);
        setError(err instanceof Error ? err.message : "Unable to delete note.");
      } finally {
        setIsPending(false);
      }
    })();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onMentionKeyDown(event);
  }

  return (
    <article
      className="rounded-md border border-amber-200/80 bg-amber-50/70 p-3"
      data-testid="internal-note-item"
      data-note-id={note.id}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-200 text-xs font-semibold text-amber-950"
            aria-hidden
          >
            {authorInitials(note.author_display_label)}
          </span>
          <div>
            <p className="text-sm font-medium">{note.author_display_label}</p>
            <p className="text-muted-foreground text-xs">
              <span className="mr-2 rounded bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                {messages.privateBadge}
              </span>
              {formatRelativeTime(note.created_at)}
              {note.updated_at !== note.created_at ? " · edited" : null}
            </p>
          </div>
        </div>
        {canWrite ? (
          <div className="flex gap-1">
            {editing ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={save}
                >
                  {messages.save}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    setEditing(false);
                    resetDraft(note.body);
                  }}
                >
                  {messages.cancel}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => {
                    resetDraft(note.body);
                    setEditing(true);
                  }}
                >
                  {messages.edit}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  data-testid="internal-note-delete"
                  disabled={isPending}
                  onClick={remove}
                >
                  {messages.delete}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {editing ? (
        <div className="relative">
          {mentionQuery !== null ? (
            <MentionAutocomplete
              members={members}
              query={mentionQuery}
              activeIndex={mentionIndex}
              onSelect={insertMention}
            />
          ) : null}
          <textarea
            className="min-h-[72px] w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
            ref={textareaRef}
            value={draft}
            disabled={isPending}
            onChange={(event) => {
              applyBodyChange(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onClick={(event) => {
              syncMentionTrigger(
                event.currentTarget.value,
                event.currentTarget.selectionStart,
              );
            }}
          />
        </div>
      ) : (
        <NoteBody note={note} />
      )}
      {error ? (
        <p className="text-destructive mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

export function InternalNotesPanel({
  workspaceId,
  workspaceSlug,
  conversationId,
  memberId,
  members,
  initialNotes,
  canManage,
  active = true,
}: {
  workspaceId: string;
  workspaceSlug: string;
  conversationId: string;
  memberId: string;
  members: WorkspaceMemberOption[];
  initialNotes: InternalNote[];
  canManage: boolean;
  active?: boolean;
}) {
  const {
    notes,
    setNotes,
    connectionState,
    mentionFlash,
    error,
    markNoteDeleted,
    clearLocalTombstone,
    retry,
  } = useLiveInternalNotes({
    workspaceId,
    workspaceSlug,
    conversationId,
    memberId,
    initialNotes,
    enabled: canManage,
    active,
  });

  if (!canManage) {
    return (
      <div
        className="text-muted-foreground p-4 text-sm"
        data-testid="internal-notes-denied"
      >
        {messages.viewerDenied}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-[420px] flex-col gap-3"
      data-testid="internal-notes-panel"
    >
      <ConnectionBanner state={connectionState} />
      {mentionFlash ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-950"
          data-testid="internal-note-mention-flash"
          role="status"
        >
          {mentionFlash}
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <p className="text-destructive">{error}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              retry();
            }}
          >
            {messages.retry}
          </Button>
        </div>
      ) : null}

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {notes.length === 0 ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="internal-notes-empty"
          >
            {messages.empty}
          </p>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              workspaceSlug={workspaceSlug}
              conversationId={conversationId}
              members={members}
              canWrite={canManage}
              onUpdated={(updated) => {
                setNotes((current) => mergeInternalNotes(current, [updated]));
              }}
              onDeleted={markNoteDeleted}
              onDeleteFailed={(noteId) => {
                clearLocalTombstone(noteId);
                retry();
              }}
            />
          ))
        )}
      </div>

      <NoteComposer
        workspaceSlug={workspaceSlug}
        conversationId={conversationId}
        members={members}
        canWrite={canManage}
        onCreated={(created) => {
          setNotes((current) => mergeInternalNotes(current, [created]));
        }}
      />
    </div>
  );
}
