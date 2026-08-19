"use client";

import {
  WIDGET_ASSET_LIMITS,
  WIDGET_COLOR_MODES,
  WIDGET_DENSITIES,
  WIDGET_DIMENSION_LIMITS,
  WIDGET_FONT_FAMILIES,
  WIDGET_FONT_SIZE_SCALES,
  WIDGET_HEADER_STYLES,
  WIDGET_LAUNCHER_ICONS,
  WIDGET_LAUNCHER_SHAPES,
  WIDGET_LAUNCHER_SIZES,
  WIDGET_LOCALE_CODES,
  WIDGET_MOBILE_BEHAVIORS,
  WIDGET_POSITIONS,
  WIDGET_PRESET_DEFINITIONS,
  WIDGET_SEND_BUTTON_STYLES,
  WIDGET_SHADOW_LEVELS,
  applyWidgetPreset,
  collectAppearanceContrastWarnings,
  isAppearanceDraftDirty,
  widgetAppearanceConfigSchema,
  widgetStudioMessagesEn,
  type WidgetAppearanceConfig,
  type WidgetAssetKind,
  type WidgetLocalizedCopy,
  type WidgetStudioState,
} from "@site-chat/shared";
import { useMemo, useState, useTransition, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyWidgetStudioPresetAction,
  completeWidgetStudioAssetUploadAction,
  discardWidgetStudioDraftAction,
  initiateWidgetStudioAssetUploadAction,
  publishWidgetStudioAction,
  resetWidgetStudioDraftAction,
  saveWidgetStudioDraftAction,
} from "@/lib/widget-studio/actions";

import { WidgetStudioPreview } from "./WidgetStudioPreview";

const messages = widgetStudioMessagesEn;
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

type AssetUrls = Partial<
  Record<"logo" | "launcher_icon" | "agent_avatar", string>
>;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function SelectControl({
  id,
  label,
  value,
  options,
  testId,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  testId?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        data-testid={testId}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberControl({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.valueAsNumber;
          if (Number.isFinite(next)) {
            onChange(next);
          }
        }}
      />
    </div>
  );
}

function ToggleControl({
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
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 sm:col-span-2">
      <span className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <span className="text-muted-foreground block text-xs">
            {description}
          </span>
        ) : null}
      </span>
      <input
        id={id}
        type="checkbox"
        className="border-input accent-foreground mt-1 size-4 rounded"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </div>
  );
}

function ColorControl({
  id,
  label,
  value,
  testId,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  testId?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          data-testid={testId}
          type="color"
          className="w-14 p-1"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase());
          }}
        />
        <code className="text-muted-foreground text-xs">{value}</code>
      </div>
    </div>
  );
}

function updateEnglishCopy(
  copy: WidgetLocalizedCopy,
  value: string,
): WidgetLocalizedCopy {
  const overrides = { ...copy.overrides };
  if (value.trim().length === 0) {
    delete overrides.en;
  } else {
    overrides.en = value;
  }
  return { ...copy, overrides };
}

function englishCopy(copy: WidgetLocalizedCopy): string {
  return copy.overrides.en ?? "";
}

