import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ translate: vi.fn(), originals: vi.fn() }));
vi.mock("@/lib/ai-translation/actions", () => ({ translateInPortal: mocks.translate, loadOperatorReplyOriginals: mocks.originals }));
import { POST } from "./route";
function request(origin = "https://app.mill.chat") { return new NextRequest("https://app.mill.chat/api/portal/translation", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ operation: "translateMessage" }) }); }
it("rejects foreign-origin requests before invoking translation", async () => {
  expect((await POST(request("https://foreign.example"))).status).toBe(403);
  expect(mocks.translate).not.toHaveBeenCalled();
});
it("dispatches independent translations concurrently rather than serializing them", async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  mocks.translate.mockImplementation(async () => { await blocked; return { ok: true }; });
  const first = POST(request()); const second = POST(request());
  await vi.waitFor(() => { expect(mocks.translate).toHaveBeenCalledTimes(2); });
  release();
  const results = await Promise.all([first, second]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  expect(results[0].headers.get("cache-control")).toBe("no-store");
});
