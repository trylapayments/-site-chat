import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetMemoryStoreForTests,
  clearContinuityToken,
  clearSessionToken,
  clearVisitorPublicId,
  getOrCreateTabId,
  readContinuityToken,
  readSessionToken,
  readVisitorPublicId,
  writeContinuityToken,
  writeSessionToken,
  writeVisitorPublicId,
} from "./storage";

describe("session storage", () => {
  afterEach(() => {
    __resetMemoryStoreForTests();
    vi.unstubAllGlobals();
    sessionStorage.clear();
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

  it("reads and writes visitor public ids", () => {
    const key = "wk_dddddddddddddddddddddddddddddddd";
    const visitorId = "vis_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(writeVisitorPublicId(key, visitorId)).toBe(true);
    expect(readVisitorPublicId(key)).toBe(visitorId);
    clearVisitorPublicId(key);
    expect(readVisitorPublicId(key)).toBeNull();
  });

  it("rejects invalid visitor public ids", () => {
    const key = "wk_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    expect(writeVisitorPublicId(key, "not-a-visitor-id")).toBe(false);
    expect(readVisitorPublicId(key)).toBeNull();
  });

  it("reads and writes continuity tokens", () => {
    const key = "wk_ffffffffffffffffffffffffffffffff";
    const continuityToken = "continuity-token-abc123def456";
    expect(writeContinuityToken(key, continuityToken)).toBe(true);
    expect(readContinuityToken(key)).toBe(continuityToken);
    clearContinuityToken(key);
    expect(readContinuityToken(key)).toBeNull();
  });

  it("rejects invalid continuity tokens", () => {
    const key = "wk_11111111111111111111111111111111";
    expect(writeContinuityToken(key, "too-short")).toBe(false);
    expect(readContinuityToken(key)).toBeNull();
    expect(writeContinuityToken(key, "has invalid spaces and chars!!")).toBe(false);
    expect(readContinuityToken(key)).toBeNull();
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

    const visitorId = "vis_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    expect(writeVisitorPublicId(key, visitorId)).toBe(true);
    expect(readVisitorPublicId(key)).toBe(visitorId);
    clearVisitorPublicId(key);
    expect(readVisitorPublicId(key)).toBeNull();

    const continuityToken = "memory-continuity-token-value-123";
    expect(writeContinuityToken(key, continuityToken)).toBe(true);
    expect(readContinuityToken(key)).toBe(continuityToken);
    clearContinuityToken(key);
    expect(readContinuityToken(key)).toBeNull();
  });

  describe("getOrCreateTabId", () => {
    it("returns a stable id across repeated calls within the same tab", () => {
      const first = getOrCreateTabId();
      const second = getOrCreateTabId();
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThanOrEqual(1);
      expect(first.length).toBeLessThanOrEqual(64);
    });

    it("persists the tab id in sessionStorage under the sitechat:tab key", () => {
      const tabId = getOrCreateTabId();
      expect(sessionStorage.getItem("sitechat:tab")).toBe(tabId);
    });

    it("reuses a pre-existing sessionStorage tab id instead of minting a new one", () => {
      sessionStorage.setItem("sitechat:tab", "existing-tab-id");
      expect(getOrCreateTabId()).toBe("existing-tab-id");
    });

    it("falls back to a stable in-memory tab id when sessionStorage is unavailable", () => {
      const brokenSessionStorage = {
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
      vi.stubGlobal("sessionStorage", brokenSessionStorage);

      const first = getOrCreateTabId();
      const second = getOrCreateTabId();
      expect(first).toBe(second);
      expect(first.length).toBeGreaterThanOrEqual(1);
      expect(first.length).toBeLessThanOrEqual(64);
    });
  });
});
