import { describe, expect, it } from "vitest";

import {
  createWidgetRealtimeToken,
  WIDGET_REALTIME_TOKEN_TTL_MS,
} from "./realtime-token";

describe("createWidgetRealtimeToken", () => {
  it("creates a signed JWT with widget_realtime claims", () => {
    const result = createWidgetRealtimeToken({
      topic:
        "widget-conversation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      subject: "wr_deadbeefcafebabe",
    });

    const [headerBase64, payloadBase64] = result.token.split(".");
    expect(payloadBase64).toBeTruthy();

    const header = JSON.parse(
      Buffer.from(headerBase64 ?? "", "base64url").toString("utf8"),
    ) as { alg: string; typ: string };

    const payload = JSON.parse(
      Buffer.from(payloadBase64 ?? "", "base64url").toString("utf8"),
    ) as {
      role: string;
      purpose: string;
      topic: string;
      sub: string;
      exp: number;
      iat: number;
    };

    expect(header.alg).toBe("HS256");
    expect(header.typ).toBe("JWT");
    expect(payload.role).toBe("widget_realtime");
    expect(payload.purpose).toBe("widget_realtime");
    expect(payload.topic).toMatch(/^widget-conversation:[a-f0-9]{64}$/);
    expect(payload.sub).toBe("wr_deadbeefcafebabe");
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(payload.exp - payload.iat).toBe(WIDGET_REALTIME_TOKEN_TTL_MS / 1000);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      WIDGET_REALTIME_TOKEN_TTL_MS + 1000,
    );
  });
});
