export function isMessageFromIframe(
  event: MessageEvent,
  iframe: HTMLIFrameElement,
  expectedOrigin: string,
): boolean {
  return event.origin === expectedOrigin && event.source === iframe.contentWindow;
}

export function isMessageFromParent(event: MessageEvent, expectedParentOrigin: string): boolean {
  return event.source === window.parent && event.origin === expectedParentOrigin;
}

export const LOADER_MESSAGE_TYPES = [
  "sitechat:init",
  "sitechat:page",
  "sitechat:identify",
] as const;

export const EMBED_MESSAGE_TYPES = [
  "sitechat:ready",
  "sitechat:visibility",
  "sitechat:refresh-embed",
] as const;

export type LoaderMessageType = (typeof LOADER_MESSAGE_TYPES)[number];
export type EmbedMessageType = (typeof EMBED_MESSAGE_TYPES)[number];

export function isLoaderMessageType(value: unknown): value is LoaderMessageType {
  return typeof value === "string" && (LOADER_MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isEmbedMessageType(value: unknown): value is EmbedMessageType {
  return typeof value === "string" && (EMBED_MESSAGE_TYPES as readonly string[]).includes(value);
}
