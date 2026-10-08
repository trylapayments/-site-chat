export type InteractionKind =
  | "Document response"
  | "Document ready"
  | "Document loaded"
  | "DOM ready"
  | "Portal mounted"
  | "Last script loaded"
  | "First content paint"
  | "Initial data ready"
  | "Initial data unavailable"
  | "Page effect ready"
  | "Overview mounted"
  | "Overview HTTP start"
  | "Overview HTTP ready"
  | "Open page"
  | "Open conversation"
  | "Send message"
  | "Send attachment"
  | "Change status";
export type InteractionSample = {
  kind: InteractionKind;
  milliseconds: number;
  ok: boolean;
};
let enabled = false;
let counter = 0;
const pending = new Map<number, { kind: InteractionKind; start: number }>();
let navigation: { conversationId: string; token: number } | null = null;
let pageNavigation: { path: string; token: number } | null = null;
let samples: InteractionSample[] = [];
const listeners = new Set<() => void>();

export function enableInteractionTiming(value: boolean) {
  enabled = value;
  if (!value) {
    pending.clear();
    navigation = null;
    pageNavigation = null;
  }
}
export function startInteraction(kind: InteractionKind): number | null {
  if (!enabled) return null;
  const token = ++counter;
  pending.set(token, { kind, start: performance.now() });
  return token;
}
export function finishInteraction(token: number | null, ok: boolean) {
  if (token === null) return;
  const entry = pending.get(token);
  if (!entry) return;
  pending.delete(token);
  samples = [
    ...samples.slice(-49),
    {
      kind: entry.kind,
      milliseconds: Math.round(performance.now() - entry.start),
      ok,
    },
  ];
  for (const listener of listeners) listener();
}
export function startConversationNavigation(conversationId: string) {
  if (navigation) pending.delete(navigation.token);
  const token = startInteraction("Open conversation");
  navigation = token === null ? null : { conversationId, token };
}
export function finishConversationNavigation(conversationId: string) {
  if (navigation?.conversationId !== conversationId) return;
  finishInteraction(navigation.token, true);
  navigation = null;
}
export function interactionSamples() {
  return samples;
}
export function clearInteractionSamples() {
  samples = [];
  for (const listener of listeners) listener();
}
export function subscribeInteractionSamples(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function startPageNavigation(path: string) {
  if (pageNavigation) pending.delete(pageNavigation.token);
  const token = startInteraction("Open page");
  pageNavigation =
    token === null ? null : { path: path.split("?")[0] ?? path, token };
}
export function finishPageNavigation(path: string) {
  if (pageNavigation?.path !== path) return;
  finishInteraction(pageNavigation.token, true);
  pageNavigation = null;
}

let documentRecorded = false;
/** Full navigation is measured from the browser's navigation start, not from
 * hydration. It is deliberately distinct from a client-side route change. */
export function recordDocumentReady() {
  if (!enabled || documentRecorded) return;
  const entry = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (!entry) return;
  documentRecorded = true;
  const scripts = performance
    .getEntriesByType("resource")
    .filter((e) => e.name.includes("/_next/static/chunks/"));
  const scriptEnd = Math.max(
    0,
    ...scripts.map((e) => e.startTime + e.duration),
  );
  const paint = performance.getEntriesByName("first-contentful-paint")[0];
  samples = [
    ...samples.slice(-45),
    {
      kind: "Last script loaded",
      milliseconds: Math.round(scriptEnd),
      ok: true,
    },
    ...(paint
      ? [
          {
            kind: "First content paint" as const,
            milliseconds: Math.round(paint.startTime),
            ok: true,
          },
        ]
      : []),
    {
      kind: "Document response",
      milliseconds: Math.round(entry.responseStart - entry.startTime),
      ok: true,
    },
    {
      kind: "Document ready",
      milliseconds: Math.round(performance.now() - entry.startTime),
      ok: true,
    },
  ];
  for (const listener of listeners) listener();
}

export function recordPortalMounted() {
  if (!enabled) return;
  const entry = performance.getEntriesByType("navigation")[0] as
    PerformanceNavigationTiming | undefined;
  if (!entry) return;
  samples = [
    ...samples.slice(-46),
    {
      kind: "Document loaded",
      milliseconds: Math.round(entry.responseEnd),
      ok: true,
    },
    {
      kind: "DOM ready",
      milliseconds: Math.round(entry.domContentLoadedEventEnd),
      ok: true,
    },
    {
      kind: "Portal mounted",
      milliseconds: Math.round(performance.now()),
      ok: true,
    },
  ];
  for (const listener of listeners) listener();
}

export function recordStartupStage(
  kind:
    | "Initial data ready"
    | "Initial data unavailable"
    | "Page effect ready"
    | "Overview mounted"
    | "Overview HTTP start"
    | "Overview HTTP ready",
) {
  if (
    typeof window === "undefined" ||
    documentRecorded ||
    (!enabled &&
      new URLSearchParams(window.location.search).get("millPerf") !== "1")
  )
    return;
  samples = [
    ...samples.slice(-49),
    { kind, milliseconds: Math.round(performance.now()), ok: true },
  ];
  for (const listener of listeners) listener();
}
