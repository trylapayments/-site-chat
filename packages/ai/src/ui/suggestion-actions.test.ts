import { describe, expect, it } from "vitest";

import { acceptSuggestionIntoComposer } from "./suggestion-actions";
import { escapeHtml, looksLikeHtmlPayload, sanitizePlainText } from "../safety/sanitize";

describe("acceptSuggestionIntoComposer", () => {
  it("inserts into an empty composer", () => {
    const result = acceptSuggestionIntoComposer({
      suggestion: "Thanks for waiting.",
      composerText: "",
    });

    expect(result).toEqual({
      ok: true,
      nextComposerText: "Thanks for waiting.",
      mode: "insert",
    });
  });

  it("requires confirmation when composer already has content", () => {
    const result = acceptSuggestionIntoComposer({
      suggestion: "New draft",
      composerText: "Existing draft",
    });

    expect(result).toEqual({
      ok: false,
      reason: "needs_confirmation",
      suggestion: "New draft",
    });
  });

  it("replaces or appends only with explicit intent", () => {
    expect(
      acceptSuggestionIntoComposer({
        suggestion: "New draft",
        composerText: "Existing",
        mode: "replace",
      }),
    ).toMatchObject({
      ok: true,
      nextComposerText: "New draft",
      mode: "replace",
    });

    expect(
      acceptSuggestionIntoComposer({
        suggestion: "More",
        composerText: "Existing",
        mode: "append",
      }),
    ).toMatchObject({
      ok: true,
      nextComposerText: "Existing\n\nMore",
      mode: "append",
    });
  });
});

describe("malicious model output safety", () => {
  it("sanitizes and escapes HTML without executing it", () => {
    const malicious = `<script>alert("xss")</script>\u0000<img src=x onerror=alert(1)>`;
    const sanitized = sanitizePlainText(malicious);
    expect(sanitized).not.toContain("\u0000");
    expect(looksLikeHtmlPayload(sanitized)).toBe(true);
    expect(escapeHtml(sanitized)).toContain("&lt;script&gt;");
    expect(escapeHtml(sanitized)).not.toContain("<script>");
  });
});
