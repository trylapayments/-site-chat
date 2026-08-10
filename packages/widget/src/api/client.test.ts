import { afterEach, describe, expect, it, vi } from "vitest";

import { WIDGET_EMBED_TOKEN_HEADER, WidgetApiClient } from "./client";

function getRequestUrl(input: RequestInfo | URL | undefined): string {
  if (!input) {
    return "";
  }
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
}

describe("WidgetApiClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never puts embedToken in list messages URL", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          data: { items: [], has_older: false, oldest_sequence: null },
          meta: { requestId: "11111111-1111-1111-1111-111111111111" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WidgetApiClient("https://app.example.com");
    await client.listMessages({
      embedToken: "secret-embed-token",
      sessionToken: "secret-session-token",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      return;
    }

    const requestUrl = getRequestUrl(call[0]);
    const requestInit = call[1];

    expect(requestUrl).not.toContain("embedToken");
    expect(requestUrl).not.toContain("secret-embed-token");
    expect(requestInit?.headers).toMatchObject({
      Authorization: "Bearer secret-session-token",
      [WIDGET_EMBED_TOKEN_HEADER]: "secret-embed-token",
    });
  });

  it("posts markReceipt with bearer session and embed body", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          data: {
            last_delivered_sequence: 4,
            last_read_sequence: 4,
            updated: true,
          },
          meta: { requestId: "11111111-1111-1111-1111-111111111111" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WidgetApiClient("https://app.example.com");
    const result = await client.markReceipt({
      embedToken: "secret-embed-token",
      sessionToken: "secret-session-token",
      kind: "read",
      throughSequence: 4,
    });

    expect(result).toEqual({
      last_delivered_sequence: 4,
      last_read_sequence: 4,
      updated: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      return;
    }

    expect(getRequestUrl(call[0])).toContain("/api/v1/widget/receipts");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.headers).toMatchObject({
      Authorization: "Bearer secret-session-token",
      "Content-Type": "application/json",
    });
    const body = call[1]?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toEqual({
      embedToken: "secret-embed-token",
      kind: "read",
      throughSequence: 4,
    });
  });

  it("posts createSession with visitor context fields", async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        Response.json({
          data: {
            sessionToken: "session-token",
            expiresAt: new Date().toISOString(),
            locale: "en",
            hasConversation: false,
            conversationStatus: null,
            visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
          meta: { requestId: "11111111-1111-1111-1111-111111111111" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WidgetApiClient("https://app.example.com");
    const result = await client.createSession({
      embedToken: "secret-embed-token",
      pageUrl: "https://customer.example.com/pricing?utm_source=ads",
      pageTitle: "Pricing",
      referrer: "https://google.com/",
      visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timezone: "America/New_York",
      language: "en-US",
    });

    expect(result.visitorPublicId).toBe("vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof body).toBe("string");
    expect(JSON.parse(body as string)).toMatchObject({
      embedToken: "secret-embed-token",
      pageUrl: "https://customer.example.com/pricing?utm_source=ads",
      pageTitle: "Pricing",
      visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timezone: "America/New_York",
      language: "en-US",
    });
  });

  it("posts identify and recordPageView with bearer session", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = getRequestUrl(input);
      if (url.includes("/identify")) {
        return Promise.resolve(
          Response.json({
            data: {
              visitorPublicId: "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              name: "Ada",
              email: "ada@example.com",
              phone: null,
              attributes: { plan: "pro" },
            },
            meta: { requestId: "11111111-1111-1111-1111-111111111111" },
          }),
        );
      }
      return Promise.resolve(
        Response.json({
          data: {
            recorded: true,
            deduped: false,
            currentUrl: "https://customer.example.com/docs",
            currentTitle: "Docs",
          },
          meta: { requestId: "11111111-1111-1111-1111-111111111111" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new WidgetApiClient("https://app.example.com");
    const identified = await client.identify({
      embedToken: "secret-embed-token",
      sessionToken: "secret-session-token",
      name: "Ada",
      email: "ada@example.com",
      attributes: { plan: "pro" },
    });
    expect(identified.name).toBe("Ada");

    const pageView = await client.recordPageView({
      embedToken: "secret-embed-token",
      sessionToken: "secret-session-token",
      url: "https://customer.example.com/docs",
      title: "Docs",
    });
    expect(pageView.recorded).toBe(true);

    expect(getRequestUrl(fetchMock.mock.calls[0]?.[0])).toContain("/api/v1/widget/identify");
    expect(getRequestUrl(fetchMock.mock.calls[1]?.[0])).toContain("/api/v1/widget/page-view");
  });
});
