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
