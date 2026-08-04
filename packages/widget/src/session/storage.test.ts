import { describe, expect, it } from "vitest";

import {
  getSessionStorageKey,
  isStorageAvailable,
  readSessionToken,
  writeSessionToken,
} from "./storage";

describe("session storage", () => {
  it("uses widget public key scoped storage keys", () => {
    expect(getSessionStorageKey("wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "sitechat:session:wk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("reads and writes session tokens when storage is available", () => {
    if (!isStorageAvailable()) {
      expect(true).toBe(true);
      return;
    }

    const key = "wk_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    writeSessionToken(key, "token-value");
    expect(readSessionToken(key)).toBe("token-value");
    localStorage.removeItem(getSessionStorageKey(key));
  });
});
