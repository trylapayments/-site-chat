"use client";

import {
  isNotificationUnread,
  notificationsMessagesEn,
  type NotificationItem,
} from "@site-chat/shared";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toAppRoute } from "@/lib/auth/redirect";
import {
  SETTINGS_SECTION_NOTIFICATIONS,
  workspaceSettingsPath,
} from "@/lib/dashboard/routes";
import { formatRelativeTime } from "@/lib/inbox/search-params";
import { useNotifications } from "@/lib/realtime/use-notifications";
import { cn } from "@/lib/utils";

const messages = notificationsMessagesEn;

function NotificationRow({
  item,
  onOpen,
  disabled,
}: {
  item: NotificationItem;
  onOpen: (item: NotificationItem) => void;
  disabled?: boolean;
}) {
  const unread = isNotificationUnread(item);
  return (
    <button
      type="button"
      data-testid="notification-item"
      data-unread={unread ? "true" : "false"}
      disabled={disabled}
      className={cn(
        "hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none",
        unread && "bg-muted/30",
      )}
      onClick={() => {
        onOpen(item);
      }}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{item.title}</span>
        {unread ? (
          <span
            className="bg-foreground mt-1 size-1.5 shrink-0 rounded-full"
            aria-hidden="true"
          />
        ) : null}
      </span>
      {item.body ? (
        <span className="text-muted-foreground line-clamp-2 text-xs">
          {item.body}
        </span>
      ) : null}
      <span className="text-muted-foreground text-[11px]">
        {formatRelativeTime(item.created_at)}
      </span>
    </button>
  );
}

export function NotificationBell({
  workspaceSlug,
  workspaceId,
  memberId,
}: {
  workspaceSlug: string;
  workspaceId: string;
  memberId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const {
    items,
    unreadCount,
    hasMore,
    error,
    loading,
    loadingMore,
    isPending: actionPending,
    loadMore,
    markAllRead,
    openNotification,
  } = useNotifications({
    workspaceSlug,
    workspaceId,
    memberId,
    enabled: Boolean(memberId),
  });

  const busy = isPending || actionPending;
  const badgeLabel =
    unreadCount > 99 ? "99+" : unreadCount > 0 ? String(unreadCount) : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-8"
          aria-label={messages.bellAriaLabel}
          data-testid="notification-bell"
        >
          <Bell className="size-4" />
          {badgeLabel ? (
            <span
              data-testid="notification-unread-badge"
              className="bg-foreground text-background absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium leading-none"
              aria-label={messages.unreadCountLabel(unreadCount)}
            >
              {badgeLabel}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[22rem] p-0"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0 text-sm font-medium">
            {messages.panelTitle}
          </DropdownMenuLabel>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            data-testid="notification-mark-all-read"
            disabled={busy || unreadCount === 0}
            onClick={() => {
              startTransition(async () => {
                await markAllRead();
              });
            }}
          >
            {messages.markAllRead}
          </Button>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="max-h-80 overflow-y-auto p-1">
          {loading ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              Loading…
            </p>
          ) : error ? (
            <p className="text-destructive px-2 py-6 text-center text-sm">
              {error}
            </p>
          ) : items.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-sm">
              {messages.empty}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    disabled={busy}
                    onOpen={(notification) => {
                      setOpen(false);
                      openNotification(notification);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        {hasMore ? (
          <>
            <DropdownMenuSeparator className="my-0" />
            <div className="p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full text-xs"
                disabled={loadingMore || busy}
                onClick={() => {
                  void loadMore();
                }}
              >
                {loadingMore ? "Loading…" : messages.loadMore}
              </Button>
            </div>
          </>
        ) : null}
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <Link
            href={toAppRoute(
              workspaceSettingsPath(
                workspaceSlug,
                SETTINGS_SECTION_NOTIFICATIONS,
              ),
            )}
            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground block rounded-md px-2 py-1.5 text-xs transition-colors"
            onClick={() => {
              setOpen(false);
            }}
          >
            {messages.settingsLinkLabel} settings
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
