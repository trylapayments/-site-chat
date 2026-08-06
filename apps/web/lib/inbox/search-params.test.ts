import { describe, expect, it } from "vitest";

import {
  formatConversationContactLabel,
  formatRelativeTime,
  INBOX_ACTIVITY_DATE_LOCALE,
  INBOX_ACTIVITY_DATE_TIME_SEPARATOR,
  INBOX_ACTIVITY_DATE_TIME_ZONE,
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

describe("formatRelativeTime", () => {
  it("returns an em dash for null or invalid timestamps", () => {
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("formats a fixed ISO timestamp to an exact deterministic string", () => {
    expect(INBOX_ACTIVITY_DATE_LOCALE).toBe("en-US");
    expect(INBOX_ACTIVITY_DATE_TIME_ZONE).toBe("UTC");
    expect(formatRelativeTime("2024-08-05T22:43:00.000Z")).toBe(
      "Aug 5, 10:43 PM",
    );
  });

  it("joins date and time with our literal comma separator, not Intl glue", () => {
    const formatted = formatRelativeTime("2024-08-05T22:43:00.000Z");

    expect(INBOX_ACTIVITY_DATE_TIME_SEPARATOR).toBe(", ");
    expect(formatted).toContain(INBOX_ACTIVITY_DATE_TIME_SEPARATOR);
    expect(formatted).not.toContain(" at ");
    expect(formatted).toBe(
      `Aug 5${INBOX_ACTIVITY_DATE_TIME_SEPARATOR}10:43 PM`,
    );
  });
});