export function WidgetStudioManager({
  workspaceSlug,
  initialState,
  canManage,
}: {
  workspaceSlug: string;
  initialState: WidgetStudioState;
  canManage: boolean;
}) {
  const [studioState, setStudioState] = useState(initialState);
  const [draft, setDraft] = useState(initialState.draft);
  const [assetUrls, setAssetUrls] = useState<AssetUrls>({});
  const [assetPending, setAssetPending] = useState<WidgetAssetKind | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const disabled = !canManage || isPending || assetPending !== null;

  const contrast = useMemo(
    () =>
      collectAppearanceContrastWarnings({
        textColor: draft.textColor,
        backgroundColor: draft.backgroundColor,
        primaryColor: draft.primaryColor,
        launcherColor: draft.launcherColor,
      }),
    [
      draft.backgroundColor,
      draft.launcherColor,
      draft.primaryColor,
      draft.textColor,
    ],
  );
  const dirty = isAppearanceDraftDirty(draft, studioState.published);
  const validation = widgetAppearanceConfigSchema.safeParse(draft);

  function updateDraft(patch: Partial<WidgetAppearanceConfig>): void {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(null);
    setError(null);
  }

  function adoptState(next: WidgetStudioState): void {
    setStudioState(next);
    setDraft(next.draft);
  }

  function runSave(): void {
    if (!canManage) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await saveWidgetStudioDraftAction(workspaceSlug, draft);
      if (!result.success) {
        setError(result.message);
        return;
      }
      adoptState(result.data);
      setNotice(messages.draftSaved);
    });
  }

  function runPublish(): void {
    if (!canManage) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const saved = await saveWidgetStudioDraftAction(workspaceSlug, draft);
      if (!saved.success) {
        setError(saved.message);
        return;
      }
      const published = await publishWidgetStudioAction(workspaceSlug);
      if (!published.success) {
        adoptState(saved.data);
        setError(published.message);
        return;
      }
      adoptState(published.data);
      setNotice(messages.published);
    });
  }

  function runDiscard(): void {
    if (!canManage || !window.confirm("Discard all unpublished changes?")) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await discardWidgetStudioDraftAction(workspaceSlug);
      if (!result.success) {
        setError(result.message);
        return;
      }
      adoptState(result.data);
      setNotice(messages.draftDiscarded);
    });
  }

  function runReset(): void {
    if (!canManage || !window.confirm("Reset the draft to default settings?")) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await resetWidgetStudioDraftAction(workspaceSlug);
      if (!result.success) {
        setError(result.message);
        return;
      }
      adoptState(result.data);
      setNotice(messages.resetDone);
    });
  }

  function runPreset(
    presetId: (typeof WIDGET_PRESET_DEFINITIONS)[number]["id"],
  ): void {
    if (!canManage) return;
    const nextDraft = applyWidgetPreset(presetId, draft);
    setDraft(nextDraft);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await applyWidgetStudioPresetAction(workspaceSlug, {
        draft: nextDraft,
        presetId,
      });
      if (!result.success) {
        setError(result.message);
        return;
      }
      adoptState(result.data);
      setNotice(`${messages.applyPreset}: ${presetId}`);
    });
  }

  async function uploadAsset(kind: WidgetAssetKind, file: File): Promise<void> {
    if (!canManage || assetPending) return;
    setAssetPending(kind);
    setError(null);
    setNotice(null);
    try {
      const initiated = await initiateWidgetStudioAssetUploadAction(
        workspaceSlug,
        {
          kind,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
        },
      );
      if (!initiated.success) {
        setError(initiated.message);
        return;
      }

      let uploadUrl = initiated.data.uploadUrl;
      if (initiated.data.uploadToken) {
        const parsed = new URL(uploadUrl);
        if (!parsed.searchParams.has("token")) {
          parsed.searchParams.set("token", initiated.data.uploadToken);
        }
        uploadUrl = parsed.toString();
      }

      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file, file.name);
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body,
      });
      if (!uploadResponse.ok) {
        setError(`Asset upload failed (${String(uploadResponse.status)}).`);
        return;
      }

      const completed = await completeWidgetStudioAssetUploadAction(
        workspaceSlug,
        { assetId: initiated.data.assetId },
      );
      if (!completed.success) {
        setError(completed.message);
        return;
      }

      const field =
        kind === "logo"
          ? "logoAssetId"
          : kind === "launcher_icon"
            ? "launcherIconAssetId"
            : "agentAvatarAssetId";
      updateDraft({
        [field]: completed.data.id,
        ...(kind === "launcher_icon" ? { launcherIcon: "custom" } : {}),
      });
      setAssetUrls((current) => ({
        ...current,
        [kind]: completed.data.url,
      }));
      setNotice("Asset uploaded. Save the draft to keep this selection.");
    } catch {
      setError("Unable to upload the asset.");
    } finally {
      setAssetPending(null);
    }
  }

  function assetControl(kind: WidgetAssetKind, label: string): ReactNode {
    return (
      <div className="space-y-1">
        <Label htmlFor={`studio-asset-${kind}`}>{label}</Label>
        <Input
          id={`studio-asset-${kind}`}
          type="file"
          accept={WIDGET_ASSET_LIMITS.allowedMimeTypes.join(",")}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void uploadAsset(kind, file);
            }
          }}
        />
        <p className="text-muted-foreground text-xs">
          PNG, JPEG, WebP, or SVG. Maximum 512 KB and 1024 × 1024.
        </p>
      </div>
    );
  }

  function toggleBusinessDay(day: number, enabled: boolean): void {
    const weekly = enabled
      ? [
          ...draft.businessHours.weekly,
          { day, start: "09:00", end: "17:00" },
        ].sort((a, b) => a.day - b.day)
      : draft.businessHours.weekly.filter((entry) => entry.day !== day);
    updateDraft({
      businessHours: { ...draft.businessHours, weekly },
    });
  }

  function updateBusinessDay(
    day: number,
    field: "start" | "end",
    value: string,
  ): void {
    updateDraft({
      businessHours: {
        ...draft.businessHours,
        weekly: draft.businessHours.weekly.map((entry) =>
          entry.day === day ? { ...entry, [field]: value } : entry,
        ),
      },
    });
  }

  return (
    <div className="space-y-5" data-testid="widget-studio-manager">
      {!canManage ? (
        <p
          className="text-muted-foreground rounded-md border border-dashed px-3 py-2 text-sm"
          data-testid="widget-studio-readonly-banner"
        >
          Read-only preview. Only workspace owners and admins can publish
          customization changes.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">
            {messages.versionLabel}: {studioState.publishedVersion}
          </p>
          <p
            className="text-muted-foreground text-xs"
            data-testid="widget-studio-dirty-badge"
            data-dirty={dirty}
          >
            {dirty ? messages.dirtyBadge : messages.cleanBadge}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="widget-studio-save-draft"
            disabled={disabled || !dirty || !validation.success}
            onClick={runSave}
          >
            {messages.saveDraft}
          </Button>
          <Button
            type="button"
            size="sm"
            data-testid="widget-studio-publish"
            disabled={disabled || !validation.success}
            onClick={runPublish}
          >
            {messages.publish}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="widget-studio-discard"
            disabled={disabled || !dirty}
            onClick={runDiscard}
          >
            {messages.discardDraft}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="widget-studio-reset"
            disabled={disabled}
            onClick={runReset}
          >
            {messages.resetDefaults}
          </Button>
        </div>
      </div>

      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="text-muted-foreground text-sm" role="status">
          {notice}
        </p>
      ) : null}
      {!validation.success ? (
        <p className="text-destructive text-sm" role="alert">
          {validation.error.issues[0]?.message}
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Presets</h2>
        <div className="flex flex-wrap gap-2">
          {WIDGET_PRESET_DEFINITIONS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant={draft.presetId === preset.id ? "secondary" : "outline"}
              title={preset.description}
              disabled={disabled}
              onClick={() => {
                runPreset(preset.id);
              }}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <div className="space-y-4">
          <Section title={messages.sections.general}>
            <SelectControl
              id="studio-locale"
              label="Default locale"
              value={draft.locale ?? "en"}
              options={WIDGET_LOCALE_CODES}
              disabled={disabled}
              onChange={(value) => {
                updateDraft({
                  locale: value as WidgetAppearanceConfig["locale"],
                });
              }}
            />
            <NumberControl
              id="studio-reopen-hours"
              label="Conversation reopen window (hours)"
              value={draft.reopenWindowHours}
              min={1}
              max={720}
              disabled={disabled}
              onChange={(reopenWindowHours) => {
                updateDraft({ reopenWindowHours });
              }}
            />
          </Section>

          <Section title={messages.sections.launcher}>
            <SelectControl
              id="studio-launcher-icon"
              label="Icon"
              value={draft.launcherIcon}
              options={WIDGET_LAUNCHER_ICONS}
              disabled={disabled}
              onChange={(launcherIcon) => {
                updateDraft({
                  launcherIcon:
                    launcherIcon as WidgetAppearanceConfig["launcherIcon"],
                });
              }}
            />
            <SelectControl
              id="studio-launcher-shape"
              label="Shape"
              value={draft.launcherShape}
              options={WIDGET_LAUNCHER_SHAPES}
              disabled={disabled}
              onChange={(launcherShape) => {
                updateDraft({
                  launcherShape:
                    launcherShape as WidgetAppearanceConfig["launcherShape"],
                });
              }}
            />
            <SelectControl
              id="studio-launcher-size"
              label="Size"
              value={draft.launcherSize}
              options={WIDGET_LAUNCHER_SIZES}
              disabled={disabled}
              onChange={(launcherSize) => {
                updateDraft({
                  launcherSize:
                    launcherSize as WidgetAppearanceConfig["launcherSize"],
                });
              }}
            />
            <SelectControl
              id="studio-launcher-position"
              label="Position"
              value={draft.launcherPosition}
              options={WIDGET_POSITIONS}
              testId="widget-studio-position"
              disabled={disabled}
              onChange={(launcherPosition) => {
                updateDraft({
                  launcherPosition:
                    launcherPosition as WidgetAppearanceConfig["launcherPosition"],
                });
              }}
            />
            <NumberControl
              id="studio-offset-x"
              label="Horizontal offset"
              value={draft.launcherOffsetX}
              min={WIDGET_DIMENSION_LIMITS.offsetMin}
              max={WIDGET_DIMENSION_LIMITS.offsetMax}
              disabled={disabled}
              onChange={(launcherOffsetX) => {
                updateDraft({ launcherOffsetX });
              }}
            />
            <NumberControl
              id="studio-offset-y"
              label="Bottom offset"
              value={draft.launcherOffsetY}
              min={WIDGET_DIMENSION_LIMITS.offsetMin}
              max={WIDGET_DIMENSION_LIMITS.offsetMax}
              disabled={disabled}
              onChange={(launcherOffsetY) => {
                updateDraft({ launcherOffsetY });
              }}
            />
            {assetControl("launcher_icon", "Custom launcher icon")}
          </Section>

          <Section title={messages.sections.chatWindow}>
            <NumberControl
              id="studio-width"
              label="Width"
              value={draft.widgetWidth}
              min={WIDGET_DIMENSION_LIMITS.widthMin}
              max={WIDGET_DIMENSION_LIMITS.widthMax}
              disabled={disabled}
              onChange={(widgetWidth) => {
                updateDraft({ widgetWidth });
              }}
            />
            <NumberControl
              id="studio-height"
              label="Height"
              value={draft.widgetHeight}
              min={WIDGET_DIMENSION_LIMITS.heightMin}
              max={WIDGET_DIMENSION_LIMITS.heightMax}
              disabled={disabled}
              onChange={(widgetHeight) => {
                updateDraft({
                  widgetHeight,
                  widgetMaxHeight: Math.max(
                    widgetHeight,
                    draft.widgetMaxHeight,
                  ),
                });
              }}
            />
            <NumberControl
              id="studio-max-height"
              label="Maximum height"
              value={draft.widgetMaxHeight}
              min={Math.max(
                WIDGET_DIMENSION_LIMITS.maxHeightMin,
                draft.widgetHeight,
              )}
              max={WIDGET_DIMENSION_LIMITS.maxHeightMax}
              disabled={disabled}
              onChange={(widgetMaxHeight) => {
                updateDraft({ widgetMaxHeight });
              }}
            />
            <NumberControl
              id="studio-radius"
              label="Corner radius"
              value={draft.borderRadius}
              min={WIDGET_DIMENSION_LIMITS.borderRadiusMin}
              max={WIDGET_DIMENSION_LIMITS.borderRadiusMax}
              disabled={disabled}
              onChange={(borderRadius) => {
                updateDraft({ borderRadius });
              }}
            />
            <SelectControl
              id="studio-shadow"
              label="Shadow"
              value={draft.shadowLevel}
              options={WIDGET_SHADOW_LEVELS}
              disabled={disabled}
              onChange={(shadowLevel) => {
                updateDraft({
                  shadowLevel:
                    shadowLevel as WidgetAppearanceConfig["shadowLevel"],
                });
              }}
            />
            <SelectControl
              id="studio-density"
              label="Density"
              value={draft.density}
              options={WIDGET_DENSITIES}
              disabled={disabled}
              onChange={(density) => {
                updateDraft({
                  density: density as WidgetAppearanceConfig["density"],
                });
              }}
            />
          </Section>

          <Section title={messages.sections.header}>
            <SelectControl
              id="studio-header-style"
              label="Header style"
              value={draft.headerStyle}
              options={WIDGET_HEADER_STYLES}
              disabled={disabled}
              onChange={(headerStyle) => {
                updateDraft({
                  headerStyle:
                    headerStyle as WidgetAppearanceConfig["headerStyle"],
                });
              }}
            />
            <div className="space-y-1">
              <Label htmlFor="studio-header-title">Title (English)</Label>
              <Input
                id="studio-header-title"
                value={englishCopy(draft.headerTitle)}
                maxLength={100}
                disabled={disabled}
                placeholder="Support team"
                onChange={(event) => {
                  updateDraft({
                    headerTitle: updateEnglishCopy(
                      draft.headerTitle,
                      event.target.value,
                    ),
                  });
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="studio-subtitle">Subtitle (English)</Label>
              <Input
                id="studio-subtitle"
                value={englishCopy(draft.subtitle)}
                maxLength={500}
                disabled={disabled}
                placeholder="Usually replies in a few minutes"
                onChange={(event) => {
                  updateDraft({
                    subtitle: updateEnglishCopy(
                      draft.subtitle,
                      event.target.value,
                    ),
                  });
                }}
              />
            </div>
          </Section>

          <Section title={messages.sections.typography}>
            <SelectControl
              id="studio-font"
              label="Font family"
              value={draft.fontFamily}
              options={WIDGET_FONT_FAMILIES}
              disabled={disabled}
              onChange={(fontFamily) => {
                updateDraft({
                  fontFamily:
                    fontFamily as WidgetAppearanceConfig["fontFamily"],
                });
              }}
            />
            <SelectControl
              id="studio-font-size"
              label="Font size"
              value={draft.fontSizeScale}
              options={WIDGET_FONT_SIZE_SCALES}
              disabled={disabled}
              onChange={(fontSizeScale) => {
                updateDraft({
                  fontSizeScale:
                    fontSizeScale as WidgetAppearanceConfig["fontSizeScale"],
                });
              }}
            />
            <SelectControl
              id="studio-color-mode"
              label="Color mode"
              value={draft.colorMode}
              options={WIDGET_COLOR_MODES}
              disabled={disabled}
              onChange={(colorMode) => {
                updateDraft({
                  colorMode: colorMode as WidgetAppearanceConfig["colorMode"],
                });
              }}
            />
          </Section>

          <Section title={messages.sections.colors}>
            <ColorControl
              id="studio-primary"
              label="Primary"
              value={draft.primaryColor}
              testId="widget-studio-primary-color"
              disabled={disabled}
              onChange={(primaryColor) => {
                updateDraft({ primaryColor });
              }}
            />
            <ColorControl
              id="studio-accent"
              label="Accent"
              value={draft.accentColor}
              disabled={disabled}
              onChange={(accentColor) => {
                updateDraft({ accentColor });
              }}
            />
            <ColorControl
              id="studio-background"
              label="Background"
              value={draft.backgroundColor}
              disabled={disabled}
              onChange={(backgroundColor) => {
                updateDraft({ backgroundColor });
              }}
            />
            <ColorControl
              id="studio-text"
              label="Text"
              value={draft.textColor}
              disabled={disabled}
              onChange={(textColor) => {
                updateDraft({ textColor });
              }}
            />
            <ColorControl
              id="studio-launcher-color"
              label="Launcher"
              value={draft.launcherColor}
              disabled={disabled}
              onChange={(launcherColor) => {
                updateDraft({ launcherColor });
              }}
            />
            {contrast.warnings.length > 0 ? (
              <div className="border-destructive/40 bg-destructive/5 space-y-1 rounded-md border p-3 sm:col-span-2">
                <h3 className="text-sm font-medium">
                  {messages.contrastWarningTitle}
                </h3>
                <ul className="text-muted-foreground list-disc space-y-1 ps-4 text-xs">
                  {contrast.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>

          <Section title={messages.sections.messages}>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="studio-welcome">Welcome message (English)</Label>
              <Input
                id="studio-welcome"
                value={englishCopy(draft.welcomeMessage)}
                maxLength={500}
                disabled={disabled}
                placeholder="Hi! How can we help?"
                onChange={(event) => {
                  updateDraft({
                    welcomeMessage: updateEnglishCopy(
                      draft.welcomeMessage,
                      event.target.value,
                    ),
                  });
                }}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="studio-placeholder">
                Composer placeholder (English)
              </Label>
              <Input
                id="studio-placeholder"
                value={englishCopy(draft.placeholderText)}
                maxLength={500}
                disabled={disabled}
                placeholder="Type a message…"
                onChange={(event) => {
                  updateDraft({
                    placeholderText: updateEnglishCopy(
                      draft.placeholderText,
                      event.target.value,
                    ),
                  });
                }}
              />
            </div>
            <SelectControl
              id="studio-send-style"
              label="Send button"
              value={draft.sendButtonStyle}
              options={WIDGET_SEND_BUTTON_STYLES}
              disabled={disabled}
              onChange={(sendButtonStyle) => {
                updateDraft({
                  sendButtonStyle:
                    sendButtonStyle as WidgetAppearanceConfig["sendButtonStyle"],
                });
              }}
            />
            <ToggleControl
              id="studio-show-greeting"
              label="Show greeting"
              checked={draft.showGreeting}
              disabled={disabled}
              onChange={(showGreeting) => {
                updateDraft({ showGreeting });
              }}
            />
          </Section>

          <Section title={messages.sections.branding}>
            {assetControl("logo", "Workspace logo")}
            {assetControl("agent_avatar", "Agent avatar")}
            <ToggleControl
              id="studio-powered-by"
              label="Show “Powered by Site Chat”"
              description="The effective setting also follows workspace feature entitlements."
              checked={draft.showPoweredBy}
              disabled={disabled}
              onChange={(showPoweredBy) => {
                updateDraft({ showPoweredBy });
              }}
            />
          </Section>

          <Section title={messages.sections.behavior}>
            <div className="space-y-1">
              <Label htmlFor="studio-auto-open">Auto-open delay (ms)</Label>
              <Input
                id="studio-auto-open"
                type="number"
                value={draft.autoOpenDelayMs ?? ""}
                min={0}
                max={WIDGET_DIMENSION_LIMITS.autoOpenDelayMaxMs}
                disabled={disabled}
                placeholder="Disabled"
                onChange={(event) => {
                  updateDraft({
                    autoOpenDelayMs:
                      event.target.value === ""
                        ? null
                        : event.target.valueAsNumber,
                  });
                }}
              />
            </div>
            <ToggleControl
              id="studio-hide-launcher"
              label="Hide launcher while chat is open"
              checked={draft.hideLauncherWhenOpen}
              disabled={disabled}
              onChange={(hideLauncherWhenOpen) => {
                updateDraft({ hideLauncherWhenOpen });
              }}
            />
            <ToggleControl
              id="studio-agent-avatars"
              label="Show agent avatars"
              checked={draft.showAgentAvatars}
              disabled={disabled}
              onChange={(showAgentAvatars) => {
                updateDraft({ showAgentAvatars });
              }}
            />
            <ToggleControl
              id="studio-sound"
              label="Enable widget sounds"
              checked={draft.soundEnabled}
              disabled={disabled}
              onChange={(soundEnabled) => {
                updateDraft({ soundEnabled });
              }}
            />
          </Section>

          <Section title={messages.sections.mobile}>
            <SelectControl
              id="studio-mobile"
              label="Mobile behavior"
              value={draft.mobileBehavior}
              options={WIDGET_MOBILE_BEHAVIORS}
              disabled={disabled}
              onChange={(mobileBehavior) => {
                updateDraft({
                  mobileBehavior:
                    mobileBehavior as WidgetAppearanceConfig["mobileBehavior"],
                });
              }}
            />
          </Section>

          <Section title={messages.sections.businessHours}>
            <ToggleControl
              id="studio-business-enabled"
              label="Enable business-hours messaging"
              checked={draft.businessHours.enabled}
              disabled={disabled}
              onChange={(enabled) => {
                updateDraft({
                  businessHours: { ...draft.businessHours, enabled },
                });
              }}
            />
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="studio-timezone">Timezone</Label>
              <Input
                id="studio-timezone"
                value={draft.businessHours.timezone}
                maxLength={64}
                disabled={disabled}
                onChange={(event) => {
                  updateDraft({
                    businessHours: {
                      ...draft.businessHours,
                      timezone: event.target.value,
                    },
                  });
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              {DAYS.map((label, day) => {
                const row = draft.businessHours.weekly.find(
                  (entry) => entry.day === day,
                );
                return (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(90px,1fr)_1fr_1fr] items-center gap-2"
                  >
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(row)}
                        disabled={disabled}
                        onChange={(event) => {
                          toggleBusinessDay(day, event.target.checked);
                        }}
                      />
                      {label}
                    </label>
                    <Input
                      type="time"
                      aria-label={`${label} start`}
                      value={row?.start ?? "09:00"}
                      disabled={disabled || !row}
                      onChange={(event) => {
                        updateBusinessDay(day, "start", event.target.value);
                      }}
                    />
                    <Input
                      type="time"
                      aria-label={`${label} end`}
                      value={row?.end ?? "17:00"}
                      disabled={disabled || !row}
                      onChange={(event) => {
                        updateBusinessDay(day, "end", event.target.value);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="xl:sticky xl:top-4">
          <WidgetStudioPreview config={draft} assetUrls={assetUrls} />
        </div>
      </div>
    </div>
  );
}
