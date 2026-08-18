import { sanitizeAttachmentFilename } from "../attachments/filename.js";
import type { CustomerTimelineEvent } from "../schemas/timeline.js";
import { CUSTOMER_TIMELINE_EVENT_TYPES, type CustomerTimelineEventType } from "./constants.js";

/**
 * English operator strings for timeline UI.
 * Centralized so components never hardcode event labels.
 * Operator dashboard i18n is backlog; when it lands, map these keys per locale.
 */
export const customerTimelineMessagesEn = {
  sectionTitle: "Timeline",
  empty: "No timeline events yet.",
  loading: "Loading timeline…",
  error: "Unable to load timeline.",
  retry: "Retry",
  loadOlder: "Load older",
  loadingOlder: "Loading older…",
  openConversation: "Open conversation",
  event: {
    page_viewed: "Visited {{path}}",
    conversation_started: "Started conversation",
    visitor_message_sent: "Sent a message",
    operator_message_sent: "Operator sent a message",
    attachment_uploaded: "Uploaded {{filename}}",
    visitor_identified: "Visitor identified",
    visitor_profile_updated: "Profile updated",
    conversation_status_changed: "Conversation {{status}}",
    conversation_assigned: "Conversation assigned",
    conversation_assigned_to: "Assigned to {{name}}",
    conversation_transferred: "Transferred from {{from}} to {{to}}",
    conversation_transferred_to: "Transferred to {{name}}",
    conversation_unassigned: "Conversation unassigned",
    internal_note_created: "Internal note added",
    internal_note_updated: "Internal note updated",
    internal_note_deleted: "Internal note deleted",
    mention_created: "Mentioned {{name}}",
    tag_added: "Tag added: {{name}}",
    tag_removed: "Tag removed: {{name}}",
    company_linked: "Company linked",
    company_unlinked: "Company unlinked",
    custom_field_updated: "Custom field updated: {{key}}",
    custom_field_cleared: "Custom field cleared: {{key}}",
    field_name: "Name changed to {{value}}",
    field_email: "Email changed to {{value}}",
    field_phone: "Phone changed to {{value}}",
    field_job_title: "Job title changed to {{value}}",
    field_locale: "Locale changed to {{value}}",
    field_country_code: "Country changed to {{value}}",
    field_name_cleared: "Name cleared",
    field_email_cleared: "Email cleared",
    field_phone_cleared: "Phone cleared",
    field_job_title_cleared: "Job title cleared",
    field_locale_cleared: "Locale cleared",
    field_country_code_cleared: "Country cleared",
    identified_as: "Identified as {{value}}",
  },
} as const;

export type CustomerTimelineMessages = typeof customerTimelineMessagesEn;

function interpolate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = vars[key];
    if (value === null || value === undefined) {
      return "";
    }
    return String(value);
  });
}

function pagePathFromUrl(url: string | null | undefined): string {
  if (!url) {
    return "/";
  }
  try {
    const parsed = new URL(url);
    return parsed.pathname || "/";
  } catch {
    return url.length > 80 ? `${url.slice(0, 77)}…` : url;
  }
}

function safeFilename(raw: string | null | undefined): string {
  if (!raw) {
    return "file";
  }
  return sanitizeAttachmentFilename(raw) || "file";
}

/**
 * Build a concise human-readable description for a timeline event.
 * Never includes secrets, signed URLs, continuity tokens, or message bodies.
 */
