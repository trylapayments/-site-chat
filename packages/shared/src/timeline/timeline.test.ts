import { describe, expect, it } from "vitest";

import {
  assertSafeTimelineMetadata,
  attachmentUploadedMetadataSchema,
  customerTimelineEventSchema,
  listCustomerTimelineQuerySchema,
  pageViewedMetadataSchema,
} from "../schemas/timeline.js";
import { CUSTOMER_TIMELINE_EVENT_TYPES, CUSTOMER_TIMELINE_METADATA_VERSION } from "./constants.js";
import {
  customerTimelineMessagesEn,
  formatTimelineEventDescription,
  isCustomerTimelineEventType,
} from "./labels.js";
import { mergeTimelineEvents, reconcileTimelineRealtimeInsert } from "./merge.js";
import { decideTimelineCatchUpPage, TIMELINE_CATCH_UP_MAX_PAGES } from "./catch-up.js";
import {
  clampTimelinePageSize,
  compareTimelineOrder,
  isOlderThanTimelineCursor,
  parseTimelineCursor,
} from "./pagination.js";
import type { CustomerTimelineEvent } from "../schemas/timeline.js";

function event(
  partial: Partial<CustomerTimelineEvent> &
    Pick<CustomerTimelineEvent, "id" | "event_type" | "occurred_at">,
): CustomerTimelineEvent {
  return {
    workspace_id: "11111111-1111-4111-8111-111111111111",
    contact_id: "22222222-2222-4222-8222-222222222222",
    visitor_session_id: null,
    conversation_id: null,
    actor_type: "visitor",
    actor_member_id: null,
    metadata_json: { v: CUSTOMER_TIMELINE_METADATA_VERSION },
    created_at: partial.occurred_at,
    ...partial,
  };
}

