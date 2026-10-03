import { describe, expect, it } from "vitest";

import {
  formatConversationContactLabel,
  formatInboxDateTime,
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

  it("formats thread message timestamps deterministically (hydration regression)", () => {
    // Matches LiveConversationThread timestamps: en-US + UTC, date/time joined
    // with an app-owned separator — not Intl(undefined) glue ("at" vs ", ").
    expect(formatRelativeTime("2024-08-06T08:55:00.000Z")).toBe(
      "Aug 6, 8:55 AM",
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

describe("formatInboxDateTime", () => {
  it("returns an em dash for null, undefined, or invalid timestamps", () => {
    expect(formatInboxDateTime(null)).toBe("—");
    expect(formatInboxDateTime(undefined)).toBe("—");
    expect(formatInboxDateTime("not-a-date")).toBe("—");
  });

  it("matches the Safari screenshot timestamp byte-for-byte (no Node 'at' glue)", () => {
    // ConversationSidebar MetaRow "Last seen" — Node dateStyle+timeStyle used
    // to emit "Aug 30, 2026 at 2:11 PM"; Safari emitted "Aug 30, 2026, 2:11 PM".
    expect(formatInboxDateTime("2026-08-30T14:11:00.000Z")).toBe(
      "Aug 30, 2026, 2:11 PM",
    );
    expect(formatInboxDateTime("2026-08-30T14:11:00.000Z")).not.toContain(
      " at ",
    );
  });

  it("stays stable regardless of engine dateStyle+timeStyle glue", () => {
    const iso = "2026-08-30T14:11:00.000Z";
    // dateStyle+timeStyle glue varies by ICU (Node may emit "at" or ", ").
    // Our formatter must not depend on that combined call.
    const engineCombined = new Date(iso).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    expect(typeof engineCombined).toBe("string");
    expect(formatInboxDateTime(iso)).toBe("Aug 30, 2026, 2:11 PM");
    expect(formatInboxDateTime(iso)).not.toMatch(/\bat\b/);
  });
});
