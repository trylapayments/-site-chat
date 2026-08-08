import { afterEach, describe, expect, it, vi } from "vitest";

import { WIDGET_EMBED_TOKEN_HEADER, WidgetApiClient } from "./client";

function getRequestUrl(input: RequestInfo | URL): string {
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
});
