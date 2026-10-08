import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearInteractionSamples,
  enableInteractionTiming,
  finishConversationNavigation,
  finishInteraction,
  interactionSamples,
  startConversationNavigation,
  startInteraction,
  startPageNavigation,
  finishPageNavigation,
  recordDocumentReady,
} from "./interactions";

afterEach(() => {
  enableInteractionTiming(false);
  clearInteractionSamples();
  vi.restoreAllMocks();
});
describe("interaction timings", () => {
  it("does not collect when disabled", () => {
    expect(startInteraction("Send message")).toBeNull();
    expect(interactionSamples()).toEqual([]);
  });
  it("records acknowledgement once and keeps failures distinct", () => {
    enableInteractionTiming(true);
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(250);
    const token = startInteraction("Send message");
    finishInteraction(token, false);
    finishInteraction(token, true);
    expect(interactionSamples()).toEqual([
      { kind: "Send message", milliseconds: 150, ok: false },
    ]);
  });
  it("does not report an old conversation as the completion of a newer navigation", () => {
    enableInteractionTiming(true);
    startConversationNavigation("a");
    startConversationNavigation("b");
    finishConversationNavigation("a");
    expect(interactionSamples()).toHaveLength(0);
    finishConversationNavigation("b");
    expect(interactionSamples()).toHaveLength(1);
  });
  it("drops in-flight timings when switched off", () => {
    enableInteractionTiming(true);
    const token = startInteraction("Send attachment");
    enableInteractionTiming(false);
    finishInteraction(token, true);
    expect(interactionSamples()).toHaveLength(0);
  });
});

describe("page navigation timings", () => {
  it("does not finish when a different page or a superseded request loads", () => {
    enableInteractionTiming(true);
    startPageNavigation("/app/demo");
    startPageNavigation("/app/demo/inbox?status=open");
    finishPageNavigation("/app/demo");
    expect(interactionSamples()).toHaveLength(0);
    finishPageNavigation("/app/demo/inbox");
    expect(interactionSamples()).toHaveLength(1);
    expect(interactionSamples()[0]?.kind).toBe("Open page");
  });
});

 it("measures a full load from navigation start and records it only once", () => {
  enableInteractionTiming(true);
  vi.spyOn(performance, "getEntriesByType").mockImplementation(type => type === "navigation" ? [
    { startTime: 0, responseStart: 350 } as PerformanceNavigationTiming,
  ] : [{name: "https://example.test/_next/static/chunks/main.js", startTime: 400, duration: 100} as PerformanceResourceTiming]);
  vi.spyOn(performance, "getEntriesByName").mockReturnValue([{startTime: 450} as PerformanceEntry]);
  vi.spyOn(performance, "now").mockReturnValue(1200);
  recordDocumentReady();
  recordDocumentReady();
  expect(interactionSamples()).toEqual([
    {kind: "Last script loaded", milliseconds: 500, ok: true},
    {kind: "First content paint", milliseconds: 450, ok: true},
    { kind: "Document response", milliseconds: 350, ok: true },
    { kind: "Document ready", milliseconds: 1200, ok: true },
  ]);
});
