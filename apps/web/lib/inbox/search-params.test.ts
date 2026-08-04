import { describe, expect, it } from "vitest";

import {
  formatConversationContactLabel,
  parseInboxListQuery,
} from "@/lib/inbox/search-params";

describe("parseInboxListQuery", () => {
  it("parses inbox filters from search params", () => {
    expect(
      parseInboxListQuery({
        q: "jane",
        page: "2",
        pageSize: "10",
        sort: "-last_message_at",
        status: "open",
        assignment: "assigned_to_me",
      }),
    ).toEqual({
      q: "jane",
      page: 2,
      pageSize: 10,
      sort: "-last_message_at",
      status: "open",
      assignment: "assigned_to_me",
    });
  });
});

describe("formatConversationContactLabel", () => {
  it("prefers contact name", () => {
    expect(
      formatConversationContactLabel({
        name: "Jane",
        email: "jane@example.com",
      }),
    ).toBe("Jane");
  });

  it("falls back to unknown visitor", () => {
    expect(formatConversationContactLabel(null)).toBe("Unknown visitor");
  });
});
