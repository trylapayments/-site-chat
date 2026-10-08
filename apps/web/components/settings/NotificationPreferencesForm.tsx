"use client";

import {
  notificationsMessagesEn,
  type NotificationPreferences,
  type UpdateNotificationPreferencesInput,
} from "@site-chat/shared";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateNotificationPreferencesAction } from "@/lib/notifications/actions";
import { requestBrowserNotificationPermission } from "@/lib/notifications/side-effects";

const messages = notificationsMessagesEn;

type PrefKey = keyof UpdateNotificationPreferencesInput;

type ToggleDef = {
  key: PrefKey;
  label: string;
  description?: string;
};

const IN_APP_TOGGLES: ToggleDef[] = [
  { key: "in_app_conversation_new", label: "New conversations" },
  { key: "in_app_visitor_message", label: "Visitor messages" },
  { key: "in_app_assignment", label: "Assignments" },
  { key: "in_app_transfer", label: "Transfers" },
  { key: "in_app_mention", label: "Mentions" },
];

const BROWSER_TOGGLES: ToggleDef[] = [
  { key: "browser_conversation_new", label: "New conversations" },
  { key: "browser_visitor_message", label: "Visitor messages" },
  { key: "browser_assignment", label: "Assignments" },
  { key: "browser_mention", label: "Mentions" },
];

const SOUND_TOGGLES: ToggleDef[] = [
  { key: "sound_visitor_message", label: "Visitor messages" },
  { key: "sound_assignment", label: "Assignments" },
];

const EMAIL_TOGGLES: ToggleDef[] = [
  { key: "email_conversation_new", label: "New conversations" },
  { key: "email_visitor_message", label: "Visitor messages" },
  { key: "email_assignment", label: "Assignments" },
  { key: "email_mention", label: "Mentions" },
];

function PrefToggle({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        {description ? (
          <p className="text-muted-foreground text-xs">{description}</p>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        className="border-input accent-foreground mt-1 size-4 shrink-0 rounded"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}

function PrefSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1 border-b pb-4 last:border-b-0 last:pb-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="divide-y">{children}</div>
    </section>
  );
}

export function NotificationPreferencesForm({
  workspaceSlug,
  initialPreferences,
}: {
  workspaceSlug: string;
  initialPreferences: NotificationPreferences;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(initialPreferences);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [browserPermission, setBrowserPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => {
    if (typeof window === "undefined" || typeof Notification === "undefined") {
      return "unsupported";
    }
    return Notification.permission;
  });

  function applyPatch(patch: UpdateNotificationPreferencesInput) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateNotificationPreferencesAction(
        workspaceSlug,
        patch,
      );
      if (!result.success) {
        setError(result.message);
        return;
      }
      setPrefs(result.data);
      setSaved(true);
      router.refresh();
    });
  }

  async function enableBrowserNotifications() {
    setError(null);
    setSaved(false);
    const permission = await requestBrowserNotificationPermission();
    setBrowserPermission(permission);
    if (permission !== "granted") {
      applyPatch({
        browser_enabled: false,
        browser_permission_denied_at: new Date().toISOString(),
      });
      setError(
        "Browser notification permission was denied. You can re-enable it in your browser settings.",
      );
      return;
    }
    applyPatch({
      browser_enabled: true,
      browser_permission_denied_at: null,
    });
  }

  return (
    <div
      className="max-w-xl space-y-6"
      data-testid="notification-preferences-form"
    >
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="text-muted-foreground text-sm">Preferences saved.</p>
      ) : null}

      <PrefSection title="In-app">
        {IN_APP_TOGGLES.map((toggle) => (
          <PrefToggle
            key={toggle.key}
            id={`pref-${toggle.key}`}
            label={toggle.label}
            checked={Boolean(
              prefs[toggle.key as keyof NotificationPreferences],
            )}
            disabled={isPending}
            onChange={(next) => {
              applyPatch({ [toggle.key]: next });
            }}
          />
        ))}
      </PrefSection>

      <PrefSection title="Browser desktop">
        <PrefToggle
          id="pref-browser_enabled"
          label="Enable browser notifications"
          description="Requires an explicit permission grant from your browser."
          checked={prefs.browser_enabled}
          disabled={isPending || browserPermission === "unsupported"}
          onChange={(next) => {
            if (next) {
              void enableBrowserNotifications();
              return;
            }
            applyPatch({ browser_enabled: false });
          }}
        />
        {browserPermission === "denied" ? (
          <p className="text-muted-foreground py-2 text-xs">
            Permission is blocked in this browser. Update site permissions, then
            enable again.
          </p>
        ) : null}
        {prefs.browser_enabled
          ? BROWSER_TOGGLES.map((toggle) => (
              <PrefToggle
                key={toggle.key}
                id={`pref-${toggle.key}`}
                label={toggle.label}
                checked={Boolean(
                  prefs[toggle.key as keyof NotificationPreferences],
                )}
                disabled={isPending}
                onChange={(next) => {
                  applyPatch({ [toggle.key]: next });
                }}
              />
            ))
          : null}
        {browserPermission !== "granted" && !prefs.browser_enabled ? (
          <div className="pt-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || browserPermission === "unsupported"}
              onClick={() => {
                void enableBrowserNotifications();
              }}
            >
              Enable browser notifications
            </Button>
          </div>
        ) : null}
      </PrefSection>

      <PrefSection title="Sound">
        <PrefToggle
          id="pref-sound_enabled"
          label="Play notification sounds"
          description="Sounds play only after you interact with the page, and only in the active tab."
          checked={prefs.sound_enabled}
          disabled={isPending}
          onChange={(next) => {
            applyPatch({ sound_enabled: next });
          }}
        />
        {prefs.sound_enabled
          ? SOUND_TOGGLES.map((toggle) => (
              <PrefToggle
                key={toggle.key}
                id={`pref-${toggle.key}`}
                label={toggle.label}
                checked={Boolean(
                  prefs[toggle.key as keyof NotificationPreferences],
                )}
                disabled={isPending}
                onChange={(next) => {
                  applyPatch({ [toggle.key]: next });
                }}
              />
            ))
          : null}
      </PrefSection>

      <PrefSection title="Email">
        {EMAIL_TOGGLES.map((toggle) => (
          <PrefToggle
            key={toggle.key}
            id={`pref-${toggle.key}`}
            label={toggle.label}
            checked={Boolean(
              prefs[toggle.key as keyof NotificationPreferences],
            )}
            disabled={isPending}
            onChange={(next) => {
              applyPatch({ [toggle.key]: next });
            }}
          />
        ))}
      </PrefSection>

      <PrefSection title="Do not disturb">
        <PrefToggle
          id="pref-dnd_enabled"
          label="Do not disturb"
          description="Suppresses sound, browser, and email delivery. In-app notification history still appears. With quiet hours set, only that window is quiet; with no window, side effects stay suppressed all day."
          checked={prefs.dnd_enabled}
          disabled={isPending}
          onChange={(next) => {
            applyPatch({ dnd_enabled: next });
          }}
        />
      </PrefSection>

      <p className="text-muted-foreground text-xs">
        {messages.settingsLinkDescription}
      </p>
    </div>
  );
}
