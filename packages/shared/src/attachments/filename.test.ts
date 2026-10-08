import { describe, expect, it } from "vitest";

import {
  buildAttachmentStorageKey,
  contentDispositionAttachment,
  sanitizeAttachmentFilename,
} from "./filename.js";

describe("filename safety", () => {
  it("strips path traversal and control characters", () => {
    expect(sanitizeAttachmentFilename("../x\u0000y.png")).toBe("xy.png");
    expect(sanitizeAttachmentFilename("report<script>.pdf")).toBe("report_script_.pdf");
  });

  it("builds workspace-scoped storage keys without trusting raw names", () => {
    const key = buildAttachmentStorageKey({
      workspaceId: "11111111-1111-1111-1111-111111111111",
      conversationId: "22222222-2222-2222-2222-222222222222",
      attachmentId: "33333333-3333-3333-3333-333333333333",
      filename: "../../evil.png",
    });
    expect(key.startsWith("11111111-1111-1111-1111-111111111111/")).toBe(true);
    expect(key.includes("..")).toBe(false);
    expect(key.endsWith("/evil.png")).toBe(true);
  });

  it("emits safe Content-Disposition values", () => {
    const value = contentDispositionAttachment('quote"name.pdf');
    expect(value.includes("attachment;")).toBe(true);
    expect(value.includes("filename*=")).toBe(true);
    expect(value.includes('"')).toBe(true);
    expect(value.toLowerCase()).not.toContain("inline");
  });
});
