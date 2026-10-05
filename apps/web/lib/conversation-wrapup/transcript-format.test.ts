import { describe, it, expect } from "vitest";
import { formatTranscript } from "./transcript-format";
const base = {
  sender_type: "agent",
  body: "Hello",
  is_internal: false,
  created_at: "2026-10-05T10:00:00Z",
  metadata_json: {},
  agent_member_id: "agent-1",
};
describe("customer transcript", () => {
  it("excludes private notes and uses public agent identity", () => {
    const output = formatTranscript(
      "Example",
      [base, { ...base, body: "PRIVATE NOTE", is_internal: true }],
      new Map([["agent-1", "Alice"]]),
    );
    expect(output).toContain("Alice");
    expect(output).toContain("Hello");
    expect(output).not.toContain("PRIVATE NOTE");
  });
  it("includes attachment names without storage keys or signed URLs", () => {
    const output = formatTranscript("Example", [
      {
        ...base,
        metadata_json: {
          attachments: [
            {
              filename: "document.pdf",
              storage_key: "private/path",
              download_url: "https://example.test/private-token",
            },
          ],
        },
      },
    ]);
    expect(output).toContain("Attachment: document.pdf");
    expect(output).not.toContain("private/path");
    expect(output).not.toContain("private-token");
  });
});