describe("timeline event taxonomy", () => {
  it("exposes only customer-history event types", () => {
    expect(CUSTOMER_TIMELINE_EVENT_TYPES).toEqual([
      "page_viewed",
      "conversation_started",
      "visitor_message_sent",
      "operator_message_sent",
      "attachment_uploaded",
      "visitor_identified",
      "visitor_profile_updated",
      "conversation_status_changed",
      "conversation_assigned",
      "conversation_transferred",
      "conversation_unassigned",
    ]);
    expect(isCustomerTimelineEventType("typing_started")).toBe(false);
    expect(isCustomerTimelineEventType("page_viewed")).toBe(true);
  });

  it("validates page_viewed metadata", () => {
    const parsed = pageViewedMetadataSchema.safeParse({
      v: 1,
      url: "https://example.com/pricing",
      title: "Pricing",
    });
    expect(parsed.success).toBe(true);
  });

  it("sanitizes attachment filename in metadata schema", () => {
    const parsed = attachmentUploadedMetadataSchema.safeParse({
      v: 1,
      message_id: "33333333-3333-4333-8333-333333333333",
      filename: "../../invoice.pdf",
      kind: "document",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("timeline pagination", () => {
  it("clamps page size", () => {
    expect(clampTimelinePageSize(undefined)).toBe(20);
    expect(clampTimelinePageSize(0)).toBe(1);
    expect(clampTimelinePageSize(100)).toBe(50);
    expect(clampTimelinePageSize(10)).toBe(10);
  });

  it("parses keyset cursors", () => {
    const cursor = parseTimelineCursor({
      occurred_at: "2026-08-11T12:00:00.000Z",
      id: "44444444-4444-4444-8444-444444444444",
    });
    expect(cursor?.id).toBe("44444444-4444-4444-8444-444444444444");
    expect(parseTimelineCursor({ occurred_at: "nope", id: "x" })).toBeNull();
  });

  it("orders newest-first deterministically", () => {
    const a = {
      occurred_at: "2026-08-11T12:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    const b = {
      occurred_at: "2026-08-11T11:00:00.000Z",
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    expect(compareTimelineOrder(a, b)).toBeLessThan(0);
    expect(isOlderThanTimelineCursor(b, a)).toBe(true);
  });

  it("validates list query", () => {
    const ok = listCustomerTimelineQuerySchema.safeParse({
      contact_id: "22222222-2222-4222-8222-222222222222",
      limit: 20,
    });
    expect(ok.success).toBe(true);
  });
});

describe("timeline labels", () => {
  it("formats page views with path only", () => {
    const description = formatTimelineEventDescription(
      {
        event_type: "page_viewed",
        metadata_json: {
          v: 1,
          url: "https://shop.example/pricing?utm_source=x",
        },
      },
      customerTimelineMessagesEn,
    );
    expect(description).toBe("Visited /pricing");
  });

  it("formats safe filenames for attachments", () => {
    const description = formatTimelineEventDescription({
      event_type: "attachment_uploaded",
      metadata_json: {
        v: 1,
        filename: "../../etc/passwd.pdf",
        message_id: "33333333-3333-4333-8333-333333333333",
      },
    });
    expect(description).toBe("Uploaded passwd.pdf");
    expect(description.includes("..")).toBe(false);
  });

  it("formats identity field changes", () => {
    const description = formatTimelineEventDescription({
      event_type: "visitor_profile_updated",
      metadata_json: {
        v: 1,
        changes: [{ field: "email", from: null, to: "jane@example.com" }],
      },
    });
    expect(description).toBe("Email changed to jane@example.com");
  });

  it("does not hardcode labels outside the message catalog", () => {
    expect(customerTimelineMessagesEn.sectionTitle).toBe("Timeline");
    expect(customerTimelineMessagesEn.event.conversation_started).toBe("Started conversation");
  });
});

describe("timeline metadata safety", () => {
  it("rejects secret-bearing keys", () => {
    expect(() => {
      assertSafeTimelineMetadata({
        v: 1,
        continuity_token: "secret",
      });
    }).toThrow(/Forbidden/);
  });

  it("rejects unsanitized URL query secrets", () => {
    expect(() => {
      assertSafeTimelineMetadata({
        v: 1,
        url: "https://example.com/x?token=abc&utm_source=ok",
      });
    }).toThrow(/sanitized/);
  });

  it("allows utm-only URLs", () => {
    expect(() => {
      assertSafeTimelineMetadata({
        v: 1,
        url: "https://example.com/x?utm_source=ok&utm_medium=cpc",
      });
    }).not.toThrow();
  });
});

describe("timeline merge / realtime reconciliation", () => {
  it("dedupes by id and keeps newest-first order", () => {
    const older = event({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      event_type: "page_viewed",
      occurred_at: "2026-08-11T10:00:00.000Z",
      metadata_json: { v: 1, url: "https://example.com/a" },
    });
    const newer = event({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      event_type: "page_viewed",
      occurred_at: "2026-08-11T11:00:00.000Z",
      metadata_json: { v: 1, url: "https://example.com/b" },
    });
    const merged = mergeTimelineEvents([older], [newer, older]);
    expect(merged.map((e) => e.id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]);
  });

  it("ignores realtime events for other contacts", () => {
    const existing = [
      event({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        event_type: "conversation_started",
        occurred_at: "2026-08-11T10:00:00.000Z",
      }),
    ];
    const other = event({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      event_type: "page_viewed",
      occurred_at: "2026-08-11T11:00:00.000Z",
      contact_id: "99999999-9999-4999-8999-999999999999",
      metadata_json: { v: 1, url: "https://example.com" },
    });
    const result = reconcileTimelineRealtimeInsert(
      existing,
      other,
      "22222222-2222-4222-8222-222222222222",
    );
    expect(result).toHaveLength(1);
  });

  it("parses a full event row", () => {
    const parsed = customerTimelineEventSchema.safeParse(
      event({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        event_type: "visitor_message_sent",
        occurred_at: "2026-08-11T10:00:00.000Z",
        metadata_json: {
          v: 1,
          message_id: "33333333-3333-4333-8333-333333333333",
        },
      }),
    );
    expect(parsed.success).toBe(true);
  });
});

describe("timeline reconnect catch-up", () => {
  function pageEvent(index: number, occurredAt: string): CustomerTimelineEvent {
    const id = `${index.toString(16).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
    return event({
      id,
      event_type: "page_viewed",
      occurred_at: occurredAt,
      metadata_json: { v: 1, url: `https://example.com/p/${String(index)}` },
    });
  }

  function lastOf(events: CustomerTimelineEvent[]): CustomerTimelineEvent {
    const last = events.at(-1);
    if (!last) {
      throw new Error("expected non-empty event page");
    }
    return last;
  }

  function firstOf(events: CustomerTimelineEvent[]): CustomerTimelineEvent {
    const first = events[0];
    if (!first) {
      throw new Error("expected non-empty event list");
    }
    return first;
  }

  it("continues paging when the newest page has no overlap", () => {
    const existing = [
      pageEvent(0, "2026-08-11T10:00:00.000Z"),
      pageEvent(1, "2026-08-11T09:00:00.000Z"),
    ];
    const existingIds = new Set(existing.map((e) => e.id));
    const newestPage = Array.from({ length: 20 }, (_, i) =>
      pageEvent(100 + i, `2026-08-11T12:${String(59 - i).padStart(2, "0")}:00.000Z`),
    );
    const cursor = {
      occurred_at: lastOf(newestPage).occurred_at,
      id: lastOf(newestPage).id,
    };

    const decision = decideTimelineCatchUpPage({
      existingIds,
      pageEvents: newestPage,
      hasMore: true,
      nextBefore: cursor,
    });
    expect(decision).toEqual({
      kind: "continue",
      nextBefore: cursor,
    });
  });

  it("completes when a later page overlaps already-loaded events", () => {
    const existing = [
      pageEvent(0, "2026-08-11T10:00:00.000Z"),
      pageEvent(1, "2026-08-11T09:00:00.000Z"),
    ];
    const existingIds = new Set(existing.map((e) => e.id));
    const newestExisting = firstOf(existing);
    const gapPage = [
      ...Array.from({ length: 5 }, (_, i) =>
        pageEvent(50 + i, `2026-08-11T11:${String(10 - i).padStart(2, "0")}:00.000Z`),
      ),
      newestExisting,
    ];

    expect(
      decideTimelineCatchUpPage({
        existingIds,
        pageEvents: gapPage,
        hasMore: true,
        nextBefore: {
          occurred_at: newestExisting.occurred_at,
          id: newestExisting.id,
        },
      }),
    ).toEqual({ kind: "complete", reason: "overlap" });
  });

  it("merges multi-page catch-up without gaps or duplicates", () => {
    const existing = [
      pageEvent(0, "2026-08-11T10:00:00.000Z"),
      pageEvent(1, "2026-08-11T09:00:00.000Z"),
    ];
    const existingIds = new Set(existing.map((e) => e.id));

    // 25 events arrived while disconnected (newer than existing[0]).
    const missed = Array.from({ length: 25 }, (_, i) =>
      pageEvent(200 + i, `2026-08-11T15:${String(59 - i).padStart(2, "0")}:00.000Z`),
    );

    const page1 = missed.slice(0, 20);
    const page2 = [...missed.slice(20), ...existing];
    const page1Cursor = {
      occurred_at: lastOf(page1).occurred_at,
      id: lastOf(page1).id,
    };

    expect(
      decideTimelineCatchUpPage({
        existingIds,
        pageEvents: page1,
        hasMore: true,
        nextBefore: page1Cursor,
      }).kind,
    ).toBe("continue");

    expect(
      decideTimelineCatchUpPage({
        existingIds,
        pageEvents: page2,
        hasMore: false,
        nextBefore: null,
      }),
    ).toEqual({ kind: "complete", reason: "overlap" });

    const merged = mergeTimelineEvents(existing, [...page1, ...page2]);
    expect(merged).toHaveLength(27);
    expect(new Set(merged.map((e) => e.id)).size).toBe(27);
    for (let i = 1; i < merged.length; i += 1) {
      const newer = merged[i - 1];
      const older = merged[i];
      if (!newer || !older) {
        throw new Error("expected adjacent merged events");
      }
      expect(compareTimelineOrder(newer, older)).toBeLessThanOrEqual(0);
    }
    for (const missedEvent of missed) {
      expect(merged.some((e) => e.id === missedEvent.id)).toBe(true);
    }
  });

  it("requests a full reload when history is exhausted without overlap", () => {
    const existingIds = new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(
      decideTimelineCatchUpPage({
        existingIds,
        pageEvents: [pageEvent(9, "2026-08-11T12:00:00.000Z")],
        hasMore: false,
        nextBefore: null,
      }),
    ).toEqual({ kind: "reload", reason: "exhausted-without-overlap" });
  });

  it("exposes a finite catch-up page cap", () => {
    expect(TIMELINE_CATCH_UP_MAX_PAGES).toBeGreaterThanOrEqual(2);
  });
});
