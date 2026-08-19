"use client";

import {
  WIDGET_FONT_FAMILY_STACKS,
  widgetStudioMessagesEn,
  type WidgetAppearanceConfig,
  type WidgetLocalizedCopy,
} from "@site-chat/shared";
import { MessageCircle, Send, UserRound } from "lucide-react";
import { useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";

type PreviewViewport = "phone" | "tablet" | "desktop";

const messages = widgetStudioMessagesEn;

const VIEWPORTS: readonly { id: PreviewViewport; label: string }[] = [
  { id: "phone", label: messages.previewViewportPhone },
  { id: "tablet", label: messages.previewViewportTablet },
  { id: "desktop", label: messages.previewViewportDesktop },
];

const VIEWPORT_CLASS: Record<PreviewViewport, string> = {
  phone: "max-w-[320px]",
  tablet: "max-w-[620px]",
  desktop: "max-w-full",
};

const LAUNCHER_SIZE: Record<WidgetAppearanceConfig["launcherSize"], string> = {
  sm: "size-11",
  md: "size-14",
  lg: "size-16",
};

const LAUNCHER_SHAPE: Record<WidgetAppearanceConfig["launcherShape"], string> =
  {
    circle: "rounded-full",
    "rounded-square": "rounded-xl",
    square: "rounded-none",
  };

const FONT_SIZE: Record<WidgetAppearanceConfig["fontSizeScale"], string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

const SHADOW: Record<WidgetAppearanceConfig["shadowLevel"], string> = {
  none: "shadow-none",
  sm: "shadow-sm",
  md: "shadow-lg",
  lg: "shadow-2xl",
};

function copyForLocale(
  copy: WidgetLocalizedCopy,
  locale: string,
  fallback: string,
): string {
  return copy.overrides[locale as keyof typeof copy.overrides] ?? fallback;
}

export function WidgetStudioPreview({
  config,
  assetUrls = {},
}: {
  config: WidgetAppearanceConfig;
  assetUrls?: Partial<
    Record<"logo" | "launcher_icon" | "agent_avatar", string>
  >;
}) {
  const [viewport, setViewport] = useState<PreviewViewport>("desktop");
  const [rtl, setRtl] = useState(false);
  const locale = rtl ? "he" : (config.locale ?? "en");
  const headerTitle = copyForLocale(
    config.headerTitle,
    locale,
    rtl ? "צוות התמיכה" : "Support team",
  );
  const subtitle = copyForLocale(
    config.subtitle,
    locale,
    rtl ? "בדרך כלל עונים תוך כמה דקות" : "Usually replies in a few minutes",
  );
  const welcome = copyForLocale(
    config.welcomeMessage,
    locale,
    rtl ? "היי! איך אפשר לעזור?" : "Hi! How can we help?",
  );
  const placeholder = copyForLocale(
    config.placeholderText,
    locale,
    rtl ? "כתבו הודעה…" : "Type a message…",
  );

  const variables = {
    "--studio-primary": config.primaryColor,
    "--studio-accent": config.accentColor,
    "--studio-background": config.backgroundColor,
    "--studio-text": config.textColor,
    "--studio-launcher": config.launcherColor,
    "--studio-radius": `${String(config.borderRadius)}px`,
    "--studio-font": WIDGET_FONT_FAMILY_STACKS[config.fontFamily],
  } as CSSProperties;

  const isLeft = config.launcherPosition === "bottom-left";
  const headerIsColored = config.headerStyle !== "minimal";

  return (
    <section
      className="space-y-3"
      aria-label={messages.previewLabel}
      data-testid="widget-studio-preview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{messages.previewLabel}</h2>
        <div className="flex flex-wrap items-center gap-1">
          <div
            className="flex gap-1"
            role="group"
            aria-label="Preview viewport"
          >
            {VIEWPORTS.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                size="sm"
                variant={viewport === entry.id ? "secondary" : "ghost"}
                aria-pressed={viewport === entry.id}
                onClick={() => {
                  setViewport(entry.id);
                }}
              >
                {entry.label}
              </Button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant={rtl ? "secondary" : "outline"}
            aria-pressed={rtl}
            onClick={() => {
              setRtl((current) => !current);
            }}
          >
            עברית RTL
          </Button>
        </div>
      </div>

      <div className="bg-muted/50 overflow-x-auto rounded-lg border p-3 sm:p-5">
        <div
          className={`${VIEWPORT_CLASS[viewport]} bg-background relative mx-auto min-h-[600px] overflow-hidden rounded-md border transition-[max-width]`}
          style={variables}
          dir={rtl ? "rtl" : "ltr"}
          data-viewport={viewport}
        >
          <div className="text-muted-foreground p-4 text-xs">
            {rtl ? "תצוגה מקדימה של האתר" : "Example website preview"}
          </div>

          <div
            className={`absolute right-3 bottom-3 left-3 flex flex-col gap-3 ${
              isLeft ? "items-start" : "items-end"
            }`}
            style={{
              paddingInline: `${String(config.launcherOffsetX)}px`,
              paddingBottom: `${String(config.launcherOffsetY)}px`,
            }}
          >
            <div
              className={`${SHADOW[config.shadowLevel]} ${FONT_SIZE[config.fontSizeScale]} flex w-full max-w-[420px] flex-col overflow-hidden border`}
              style={{
                maxWidth: `${String(config.widgetWidth)}px`,
                height: `${String(Math.min(config.widgetHeight, 460))}px`,
                borderRadius: "var(--studio-radius)",
                backgroundColor: "var(--studio-background)",
                color: "var(--studio-text)",
                fontFamily: "var(--studio-font)",
              }}
            >
              <header
                className={`flex items-center gap-3 p-4 ${
                  config.density === "compact" ? "py-3" : "py-4"
                }`}
                style={{
                  backgroundColor: headerIsColored
                    ? "var(--studio-primary)"
                    : "var(--studio-background)",
                  color: headerIsColored ? "#FFFFFF" : "var(--studio-text)",
                  borderBottom: headerIsColored
                    ? undefined
                    : "1px solid var(--studio-accent)",
                }}
              >
                {assetUrls.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- signed, ephemeral preview asset
                  <img
                    src={assetUrls.logo}
                    alt=""
                    className="size-9 rounded-md object-contain"
                  />
                ) : (
                  <span
                    className="flex size-9 items-center justify-center rounded-full bg-white/15"
                    aria-hidden="true"
                  >
                    <MessageCircle className="size-5" />
                  </span>
                )}
                <span className="min-w-0">
                  <strong className="block truncate">{headerTitle}</strong>
                  <span className="block truncate text-xs opacity-80">
                    {subtitle}
                  </span>
                </span>
              </header>

              <div
                className={`flex flex-1 flex-col ${
                  config.density === "compact" ? "gap-2 p-3" : "gap-4 p-4"
                }`}
              >
                <div className="flex items-end gap-2">
                  {config.showAgentAvatars ? (
                    assetUrls.agent_avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed, ephemeral preview asset
                      <img
                        src={assetUrls.agent_avatar}
                        alt=""
                        className="size-7 rounded-full object-cover"
                      />
                    ) : (
                      <span className="bg-muted flex size-7 shrink-0 items-center justify-center rounded-full">
                        <UserRound className="size-4" />
                      </span>
                    )
                  ) : null}
                  <p
                    className="max-w-[80%] rounded-xl px-3 py-2"
                    style={{
                      backgroundColor:
                        "color-mix(in srgb, var(--studio-primary) 12%, transparent)",
                    }}
                  >
                    {welcome}
                  </p>
                </div>
                <p
                  className="self-end rounded-xl px-3 py-2 text-white"
                  style={{ backgroundColor: "var(--studio-accent)" }}
                >
                  {rtl ? "אשמח לקבל עזרה." : "I would like some help."}
                </p>
              </div>

              <footer className="flex items-center gap-2 border-t p-3">
                <span className="text-muted-foreground flex-1 truncate">
                  {placeholder}
                </span>
                <span
                  className="flex h-8 items-center justify-center rounded-md px-2 text-white"
                  style={{ backgroundColor: "var(--studio-primary)" }}
                  aria-hidden="true"
                >
                  {config.sendButtonStyle !== "text" ? (
                    <Send className="size-4" />
                  ) : null}
                  {config.sendButtonStyle !== "icon" ? (
                    <span className="ms-1 text-xs">
                      {rtl ? "שליחה" : "Send"}
                    </span>
                  ) : null}
                </span>
              </footer>
              {config.showPoweredBy ? (
                <p className="text-muted-foreground border-t py-1 text-center text-[10px]">
                  Powered by Site Chat
                </p>
              ) : null}
            </div>

            <button
              type="button"
              className={`${LAUNCHER_SIZE[config.launcherSize]} ${
                LAUNCHER_SHAPE[config.launcherShape]
              } flex items-center justify-center text-white shadow-lg`}
              style={{ backgroundColor: "var(--studio-launcher)" }}
              aria-label="Widget launcher preview"
            >
              {config.launcherIcon === "help" ? (
                <span className="text-xl font-bold">?</span>
              ) : assetUrls.launcher_icon &&
                config.launcherIcon === "custom" ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, ephemeral preview asset
                <img
                  src={assetUrls.launcher_icon}
                  alt=""
                  className="size-1/2 object-contain"
                />
              ) : (
                <MessageCircle className="size-1/2" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