export function formatTimelineEventDescription(
  event: Pick<CustomerTimelineEvent, "event_type" | "metadata_json">,
  messages: CustomerTimelineMessages = customerTimelineMessagesEn,
): string {
  const meta = event.metadata_json;

  switch (event.event_type) {
    case "page_viewed": {
      const path = pagePathFromUrl(typeof meta.url === "string" ? meta.url : null);
      return interpolate(messages.event.page_viewed, { path });
    }
    case "conversation_started":
      return messages.event.conversation_started;
    case "visitor_message_sent":
      return messages.event.visitor_message_sent;
    case "operator_message_sent":
      return messages.event.operator_message_sent;
    case "attachment_uploaded": {
      const filename = safeFilename(typeof meta.filename === "string" ? meta.filename : null);
      return interpolate(messages.event.attachment_uploaded, { filename });
    }
    case "visitor_identified": {
      const email = typeof meta.email === "string" ? meta.email : null;
      const name = typeof meta.name === "string" ? meta.name : null;
      const value = email ?? name;
      if (value) {
        return interpolate(messages.event.identified_as, { value });
      }
      return messages.event.visitor_identified;
    }
    case "visitor_profile_updated": {
      const changes = Array.isArray(meta.changes) ? meta.changes : [];
      const parts: string[] = [];
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const record = change as Record<string, unknown>;
        const field = typeof record.field === "string" ? record.field : "";
        const toValue = record.to;
        const to =
          typeof toValue === "string" || typeof toValue === "number" ? String(toValue) : null;
        if (field === "name") {
          parts.push(
            to
              ? interpolate(messages.event.field_name, { value: to })
              : messages.event.field_name_cleared,
          );
        } else if (field === "email") {
          parts.push(
            to
              ? interpolate(messages.event.field_email, { value: to })
              : messages.event.field_email_cleared,
          );
        } else if (field === "phone") {
          parts.push(
            to
              ? interpolate(messages.event.field_phone, { value: to })
              : messages.event.field_phone_cleared,
          );
        } else if (field === "job_title") {
          parts.push(
            to
              ? interpolate(messages.event.field_job_title, { value: to })
              : messages.event.field_job_title_cleared,
          );
        } else if (field === "locale") {
          parts.push(
            to
              ? interpolate(messages.event.field_locale, { value: to })
              : messages.event.field_locale_cleared,
          );
        } else if (field === "country_code") {
          parts.push(
            to
              ? interpolate(messages.event.field_country_code, { value: to })
              : messages.event.field_country_code_cleared,
          );
        }
      }
      if (parts.length > 0) {
        return parts.join(" · ");
      }
      return messages.event.visitor_profile_updated;
    }
    case "tag_added": {
      const name = typeof meta.tag_name === "string" ? meta.tag_name : "tag";
      return interpolate(messages.event.tag_added, { name });
    }
    case "tag_removed": {
      const name = typeof meta.tag_name === "string" ? meta.tag_name : "tag";
      return interpolate(messages.event.tag_removed, { name });
    }
    case "company_linked":
      return messages.event.company_linked;
    case "company_unlinked":
      return messages.event.company_unlinked;
    case "custom_field_updated": {
      const key = typeof meta.key === "string" ? meta.key : "field";
      if (meta.to === null || meta.to === undefined) {
        return interpolate(messages.event.custom_field_cleared, { key });
      }
      return interpolate(messages.event.custom_field_updated, { key });
    }
    case "conversation_status_changed": {
      const to = typeof meta.to_status === "string" ? meta.to_status : "updated";
      return interpolate(messages.event.conversation_status_changed, {
        status: to,
      });
    }
    case "conversation_assigned": {
      const assignee =
        (typeof meta.to_member_label === "string" ? meta.to_member_label : null) ??
        (typeof meta.assignee_label === "string" ? meta.assignee_label : null);
      const assigneeId = meta.to_member_id ?? meta.assignee_member_id;
      if (!assignee && assigneeId == null) {
        return messages.event.conversation_unassigned;
      }
      if (assignee) {
        return interpolate(messages.event.conversation_assigned_to, {
          name: assignee,
        });
      }
      return messages.event.conversation_assigned;
    }
    case "conversation_transferred": {
      const from =
        (typeof meta.from_member_label === "string" ? meta.from_member_label : null) ??
        "previous assignee";
      const to =
        (typeof meta.to_member_label === "string" ? meta.to_member_label : null) ??
        (typeof meta.assignee_label === "string" ? meta.assignee_label : null) ??
        "assignee";
      return interpolate(messages.event.conversation_transferred, { from, to });
    }
    case "conversation_unassigned":
      return messages.event.conversation_unassigned;
    case "internal_note_created":
      return messages.event.internal_note_created;
    case "internal_note_updated":
      return messages.event.internal_note_updated;
    case "internal_note_deleted":
      return messages.event.internal_note_deleted;
    case "mention_created": {
      const name =
        (typeof meta.mentioned_member_label === "string" ? meta.mentioned_member_label : null) ??
        "teammate";
      return interpolate(messages.event.mention_created, { name });
    }
    default: {
      const exhaustive: never = event.event_type;
      return String(exhaustive);
    }
  }
}

export function isCustomerTimelineEventType(value: string): value is CustomerTimelineEventType {
  return (CUSTOMER_TIMELINE_EVENT_TYPES as readonly string[]).includes(value);
}
