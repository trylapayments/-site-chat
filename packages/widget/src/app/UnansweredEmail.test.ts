import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnansweredEmail } from "./UnansweredEmail";
import type { WidgetApiClient } from "../api/client";
import type { MessageView } from "@site-chat/shared";

describe("email follow-up offer", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
  it("appears only after the configured delay and disappears when an operator replies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const messages: MessageView[] = [
      {
        id: "1",
        senderType: "visitor",
        senderLabel: "You",
        body: "Help",
        createdAt: new Date().toISOString(),
        sequenceNumber: 1,
      },
    ];
    const props = {
      api: {} as WidgetApiClient,
      embedToken: "embed",
      sessionToken: "session",
      messages,
      enabled: true,
      delaySeconds: 120,
      saved: false,
      open: true,
      accentColor: "blue",
      textColor: "black",
      borderColor: "gray",
    };
    await act(async () => {
      await Promise.resolve();
      root.render(createElement(UnansweredEmail, props));
    });
    expect(node.textContent).toBe("");
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(119000);
    });
    expect(node.textContent).toBe("");
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
    });
    expect(node.textContent).toContain("Don't want to wait?");
    await act(async () => {
      await Promise.resolve();
      root.render(
        createElement(UnansweredEmail, {
          ...props,
          messages: [
            ...messages,
            {
              ...messages[0],
              senderLabel: "Agent",
              body: "Hello",
              createdAt: new Date().toISOString(),
              id: "2",
              senderType: "agent",
              sequenceNumber: 2,
            },
          ],
        }),
      );
    });
    expect(node.textContent).toBe("");
    await act(async () => {
      await Promise.resolve();
      root.unmount();
    });
  });
  it("does not ask for email again when it is already saved, and respects disabling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T10:05:00Z"));
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const props = {
      api: {} as WidgetApiClient,
      embedToken: "embed",
      sessionToken: "session",
      messages: [
        {
          id: "1",
          senderType: "visitor" as const,
          senderLabel: "You",
          body: "Help",
          createdAt: "2026-10-07T10:00:00Z",
          sequenceNumber: 1,
        },
      ],
      enabled: true,
      delaySeconds: 120,
      saved: true,
      open: true,
      accentColor: "blue",
      textColor: "black",
      borderColor: "gray",
    };
    await act(async () => {
      await Promise.resolve();
      root.render(createElement(UnansweredEmail, props));
    });
    expect(node.textContent).toContain("We'll email you");
    expect(node.querySelector("input")).toBeNull();
    await act(async () => {
      await Promise.resolve();
      root.render(createElement(UnansweredEmail, { ...props, hasOperatorReply: true }));
    });
    expect(node.textContent).toBe(""); // reply can be outside the loaded message page
    const first = props.messages[0];
    if (!first) throw new Error("Missing test message");
    const afterReply = [first, { ...first, id: "agent", senderType: "agent" as const, sequenceNumber: 2 }, { ...first, id: "next", sequenceNumber: 3 }];
    await act(async () => {
      await Promise.resolve();
      root.render(createElement(UnansweredEmail, { ...props, messages: afterReply }));
      vi.advanceTimersByTime(600000);
    });
    expect(node.textContent).toBe("");
    await act(async () => {
      await Promise.resolve();
      root.render(createElement(UnansweredEmail, { ...props, enabled: false }));
    });
    expect(node.textContent).toBe("");
    await act(async () => {
      await Promise.resolve();
      root.unmount();
    });
  });
});
