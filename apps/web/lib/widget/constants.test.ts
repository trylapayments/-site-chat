import { describe, expect, it } from "vitest";

import {
  getEmbedTokenFromRequest,
  WIDGET_EMBED_TOKEN_HEADER,
} from "@/lib/widget/constants";

describe("widget embed token header", () => {
  it("reads embed token from the dedicated header", () => {
    const request = new Request("https://example.com/api/v1/widget/messages", {
      headers: {
        [WIDGET_EMBED_TOKEN_HEADER]: "signed-token-value",
      },
    });

    expect(getEmbedTokenFromRequest(request)).toBe("signed-token-value");
  });

  it("does not accept embed token from query parameters", () => {
    const request = new Request(
      "https://example.com/api/v1/widget/messages?embedToken=leaked-token",
    );

    expect(getEmbedTokenFromRequest(request)).toBeNull();
    expect(request.url).not.toContain("signed-token-value");
  });
});
