import { describe, expect, it } from "vitest";

import {
  formatConversationContactLabel,
  formatRelativeTime,
  INBOX_ACTIVITY_DATE_LOCALE,
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

  it("formats a timestamp identically for SSR and client with fixed locale/timeZone", () => {
    const timestamp = "2024-08-05T18:43:00.000Z";

    // Simulates server and browser both calling the same pure formatter.
    const serverHtml = formatRelativeTime(timestamp);
    const clientHtml = formatRelativeTime(timestamp);

    expect(serverHtml).toBe(clientHtml);
    expect(serverHtml).toBe("Aug 5, 6:43 PM");

    // Pin policy: en-US + UTC (not runtime default locale/timeZone).
    expect(INBOX_ACTIVITY_DATE_LOCALE).toBe("en-US");
    expect(INBOX_ACTIVITY_DATE_TIME_ZONE).toBe("UTC");
    expect(
      new Intl.DateTimeFormat(INBOX_ACTIVITY_DATE_LOCALE, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: INBOX_ACTIVITY_DATE_TIME_ZONE,
      }).format(new Date(timestamp)),
    ).toBe(serverHtml);

    // Confirms we are not using en-GB-style output that caused the mismatch.
    expect(serverHtml).not.toBe(
      new Intl.DateTimeFormat("en-GB", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date(timestamp)),
    );
  });
});
