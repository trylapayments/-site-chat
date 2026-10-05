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
  defaultWidgetStudioEntitlements,
  hasWidgetStudioFeature,
  type WidgetStudioFeature,
  widgetAppearanceConfigSchema,
  widgetStudioMessagesEn,
  type WidgetAppearanceConfig,
  type WidgetAssetKind,
  type WidgetLocalizedCopy,
  type WidgetStudioState,
} from "@site-chat/shared";
import {
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";

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

function mobileLauncherDefaults(
  draft: WidgetAppearanceConfig,
): NonNullable<WidgetAppearanceConfig["mobileLauncher"]> {
  return (
    draft.mobileLauncher ?? {
      launcherShape: draft.launcherShape,
      launcherSize: draft.launcherSize,
      launcherText: draft.launcherText,
      launcherWidth: draft.launcherWidth,
      launcherColor: draft.launcherColor,
      launcherPosition: draft.launcherPosition,
      launcherOffsetX: draft.launcherOffsetX,
      launcherOffsetY: draft.launcherOffsetY,
    }
  );
}
const messages = widgetStudioMessagesEn;
type AssetUrls = Partial<
  Record<"logo" | "launcher_icon" | "agent_avatar", string>
>;

function Section({
  title,
  children,
  advanced = false,
}: {
  title: string;
  children: ReactNode;
  advanced?: boolean;
}) {
  const fields = (
    <div className="grid grid-cols-2 gap-4 [&>*]:col-span-2">{children}</div>
  );
  return advanced ? (
    <details
      className="group border-t pt-4"
      data-testid="widget-studio-advanced-section"
    >
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="pt-4">{fields}</div>
    </details>
  ) : (
    <section className="space-y-4 border-t pt-5">
      <h2 className="text-sm font-medium">{title}</h2>
      {fields}
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
            {option
              .replaceAll("-", " ")
              .replaceAll("_", " ")
              .replace(/^./, (letter) => letter.toUpperCase())}
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
  const [hexText, setHexText] = useState(value);

  useEffect(() => {
    setHexText(value);
  }, [value]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="color"
          className="w-14 p-1"
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value.toUpperCase());
          }}
        />
        <Input
          data-testid={testId}
          type="text"
          className="font-mono text-xs uppercase"
          value={hexText}
          maxLength={7}
          disabled={disabled}
          aria-label={`${label} hex`}
          onChange={(event) => {
            const text = event.target.value.trim().toUpperCase();
            if (text.length === 0) {
              setHexText("#");
              return;
            }
            const raw = text.startsWith("#") ? text : `#${text}`;
            if (!/^#[0-9A-F]{0,6}$/.test(raw)) {
              return;
            }
            setHexText(raw);
            if (/^#[0-9A-F]{6}$/.test(raw)) {
              onChange(raw);
            }
          }}
        />
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
  features = [...defaultWidgetStudioEntitlements().features],
}: {
  workspaceSlug: string;
  initialState: WidgetStudioState;
  canManage: boolean;
  features?: readonly WidgetStudioFeature[];
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
  const canHideBranding = hasWidgetStudioFeature(
    { features: new Set(features) },
    "hide_powered_by",
  );
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
  const unsaved = isAppearanceDraftDirty(draft, studioState.draft);
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
    const expectedPublishedVersion = studioState.publishedVersion;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const saved = await saveWidgetStudioDraftAction(workspaceSlug, draft);
      if (!saved.success) {
        setError(saved.message);
        return;
      }
      const published = await publishWidgetStudioAction(
        workspaceSlug,
        expectedPublishedVersion,
      );
      if (!published.success) {
        adoptState(saved.data);
        setError(
          published.code === "PUBLISH_CONFLICT"
            ? "Publish conflict: another admin published while you were editing. Reload Widget Studio, review the latest settings, and try again."
            : published.message,
        );
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
    const field =
      kind === "logo"
        ? "logoAssetId"
        : kind === "launcher_icon"
          ? "launcherIconAssetId"
          : "agentAvatarAssetId";
    return (
      <div className="space-y-1">
        <Label htmlFor={`studio-asset-${kind}`}>{label}</Label>
        <Input
          id={`studio-asset-${kind}`}
          data-testid={`widget-studio-asset-${kind}`}
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
        {draft[field] ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`widget-studio-remove-${kind}`}
            disabled={disabled}
            onClick={() => {
              updateDraft({
                [field]: null,
                ...(kind === "launcher_icon" ? { launcherIcon: "chat" } : {}),
              });
              setAssetUrls((current) => ({ ...current, [kind]: undefined }));
              setNotice(
                `${label} removed from the draft. Publish to update your widget.`,
              );
            }}
          >
            Remove {label.toLowerCase()}
          </Button>
        ) : null}
        <p className="text-muted-foreground text-xs">
          PNG, JPEG, or WebP. Maximum 512 KB and 1024 × 1024.
        </p>
      </div>
    );
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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background p-4">
        <div>
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
            disabled={disabled || (!dirty && !unsaved) || !validation.success}
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
            disabled={disabled || (!dirty && !unsaved)}
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
        <p
          className="text-destructive text-sm"
          role="alert"
          data-testid="widget-studio-error"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="text-muted-foreground text-sm"
          role="status"
          data-testid="widget-studio-notice"
        >
          {notice}
        </p>
      ) : null}
      {!validation.success ? (
        <p className="text-destructive text-sm" role="alert">
          {validation.error.issues[0]?.message}
        </p>
      ) : null}

      <div className="grid items-start overflow-clip rounded-xl border lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5 p-5 lg:border-r">
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Choose a style</h2>
            <div className="flex flex-wrap gap-2">
              {WIDGET_PRESET_DEFINITIONS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant={
                    draft.presetId === preset.id ? "secondary" : "outline"
                  }
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
            {draft.launcherShape === "rectangle" ? (
              <>
                <div>
                  <Label htmlFor="studio-launcher-text">Button label</Label>
                  <Input
                    id="studio-launcher-text"
                    value={draft.launcherText}
                    maxLength={40}
                    disabled={disabled}
                    onChange={(e) => {
                      updateDraft({ launcherText: e.target.value });
                    }}
                  />
                </div>
                <NumberControl
                  id="studio-launcher-width"
                  label="Button width"
                  value={draft.launcherWidth}
                  min={120}
                  max={320}
                  disabled={disabled}
                  onChange={(launcherWidth) => {
                    updateDraft({ launcherWidth });
                  }}
                />
              </>
            ) : null}
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

          <Section title={messages.sections.branding}>
            {assetControl("logo", "Workspace logo")}
            {assetControl("agent_avatar", "Agent avatar")}
            <div data-testid="widget-studio-powered-by">
              <ToggleControl
                id="studio-powered-by"
                label="Remove Mill branding"
                description={
                  canHideBranding
                    ? "White-label customization is included for this workspace."
                    : "Available with white-label access. Mill branding stays visible on your website."
                }
                checked={canHideBranding && !draft.showPoweredBy}
                disabled={disabled || !canHideBranding}
                onChange={(removeBranding) => {
                  updateDraft({ showPoweredBy: !removeBranding });
                }}
              />
            </div>
          </Section>

          <Section title={messages.sections.messages}>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="studio-welcome">
                Greeting / welcome message (English)
              </Label>
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
              description="Displays the greeting / welcome message next to the launcher when the chat is closed. Save and publish to update your website."
              checked={draft.showGreeting}
              disabled={disabled}
              onChange={(showGreeting) => {
                updateDraft({ showGreeting });
              }}
            />
          </Section>

          <Section title={messages.sections.chatWindow} advanced>
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

          <Section title={messages.sections.typography} advanced>
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
              testId="widget-studio-color-mode"
              disabled={disabled}
              onChange={(colorMode) => {
                updateDraft({
                  colorMode: colorMode as WidgetAppearanceConfig["colorMode"],
                });
              }}
            />
          </Section>

          <Section title={messages.sections.general} advanced>
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

          <Section title={messages.sections.behavior} advanced>
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

          <Section title={messages.sections.mobile} advanced>
            <ToggleControl
              id="studio-mobile-launcher"
              label="Use different launcher on mobile"
              checked={draft.mobileLauncher !== null}
              disabled={disabled}
              onChange={(enabled) => {
                updateDraft({
                  mobileLauncher: enabled
                    ? {
                        launcherShape: draft.launcherShape,
                        launcherSize: draft.launcherSize,
                        launcherText: draft.launcherText,
                        launcherWidth: draft.launcherWidth,
                        launcherColor: draft.launcherColor,
                        launcherPosition: draft.launcherPosition,
                        launcherOffsetX: draft.launcherOffsetX,
                        launcherOffsetY: draft.launcherOffsetY,
                      }
                    : null,
                });
              }}
            />
            {draft.mobileLauncher ? (
              <>
                <SelectControl
                  id="studio-mobile-shape"
                  label="Mobile shape"
                  value={draft.mobileLauncher.launcherShape}
                  options={WIDGET_LAUNCHER_SHAPES}
                  disabled={disabled}
                  onChange={(value) => {
                    updateDraft({
                      mobileLauncher: {
                        ...mobileLauncherDefaults(draft),
                        launcherShape:
                          value as WidgetAppearanceConfig["launcherShape"],
                      },
                    });
                  }}
                />
                <SelectControl
                  id="studio-mobile-size"
                  label="Mobile size"
                  value={draft.mobileLauncher.launcherSize}
                  options={WIDGET_LAUNCHER_SIZES}
                  disabled={disabled}
                  onChange={(value) => {
                    updateDraft({
                      mobileLauncher: {
                        ...mobileLauncherDefaults(draft),
                        launcherSize:
                          value as WidgetAppearanceConfig["launcherSize"],
                      },
                    });
                  }}
                />
                <SelectControl
                  id="studio-mobile-position"
                  label="Mobile position"
                  value={draft.mobileLauncher.launcherPosition}
                  options={WIDGET_POSITIONS}
                  disabled={disabled}
                  onChange={(value) => {
                    updateDraft({
                      mobileLauncher: {
                        ...mobileLauncherDefaults(draft),
                        launcherPosition:
                          value as WidgetAppearanceConfig["launcherPosition"],
                      },
                    });
                  }}
                />
                <div>
                  <Label htmlFor="studio-mobile-color">
                    Mobile button color
                  </Label>
                  <Input
                    id="studio-mobile-color"
                    type="color"
                    value={draft.mobileLauncher.launcherColor}
                    disabled={disabled}
                    onChange={(e) => {
                      updateDraft({
                        mobileLauncher: {
                          ...mobileLauncherDefaults(draft),
                          launcherColor: e.target.value,
                        },
                      });
                    }}
                  />
                </div>
                <NumberControl
                  id="studio-mobile-x"
                  label="Mobile horizontal offset"
                  min={0}
                  max={120}
                  value={draft.mobileLauncher.launcherOffsetX}
                  disabled={disabled}
                  onChange={(launcherOffsetX) => {
                    updateDraft({
                      mobileLauncher: {
                        ...mobileLauncherDefaults(draft),
                        launcherOffsetX,
                      },
                    });
                  }}
                />
                <NumberControl
                  id="studio-mobile-y"
                  label="Mobile vertical offset"
                  min={0}
                  max={120}
                  value={draft.mobileLauncher.launcherOffsetY}
                  disabled={disabled}
                  onChange={(launcherOffsetY) => {
                    updateDraft({
                      mobileLauncher: {
                        ...mobileLauncherDefaults(draft),
                        launcherOffsetY,
                      },
                    });
                  }}
                />
                {draft.mobileLauncher.launcherShape === "rectangle" ? (
                  <>
                    <div>
                      <Label htmlFor="studio-mobile-text">
                        Mobile button label
                      </Label>
                      <Input
                        id="studio-mobile-text"
                        value={draft.mobileLauncher.launcherText}
                        maxLength={40}
                        disabled={disabled}
                        onChange={(e) => {
                          updateDraft({
                            mobileLauncher: {
                              ...mobileLauncherDefaults(draft),
                              launcherText: e.target.value,
                            },
                          });
                        }}
                      />
                    </div>
                    <NumberControl
                      id="studio-mobile-width"
                      label="Mobile button width"
                      min={120}
                      max={320}
                      value={draft.mobileLauncher.launcherWidth}
                      disabled={disabled}
                      onChange={(launcherWidth) => {
                        updateDraft({
                          mobileLauncher: {
                            ...mobileLauncherDefaults(draft),
                            launcherWidth,
                          },
                        });
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Mobile uses the desktop launcher settings.
              </p>
            )}

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

          <Section title="Working hours" advanced>
            <p className="text-muted-foreground text-sm sm:col-span-2">
              Configure your working schedule, offline behavior and visitor read
              receipts in Chat setup.
            </p>
            <a
              className="text-primary text-sm underline"
              href={`/app/${workspaceSlug}/settings/chat-setup`}
              data-testid="widget-studio-chat-setup-link"
            >
              Open Chat setup
            </a>
          </Section>
        </div>

        <div className="bg-muted/30 min-w-0 p-5 lg:sticky lg:top-4">
          <WidgetStudioPreview
            config={{
              ...draft,
              showPoweredBy: !canHideBranding || draft.showPoweredBy,
            }}
            assetUrls={assetUrls}
          />
        </div>
      </div>
    </div>
  );
}
