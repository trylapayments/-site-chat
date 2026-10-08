import { describe, expect, it, vi } from "vitest";
import { createResourceStore } from "./resource-store";
describe("private portal resources", () => {
  it("coalesces overlapping reads and retains data during background refresh", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>();
    fetcher.mockResolvedValueOnce(Response.json({ count: 2 }));
    const store = createResourceStore(fetcher);
    await store.refresh("/inbox");
    fetcher.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = store.refresh("/inbox");
    await store.refresh("/inbox");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(store.snapshot("/inbox")).toMatchObject({
      data: { count: 2 },
      loading: true,
    });
    resolve(Response.json({ count: 3 }));
    await pending;
    expect(store.snapshot("/inbox").data).toEqual({ count: 3 });
  });
  it("cannot resurrect private data from a response arriving after logout", async () => {
    let resolve!: (response: Response) => void;
    const store = createResourceStore(
      vi.fn<typeof fetch>(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    const pending = store.refresh("/inbox");
    store.clear();
    resolve(Response.json({ privateMessage: "old user" }));
    await pending;
    expect(store.snapshot("/inbox").data).toBeUndefined();
  });
  it("clears all cached resources when permission is revoked", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(["private"]))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const store = createResourceStore(fetcher);
    await store.refresh("/inbox");
    await store.refresh("/overview");
    expect(store.snapshot("/inbox").data).toBeUndefined();
    expect(store.snapshot("/overview").error).toContain("access removed");
  });
  it("does not share data between workspace provider instances", async () => {
    const first = createResourceStore(
      vi.fn<typeof fetch>().mockResolvedValue(Response.json([1])),
    );
    const second = createResourceStore();
    await first.refresh("/inbox");
    expect(second.snapshot("/inbox").data).toBeUndefined();
  });
  it("keeps last known data with an explicit error during a temporary outage", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json([1]))
      .mockRejectedValueOnce(new Error("offline"));
    const store = createResourceStore(fetcher);
    await store.refresh("/inbox");
    await store.refresh("/inbox");
    expect(store.snapshot("/inbox").error).toBeTruthy();
    expect(store.snapshot("/inbox")).toMatchObject({
      data: [1],
      loading: false,
    });
  });
});

it("bounds private conversation memory and evicts older inactive threads", async () => {
  const store = createResourceStore(
    vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ messages: [] })),
      ),
  );
  for (let index = 0; index < 80; index++)
    await store.refresh(`/conversation/${String(index)}`);
  expect(store.snapshot("/conversation/0").data).toBeUndefined();
  expect(store.snapshot("/conversation/79").data).toEqual({ messages: [] });
  expect(
    Array.from(
      { length: 80 },
      (_, index) => store.snapshot(`/conversation/${String(index)}`).data,
    ).filter(Boolean),
  ).toHaveLength(64);
});

it("keeps the inbox available while older conversation snapshots are evicted", async () => {
  const store = createResourceStore(
    vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(Response.json({ items: [] }))),
  );
  await store.refresh("/api/portal/demo/inbox");
  for (let index = 0; index < 80; index++)
    await store.refresh(`/api/portal/demo/conversations/${String(index)}`);
  expect(store.snapshot("/api/portal/demo/inbox").data).toEqual({ items: [] });
  expect(
    store.snapshot("/api/portal/demo/conversations/0").data,
  ).toBeUndefined();
});

it("uses the authenticated first-screen seed without a second initial fetch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const store = createResourceStore(fetcher);
  store.prime("/inbox", Promise.resolve({ items: [1] }));
  await store.refresh("/inbox");
  expect(store.snapshot("/inbox").data).toEqual({ items: [1] });
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not resurrect a server-render seed arriving after logout", async () => {
  let resolve!: (data: unknown) => void;
  const store = createResourceStore(vi.fn<typeof fetch>());
  store.prime(
    "/inbox",
    new Promise((r) => {
      resolve = r;
    }),
  );
  store.clear();
  resolve({ private: "old user" });
  await Promise.resolve();
  await Promise.resolve();
  expect(store.snapshot("/inbox").data).toBeUndefined();
});
it("falls back to HTTP when the initial server resource fails", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ items: [2] }));
  const store = createResourceStore(fetcher);
  store.prime("/inbox", Promise.reject(new Error("seed failed")));
  await store.refresh("/inbox");
  expect(store.snapshot("/inbox").data).toEqual({ items: [2] });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not wait indefinitely for a stalled server seed", async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: [3] }));
    const store = createResourceStore(fetcher);
    store.prime("/inbox", new Promise(() => {}));
    const pending = store.refresh("/inbox");
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(store.snapshot("/inbox").data).toEqual({ items: [3] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps hydration markup stable when a streamed seed settles before hydration", async () => {
  const store = createResourceStore(vi.fn<typeof fetch>());
  const serverBaseline = store.serverSnapshot();
  store.prime("/overview", Promise.resolve({ count: 7 }));
  await Promise.resolve();
  await Promise.resolve();
  expect(store.snapshot("/overview").data).toEqual({ count: 7 });
  expect(store.serverSnapshot()).toBe(serverBaseline);
  expect(store.serverSnapshot().data).toBeUndefined();
});

// Flight values expose then(), but unlike native promises their then() returns
// void. Exercise that actual streaming contract rather than Promise.resolve data.
it("accepts React Flight thenables without losing the server payload", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const store = createResourceStore(fetcher);
  const flight = {
    then(resolve: (value: unknown) => void) {
      resolve({ items: ["seed"] });
    },
  } as unknown as Promise<unknown>;
  store.prime("/inbox", flight);
  await store.refresh("/inbox");
  expect(store.snapshot("/inbox").data).toEqual({ items: ["seed"] });
  expect(fetcher).not.toHaveBeenCalled();
});
