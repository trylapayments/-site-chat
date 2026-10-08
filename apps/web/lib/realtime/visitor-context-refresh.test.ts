import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVisitorContextRefresh } from "./visitor-context-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("visitor snapshot catch-up", () => {
  it("coalesces first-join and CDC bursts into one authoritative read", async () => {
    const read = vi.fn().mockResolvedValue("current page");
    const onSnapshot = vi.fn();
    const refresh = createVisitorContextRefresh({
      read,
      onSnapshot,
      onError: vi.fn(),
    });
    refresh.schedule();
    refresh.schedule();
    refresh.schedule();
    await vi.advanceTimersByTimeAsync(250);
    expect(read).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith("current page");
    refresh.stop();
  });

  it("rejects an old snapshot immediately when a newer CDC event arrives", async () => {
    const old = deferred<string>();
    const read = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce("new page");
    const onSnapshot = vi.fn();
    const refresh = createVisitorContextRefresh({
      read,
      onSnapshot,
      onError: vi.fn(),
    });
    refresh.schedule();
    await vi.advanceTimersByTimeAsync(250);
    refresh.schedule();
    old.resolve("old page");
    await Promise.resolve();
    expect(onSnapshot).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith("new page");
    refresh.stop();
  });

  it("catches up immediately after a saved edit and ignores an older in-flight read", async () => {
    const old = deferred<string>();
    const read = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce("saved name");
    const onSnapshot = vi.fn();
    const refresh = createVisitorContextRefresh({
      read,
      onSnapshot,
      onError: vi.fn(),
    });
    refresh.schedule();
    await vi.advanceTimersByTimeAsync(250);
    await refresh.refresh();
    old.resolve("previous name");
    await Promise.resolve();
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith("saved name");
    refresh.stop();
  });

  it("recovers a failed read even without another CDC event", async () => {
    const failure = new Error("temporary network failure");
    const read = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("recovered");
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const refresh = createVisitorContextRefresh({ read, onSnapshot, onError });
    await refresh.refresh();
    expect(onError).toHaveBeenCalledWith(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSnapshot).toHaveBeenCalledWith("recovered");
    refresh.stop();
  });

  it("cancels pending retries and ignores reads after leaving the conversation", async () => {
    const pending = deferred<string>();
    const onSnapshot = vi.fn();
    const onError = vi.fn();
    const refresh = createVisitorContextRefresh({
      read: () => pending.promise,
      onSnapshot,
      onError,
    });
    const request = refresh.refresh();
    refresh.stop();
    pending.resolve("other conversation");
    await request;
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    const read = vi.fn().mockRejectedValue(new Error("offline"));
    const retry = createVisitorContextRefresh({ read, onSnapshot, onError });
    await retry.refresh();
    retry.stop();
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
