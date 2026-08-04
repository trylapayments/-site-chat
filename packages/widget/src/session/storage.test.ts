import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetMemoryStoreForTests,
  clearSessionToken,
  readSessionToken,
  writeSessionToken,
} from "./storage";

describe("session storage", () => {
  afterEach(() => {
    __resetMemoryStoreForTests();
    vi.unstubAllGlobals();
  });

  it("uses widget public key scoped storage keys", () => {
    expect(readSessionToken("wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });

  it("reads and writes session tokens when storage is available", () => {
    const key = "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    writeSessionToken(key, "token-value");
    expect(readSessionToken(key)).toBe("token-value");
    clearSessionToken(key);
    expect(readSessionToken(key)).toBeNull();
  });

  it("falls back to in-memory storage when localStorage throws", () => {
    const brokenStorage = {
      setItem: () => {
        throw new Error("blocked");
      },
      getItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    vi.stubGlobal("localStorage", brokenStorage);

    const key = "wk_cccccccccccccccccccccccccccccccc";
    writeSessionToken(key, "memory-token");
    expect(readSessionToken(key)).toBe("memory-token");
    clearSessionToken(key);
    expect(readSessionToken(key)).toBeNull();
  });
});
