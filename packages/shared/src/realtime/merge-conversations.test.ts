import { describe, expect, it } from "vitest";

import {
  conversationListItemFromChange,
  conversationListItemFromMessage,
} from "./merge-conversations.js";

describe("conversation list stubs from CDC", () => {
  it("builds a list item from a conversation change payload", () => {
    const item = conversationListItemFromChange({
      id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      status: "open",
      assigned_to: null,
      last_message_at: "2026-08-07T12:00:00.000Z",
      last_message_preview: "Hello from visitor",
      message_count: 1,
      updated_at: "2026-08-07T12:00:00.000Z",
    });

    expect(item).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      status: "open",
      channel_type: "widget",
      last_message_preview: "Hello from visitor",
      message_count: 1,
      has_unread: true,
      contact: null,
      assigned_to: null,
    });
  });

  it("builds a list item from the first visitor message insert", () => {
    const item = conversationListItemFromMessage({
      id: "33333333-3333-4333-8333-333333333333",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      conversation_id: "11111111-1111-4111-8111-111111111111",
      sequence_number: 1,
      sender_type: "visitor",
      body: "Hello from visitor e2e",
      is_internal: false,
      created_at: "2026-08-07T12:00:00.000Z",
    });

    expect(item).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      last_message_preview: "Hello from visitor e2e",
      message_count: 1,
      has_unread: true,
      status: "open",
    });
  });
});
