/**
 * Canonical customer timeline event taxonomy (v1).
 *
 * Timeline is customer/product history — not debug telemetry.
 * Do not add transport, typing, receipt, or websocket noise here.
 */

export const CUSTOMER_TIMELINE_METADATA_VERSION = 1 as const;

export const CUSTOMER_TIMELINE_DEFAULT_PAGE_SIZE = 20;
export const CUSTOMER_TIMELINE_MAX_PAGE_SIZE = 50;
export const CUSTOMER_TIMELINE_MIN_PAGE_SIZE = 1;

export const CUSTOMER_TIMELINE_EVENT_TYPES = [
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
  "internal_note_created",
  "internal_note_updated",
  "internal_note_deleted",
  "mention_created",
] as const;

export type CustomerTimelineEventType = (typeof CUSTOMER_TIMELINE_EVENT_TYPES)[number];

export const CUSTOMER_TIMELINE_ACTOR_TYPES = ["visitor", "operator", "system", "host"] as const;

export type CustomerTimelineActorType = (typeof CUSTOMER_TIMELINE_ACTOR_TYPES)[number];

/** Message keys for operator UI descriptions (centralized; not hardcoded in components). */
export const CUSTOMER_TIMELINE_LABEL_KEYS = {
  sectionTitle: "timeline.sectionTitle",
  empty: "timeline.empty",
  loading: "timeline.loading",
  error: "timeline.error",
  retry: "timeline.retry",
  loadOlder: "timeline.loadOlder",
  loadingOlder: "timeline.loadingOlder",
  openConversation: "timeline.openConversation",
  event: {
    page_viewed: "timeline.event.page_viewed",
    conversation_started: "timeline.event.conversation_started",
    visitor_message_sent: "timeline.event.visitor_message_sent",
    operator_message_sent: "timeline.event.operator_message_sent",
    attachment_uploaded: "timeline.event.attachment_uploaded",
    visitor_identified: "timeline.event.visitor_identified",
    visitor_profile_updated: "timeline.event.visitor_profile_updated",
    conversation_status_changed: "timeline.event.conversation_status_changed",
    conversation_assigned: "timeline.event.conversation_assigned",
    conversation_transferred: "timeline.event.conversation_transferred",
    conversation_unassigned: "timeline.event.conversation_unassigned",
    internal_note_created: "timeline.event.internal_note_created",
    internal_note_updated: "timeline.event.internal_note_updated",
    internal_note_deleted: "timeline.event.internal_note_deleted",
    mention_created: "timeline.event.mention_created",
  },
} as const;
