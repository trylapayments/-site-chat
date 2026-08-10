import { describe, expect, it } from "vitest";

import { AIError, toPublicAIError } from "./errors";

describe("AIError", () => {
  it("exposes stable public codes without leaking upstream details", () => {
    const error = new AIError("AI_PROVIDER_ERROR", "secret stack", {
      cause: new Error("upstream api key sk-live-secret"),
    });

    const publicError = toPublicAIError(error);
    expect(publicError.code).toBe("AI_PROVIDER_ERROR");
    expect(publicError.message).not.toContain("secret");
    expect(publicError.message).not.toContain("sk-live");
  });
});
