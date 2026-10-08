import { describe, expect, it } from "vitest";

import {
  widgetEphemeralTopicFromKey,
  widgetEphemeralTopicSchema,
  widgetMessageTopicFromKey,
  widgetMessageTopicSchema,
  widgetRealtimeTokenDataSchema,
  widgetRealtimeTopicKeySchema,
} from "../schemas/realtime.js";

describe("dual realtime topics", () => {
  const topicKey = "a".repeat(64);

  it("derives message and ephemeral topics from the same opaque key", () => {
    expect(widgetRealtimeTopicKeySchema.parse(topicKey)).toBe(topicKey);
    expect(widgetMessageTopicFromKey(topicKey)).toBe(`widget-conversation:${topicKey}`);
    expect(widgetEphemeralTopicFromKey(topicKey)).toBe(`widget-ephemeral:${topicKey}`);
  });

  it("rejects non-hex or wrong-length keys and topic names", () => {
    expect(widgetRealtimeTopicKeySchema.safeParse("abc").success).toBe(false);
    expect(widgetMessageTopicSchema.safeParse(`widget-ephemeral:${topicKey}`).success).toBe(false);
    expect(widgetEphemeralTopicSchema.safeParse(`widget-conversation:${topicKey}`).success).toBe(
      false,
    );
  });

  it("requires explicit messageTopic and ephemeralTopic on token payloads", () => {
    const parsed = widgetRealtimeTokenDataSchema.safeParse({
      token: "jwt",
      messageTopic: `widget-conversation:${topicKey}`,
      ephemeralTopic: `widget-ephemeral:${topicKey}`,
      presenceKey: "wr_abc",
      expiresAt: new Date().toISOString(),
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon",
    });
    expect(parsed.success).toBe(true);

    const legacy = widgetRealtimeTokenDataSchema.safeParse({
      token: "jwt",
      topic: `widget-conversation:${topicKey}`,
      presenceKey: "wr_abc",
      expiresAt: new Date().toISOString(),
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "anon",
    });
    expect(legacy.success).toBe(false);
  });
});
