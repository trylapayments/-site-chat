"use client";

import {
  cannedResponsesMessagesEn,
  detectSlashTrigger,
  filterCannedResponsesForSlash,
  formatShortcutDisplay,
  interpolateCannedBody,
  replaceSlashTrigger,
  type CannedResponse,
  type CannedVariableContext,
} from "@site-chat/shared";
import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";

const messages = cannedResponsesMessagesEn;

export function CannedSlashMenu({
  options,
  activeIndex,
  onSelect,
}: {
  options: CannedResponse[];
  activeIndex: number;
  onSelect: (item: CannedResponse) => void;
}) {
  if (options.length === 0) {
    return (
      <div
        className="bg-background absolute bottom-full left-0 z-20 mb-1 w-80 rounded-md border p-2 text-sm shadow-md"
        data-testid="canned-slash-menu"
      >
        <p className="text-muted-foreground">{messages.slashEmpty}</p>
      </div>
    );
  }

  return (
    <ul
      className="bg-background absolute bottom-full left-0 z-20 mb-1 max-h-60 w-80 overflow-auto rounded-md border py-1 shadow-md"
      role="listbox"
      aria-label={messages.slashHint}
      data-testid="canned-slash-menu"
    >
      {options.map((item, index) => (
        <li key={item.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === activeIndex}
            data-testid="canned-slash-option"
            data-canned-id={item.id}
            className={
              index === activeIndex
                ? "bg-muted block w-full px-3 py-2 text-left text-sm"
                : "hover:bg-muted/70 block w-full px-3 py-2 text-left text-sm"
            }
            // Mouse down instead of click: the textarea must keep focus and its
            // caret so the trigger is still resolvable when we replace it.
            onMouseDown={(event) => {
              event.preventDefault();
              onSelect(item);
            }}
          >
            <span className="flex items-center gap-2">
              <span className="truncate font-medium">{item.title}</span>
              {item.shortcut ? (
                <code className="bg-muted rounded px-1 py-0.5 text-xs">
                  {formatShortcutDisplay(item.shortcut)}
                </code>
              ) : null}
              {item.visibility === "personal" ? (
                <span className="text-muted-foreground text-[10px] font-semibold uppercase">
                  {messages.badgePersonal}
                </span>
              ) : null}
            </span>
            <span className="text-muted-foreground line-clamp-1 block text-xs">
              {item.body}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Slash-command state for a reply composer, mirroring the `@mention` draft hook
 * in InternalNotesPanel: the trigger is recomputed from the caret on every
 * change, and the menu owns Arrow/Enter/Tab/Escape while it is open.
 */
export function useCannedSlash({
  items,
  enabled,
  body,
  textareaRef,
  context,
  onInsert,
}: {
  items: CannedResponse[];
  enabled: boolean;
  body: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  context: CannedVariableContext;
  onInsert: (
    next: { body: string; caret: number },
    used: CannedResponse,
  ) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const options = useMemo(
    () =>
      query === null || !enabled
        ? []
        : filterCannedResponsesForSlash(items, query),
    [enabled, items, query],
  );

  function close() {
    setQuery(null);
    setActiveIndex(0);
  }

  function sync(value: string, caret: number) {
    if (!enabled) {
      return;
    }
    const trigger = detectSlashTrigger(value, caret);
    if (!trigger) {
      close();
      return;
    }
    setQuery(trigger.query);
    setActiveIndex(0);
  }

  function select(item: CannedResponse) {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    const replacement = interpolateCannedBody(item.body, context);
    const next = replaceSlashTrigger(
      body,
      textarea.selectionStart,
      replacement,
    );
    if (!next) {
      close();
      return;
    }
    close();
    onInsert(next, item);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.caret, next.caret);
    });
  }

  /** True when the menu consumed the key, so the caller must not also act. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (query === null) {
      return false;
    }

    if (options.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return true;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex(
          (index) => (index - 1 + options.length) % options.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const item = options[activeIndex];
        if (item) {
          select(item);
        }
        return true;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }

    return false;
  }

  return {
    /** Null while the menu is closed. */
    query,
    activeIndex,
    options,
    sync,
    close,
    select,
    onKeyDown,
  };
}
