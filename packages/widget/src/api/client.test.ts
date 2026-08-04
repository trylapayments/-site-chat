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
});
