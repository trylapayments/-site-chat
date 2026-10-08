import { describe, expect, it } from "vitest";

import {
  createUploadBroadcastPayload,
  parseUploadBroadcastPayload,
  UPLOAD_BROADCAST_EVENT,
} from "./upload-events.js";

const batchId = "11111111-1111-1111-1111-111111111111";
const conversationId = "22222222-2222-2222-2222-222222222222";
const uploadId = "33333333-3333-3333-3333-333333333333";
const attachmentId = "44444444-4444-4444-4444-444444444444";
const clientMessageId = "55555555-5555-5555-5555-555555555555";
const messageId = "66666666-6666-6666-6666-666666666666";

describe("upload broadcast payloads", () => {
  it("exports a stable event name", () => {
    expect(UPLOAD_BROADCAST_EVENT).toBe("upload.v1");
  });

  it("createUploadBroadcastPayload stamps v:1 and round-trips through parse", () => {
    const payload = createUploadBroadcastPayload({
      actorRole: "visitor",
      actorKey: "vis_abc",
      state: "started",
      batchId,
      conversationId,
      clientMessageId,
      uploadIds: [uploadId],
      filenames: ["photo.png"],
      kinds: ["image"],
    });

    expect(payload.v).toBe(1);
    expect(parseUploadBroadcastPayload(payload)).toEqual(payload);
  });

  it("parses completed payloads with attachment views", () => {
    const payload = createUploadBroadcastPayload({
      actorRole: "operator",
      actorKey: "op_1",
      state: "completed",
      batchId,
      conversationId,
      messageId,
      attachments: [
        {
          id: attachmentId,
          filename: "doc.pdf",
          mime_type: "application/pdf",
          size_bytes: 2048,
          kind: "document",
          sort_order: 0,
          has_thumbnail: false,
        },
      ],
    });

    const parsed = parseUploadBroadcastPayload(payload);
    expect(parsed?.state).toBe("completed");
    expect(parsed?.attachments?.[0]?.id).toBe(attachmentId);
    expect(parsed?.messageId).toBe(messageId);
  });

  it("returns null for invalid or incomplete payloads", () => {
    expect(parseUploadBroadcastPayload(null)).toBeNull();
    expect(parseUploadBroadcastPayload({})).toBeNull();
    expect(
      parseUploadBroadcastPayload({
        v: 2,
        actorRole: "visitor",
        actorKey: "x",
        state: "started",
        batchId,
        conversationId,
      }),
    ).toBeNull();
    expect(
      parseUploadBroadcastPayload({
        v: 1,
        actorRole: "bot",
        actorKey: "x",
        state: "started",
        batchId,
        conversationId,
      }),
    ).toBeNull();
    expect(
      parseUploadBroadcastPayload({
        v: 1,
        actorRole: "visitor",
        actorKey: "x",
        state: "uploading",
        batchId,
        conversationId,
      }),
    ).toBeNull();
  });

  it("rejects unknown keys via strict schema", () => {
    expect(
      parseUploadBroadcastPayload({
        v: 1,
        actorRole: "visitor",
        actorKey: "x",
        state: "failed",
        batchId,
        conversationId,
        errorCode: "NETWORK",
        extra: true,
      }),
    ).toBeNull();
  });

  it("createUploadBroadcastPayload throws on invalid input", () => {
    expect(() =>
      createUploadBroadcastPayload({
        actorRole: "visitor",
        actorKey: "",
        state: "cancelled",
        batchId,
        conversationId,
      }),
    ).toThrow();
  });
});
