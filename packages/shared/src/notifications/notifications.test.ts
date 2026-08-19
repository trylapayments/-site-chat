import { describe, expect, it } from "vitest";

import {
  assignmentNotificationDedupeKey,
  conversationNewDedupeKey,
  emailOutboxDedupeKey,
  mentionNotificationDedupeKey,
  unassignNotificationDedupeKey,
  visitorMessageDedupeKey,
} from "./dedupe.js";
import {
  applyUnreadDelta,
  isNotificationUnread,
  notificationHref,
  notificationShouldPlaySound,
  notificationShouldShowBrowser,
} from "./navigation.js";
import { isQuietHoursActive } from "./quiet-hours.js";
import { createNotificationTabElection } from "./tab-election.js";
import {
  notificationItemSchema,
  notificationPreferencesSchema,
  updateNotificationPreferencesSchema,
  viewerMayReceiveNotificationType,
} from "../schemas/notifications.js";

describe("notification dedupe keys", () => {
  it("builds stable mention keys per mention row", () => {
    expect(mentionNotificationDedupeKey("11111111-1111-1111-1111-111111111111")).toBe(
      "mention:11111111-1111-1111-1111-111111111111",
    );
  });

  it("scopes conversation_new per recipient", () => {
    expect(conversationNewDedupeKey("c", "m")).toBe("conversation_new:c:member:m");
  });

  it("uses message id for assigned visitor messages", () => {
    expect(visitorMessageDedupeKey("msg")).toBe("visitor_message:msg");
    expect(visitorMessageDedupeKey("msg", "m")).toBe("visitor_message:msg:member:m");
  });

  it("versions assignment keys", () => {
    expect(assignmentNotificationDedupeKey("c", 3)).toBe("conversation_assigned:c:v3");
    expect(unassignNotificationDedupeKey("c", 4)).toBe("conversation_unassigned:c:v4");
  });

  it("prefixes email outbox keys", () => {
    expect(emailOutboxDedupeKey("mention:abc")).toBe("email:mention:abc");
  });
});

describe("notification mapping / navigation", () => {
  it("maps mention to notes deep link", () => {
    expect(
      notificationHref("acme", {
        type: "mention",
        conversation_id: "11111111-1111-1111-1111-111111111111",
        resource_type: "internal_note",
        resource_id: "22222222-2222-2222-2222-222222222222",
        payload: { note_id: "22222222-2222-2222-2222-222222222222" },
      }),
    ).toBe(
      "/app/acme/inbox/11111111-1111-1111-1111-111111111111?tab=notes&noteId=22222222-2222-2222-2222-222222222222",
    );
  });

  it("maps assignment to conversation thread", () => {
    expect(
      notificationHref("acme", {
        type: "conversation_assigned",
        conversation_id: "11111111-1111-1111-1111-111111111111",
        resource_type: "conversation",
        resource_id: "11111111-1111-1111-1111-111111111111",
        payload: {},
      }),
    ).toBe("/app/acme/inbox/11111111-1111-1111-1111-111111111111");
  });

  it("parses notification items without note bodies", () => {
    const item = notificationItemSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      workspace_id: "22222222-2222-2222-2222-222222222222",
      recipient_id: "33333333-3333-3333-3333-333333333333",
      type: "mention",
      title: "You were mentioned in an internal note",
      body: "Ada mentioned you",
      resource_type: "internal_note",
      resource_id: "44444444-4444-4444-4444-444444444444",
      conversation_id: "55555555-5555-5555-5555-555555555555",
      payload: {
        v: 1,
        note_id: "44444444-4444-4444-4444-444444444444",
        actor_label: "Ada",
      },
      created_at: "2026-08-18T00:00:00.000Z",
      read_at: null,
    });
    expect(item.body).not.toMatch(/secret note/i);
    expect(item.payload.note_id).toBeDefined();
  });
});

describe("unread state helpers", () => {
  it("treats null read_at as unread", () => {
    expect(isNotificationUnread({ read_at: null })).toBe(true);
    expect(isNotificationUnread({ read_at: "2026-08-18T00:00:00.000Z" })).toBe(false);
  });

  it("floors unread deltas at zero", () => {
    expect(applyUnreadDelta(3, -1)).toBe(2);
    expect(applyUnreadDelta(0, -5)).toBe(0);
  });
});

