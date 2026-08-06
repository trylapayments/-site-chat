import { describe, expect, it } from "vitest";

import { resolveWidgetSupabaseConfig } from "./visitor-transport";

describe("resolveWidgetSupabaseConfig", () => {
  it("prefers runtime credentials from the realtime-token response", () => {
    const resolved = resolveWidgetSupabaseConfig({
      supabaseUrl: "http://127.0.0.1:54321",
      supabaseAnonKey: "local-anon-key",
    });

    expect(resolved).toEqual({
      url: "http://127.0.0.1:54321",
      key: "local-anon-key",
    });
  });

  it("rejects CI placeholder URL/key even when present at build time", () => {
    expect(
      resolveWidgetSupabaseConfig({
        supabaseUrl: "https://placeholder.supabase.co",
        supabaseAnonKey: "placeholder-anon-key-for-ci-build",
      }),
    ).toBeNull();
  });

  it("rejects missing credentials", () => {
    expect(resolveWidgetSupabaseConfig()).toBeNull();
  });
});
