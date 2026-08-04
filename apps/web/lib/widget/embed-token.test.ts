import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createEmbedToken,
  normalizeParentOrigin,
  verifyEmbedToken,
} from "@/lib/widget/embed-token";

describe("embed token", () => {
  const secret = "test-widget-embed-secret-min-32-characters";

  it("normalizes parent origins", () => {
    expect(normalizeParentOrigin("https://Shop.Example.com/path")).toBe(
      "https://shop.example.com",
    );
    expect(normalizeParentOrigin("http://localhost:3000/page")).toBe(
      "http://localhost:3000",
    );
  });

  it("creates and verifies a signed embed token", () => {
    process.env.WIDGET_EMBED_SECRET = secret;

    const { token } = createEmbedToken({
      widgetPublicKey: "wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      workspaceId: "11111111-1111-1111-1111-111111111111",
      parentOrigin: "https://example.com",
    });

    const payload = verifyEmbedToken(token);
    expect(payload.widgetPublicKey).toBe("wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(payload.parentOrigin).toBe("https://example.com");
  });

  it("rejects tampered tokens", () => {
    process.env.WIDGET_EMBED_SECRET = secret;

    const { token } = createEmbedToken({
      widgetPublicKey: "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      workspaceId: "22222222-2222-2222-2222-222222222222",
      parentOrigin: "https://example.com",
    });

    const tampered = `${token}x`;
    expect(() => verifyEmbedToken(tampered)).toThrow();
  });

  it("rejects expired tokens", () => {
    process.env.WIDGET_EMBED_SECRET = secret;

    const past = Math.floor(Date.now() / 1000) - 60;
    const payload = {
      widgetPublicKey: "wk_cccccccccccccccccccccccccccccccc",
      workspaceId: "33333333-3333-3333-3333-333333333333",
      parentOrigin: "https://example.com",
      exp: past,
    };
    const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const signature = createHmac("sha256", secret)
      .update(payloadBase64)
      .digest("base64url");
    const expiredToken = `${payloadBase64}.${signature}`;

    expect(() => verifyEmbedToken(expiredToken)).toThrow(/expired/i);
  });
});