describe("preferences gating", () => {
  it("parses preference patches strictly", () => {
    const parsed = updateNotificationPreferencesSchema.parse({
      sound_enabled: true,
      email_mention: false,
    });
    expect(parsed.sound_enabled).toBe(true);
    expect(() => updateNotificationPreferencesSchema.parse({ unexpected: true })).toThrow();
  });

  it("defaults sound muted in schema shape", () => {
    const prefs = notificationPreferencesSchema.parse({
      id: "11111111-1111-1111-1111-111111111111",
      workspace_id: "22222222-2222-2222-2222-222222222222",
      workspace_member_id: "33333333-3333-3333-3333-333333333333",
      in_app_conversation_new: true,
      in_app_visitor_message: true,
      in_app_assignment: true,
      in_app_mention: true,
      in_app_transfer: true,
      browser_enabled: false,
      browser_conversation_new: true,
      browser_visitor_message: true,
      browser_assignment: true,
      browser_mention: true,
      browser_permission_denied_at: null,
      sound_enabled: false,
      sound_visitor_message: true,
      sound_assignment: true,
      email_conversation_new: true,
      email_assignment: true,
      email_mention: true,
      email_visitor_message: false,
      dnd_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: "UTC",
    });
    expect(prefs.sound_enabled).toBe(false);
    expect(prefs.browser_enabled).toBe(false);
  });

  it("gates sound and browser by type", () => {
    const prefs = {
      sound_enabled: true,
      sound_visitor_message: true,
      sound_assignment: false,
      browser_enabled: true,
      browser_permission_denied_at: null as string | null,
      browser_conversation_new: true,
      browser_visitor_message: false,
      browser_assignment: true,
      browser_mention: true,
    };
    expect(notificationShouldPlaySound("visitor_message", prefs)).toBe(true);
    expect(notificationShouldPlaySound("conversation_assigned", prefs)).toBe(false);
    expect(notificationShouldShowBrowser("visitor_message", prefs)).toBe(false);
    expect(notificationShouldShowBrowser("mention", prefs)).toBe(true);
  });

  it("restricts viewer notification types", () => {
    expect(viewerMayReceiveNotificationType("conversation_new")).toBe(true);
    expect(viewerMayReceiveNotificationType("mention")).toBe(false);
    expect(viewerMayReceiveNotificationType("conversation_assigned")).toBe(false);
  });
});

describe("multi-tab side-effect election", () => {
  it("elects a single leader among two tabs with shared storage", () => {
    const store = new Map<string, string>();
    const memoryStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };

    let clock = 1_000_000;
    const a = createNotificationTabElection("ws", {
      tabId: "a",
      nowFn: () => clock,
      storage: memoryStorage,
    });
    const b = createNotificationTabElection("ws", {
      tabId: "b",
      nowFn: () => clock,
      storage: memoryStorage,
    });

    // Post-write verification: exactly one leader after raced claims.
    expect(a.isLeader() || b.isLeader()).toBe(true);
    expect(a.isLeader() && b.isLeader()).toBe(false);

    const leader = a.isLeader() ? a : b;
    const loser = a.isLeader() ? b : a;
    expect(leader.isLeader()).toBe(true);
    expect(loser.isLeader()).toBe(false);

    // Stale lease → other tab takes over.
    clock += 6_000;
    const takeover = createNotificationTabElection("ws", {
      tabId: "c",
      nowFn: () => clock,
      storage: memoryStorage,
    });
    expect(takeover.isLeader()).toBe(true);

    a.dispose();
    b.dispose();
    takeover.dispose();
  });
});

describe("quiet hours / DND evaluator", () => {
  it("dnd_enabled false → not quiet", () => {
    expect(
      isQuietHoursActive({
        dnd_enabled: false,
        quiet_hours_start: "22:00:00",
        quiet_hours_end: "07:00:00",
        timezone: "UTC",
      }),
    ).toBe(false);
  });

  it("dnd with null window → always quiet", () => {
    expect(
      isQuietHoursActive({
        dnd_enabled: true,
        quiet_hours_start: null,
        quiet_hours_end: null,
        timezone: "UTC",
      }),
    ).toBe(true);
  });

  it("equal start/end → always quiet", () => {
    expect(
      isQuietHoursActive({
        dnd_enabled: true,
        quiet_hours_start: "12:00:00",
        quiet_hours_end: "12:00:00",
        timezone: "UTC",
      }),
    ).toBe(true);
  });

  it("daytime window inside/outside", () => {
    const inside = new Date("2026-08-18T15:30:00.000Z");
    const outside = new Date("2026-08-18T10:00:00.000Z");
    expect(
      isQuietHoursActive(
        {
          dnd_enabled: true,
          quiet_hours_start: "14:00:00",
          quiet_hours_end: "16:00:00",
          timezone: "UTC",
        },
        inside,
      ),
    ).toBe(true);
    expect(
      isQuietHoursActive(
        {
          dnd_enabled: true,
          quiet_hours_start: "14:00:00",
          quiet_hours_end: "16:00:00",
          timezone: "UTC",
        },
        outside,
      ),
    ).toBe(false);
  });

  it("overnight window 22:00→07:00", () => {
    const late = new Date("2026-08-18T23:00:00.000Z");
    const early = new Date("2026-08-18T05:00:00.000Z");
    const midday = new Date("2026-08-18T12:00:00.000Z");
    const prefs = {
      dnd_enabled: true,
      quiet_hours_start: "22:00:00",
      quiet_hours_end: "07:00:00",
      timezone: "UTC",
    };
    expect(isQuietHoursActive(prefs, late)).toBe(true);
    expect(isQuietHoursActive(prefs, early)).toBe(true);
    expect(isQuietHoursActive(prefs, midday)).toBe(false);
  });

  it("timezone conversion America/New_York", () => {
    // 15:00 UTC = 11:00 EDT (UTC-4 in August)
    const utcAfternoon = new Date("2026-08-18T15:00:00.000Z");
    expect(
      isQuietHoursActive(
        {
          dnd_enabled: true,
          quiet_hours_start: "10:00:00",
          quiet_hours_end: "12:00:00",
          timezone: "America/New_York",
        },
        utcAfternoon,
      ),
    ).toBe(true);
    expect(
      isQuietHoursActive(
        {
          dnd_enabled: true,
          quiet_hours_start: "10:00:00",
          quiet_hours_end: "12:00:00",
          timezone: "UTC",
        },
        utcAfternoon,
      ),
    ).toBe(false);
  });
});
