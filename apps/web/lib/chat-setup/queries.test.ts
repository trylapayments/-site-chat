import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultChatSetup } from "@site-chat/shared";
const { results, client } = vi.hoisted(() => {
  const results: unknown[] = [];
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(() => Promise.resolve(results.shift())) };
  return { results, client: { from: vi.fn(() => chain) } };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => client }));
import { fetchChatSetup } from "./queries";
describe("chat setup version used by pre-chat validation", () => {
  beforeEach(() => { results.length = 0; vi.clearAllMocks(); });
  it("preserves the workspace version when the site inherits settings", async () => {
    results.push({ data: null, error: null }, { data: { config: defaultChatSetup, version: 7 }, error: null });
    expect((await fetchChatSetup("workspace", "https://example.com")).version).toBe(7);
  });
  it("uses the site version when settings are overridden", async () => {
    results.push({ data: { config: defaultChatSetup, version: 3 }, error: null });
    expect((await fetchChatSetup("workspace", "https://example.com")).version).toBe(3);
  });
});
