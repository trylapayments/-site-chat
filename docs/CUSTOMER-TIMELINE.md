# Customer Timeline

**Version:** 1.0  
**Status:** Implemented (v1)  
**Last updated:** 2026-08-11

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [PRIVACY.md](./PRIVACY.md), [DATA-RETENTION.md](./DATA-RETENTION.md), [adr/ADR-004-customer-timeline-events.md](./adr/ADR-004-customer-timeline-events.md)

---

## 1. Purpose

The Customer Timeline is a durable, workspace-isolated chronological history of **meaningful visitor/customer activity**. It is the reusable event foundation for future CRM, analytics, AI context, routing, automation, integrations, and audit/history views.

Timeline is **customer/product history**, not debug telemetry. It does not record websocket connects, typing, receipts, retries, or internal transport state.

---

## 2. Event model

Durable table: `public.customer_timeline_events`.

| Column | Notes |
|--------|--------|
| `id` | UUID PK |
| `workspace_id` | Tenant scope (required) |
| `contact_id` | Customer identity (required; CASCADE on contact delete) |
| `visitor_session_id` | Nullable; SET NULL on session delete |
| `conversation_id` | Nullable; SET NULL on conversation delete |
| `event_type` | Canonical taxonomy (CHECK constraint) |
| `actor_type` | `visitor` \| `operator` \| `system` \| `host` |
| `actor_member_id` | Nullable operator member |
| `metadata_json` | Compact versioned JSON (`v: 1`); no secrets |
| `occurred_at` | Event time (keyset order) |
| `created_at` | Insert time |
| `dedupe_key` | Nullable; unique per `(workspace_id, dedupe_key)` |

Events are emitted **inside the database** (triggers + SECURITY DEFINER helpers) from durable business actions. Browser-side emission is not used.

---

## 3. Event taxonomy (v1)

Canonical shared constants live in `@site-chat/shared` (`CUSTOMER_TIMELINE_EVENT_TYPES`). Do not scatter arbitrary strings.

| Event | When | Typical metadata |
|-------|------|------------------|
| `page_viewed` | New `visitor_page_views` row (after 30s URL dedupe) | sanitized `url`, `title`, `page_view_id` |
| `conversation_started` | New conversation INSERT | `channel_type` |
| `visitor_message_sent` | Non-internal visitor text message | `message_id`, optional `client_message_id` — **no body** |
| `operator_message_sent` | Non-internal operator text message | same |
| `attachment_uploaded` | First attachment on a message (attachment messages skip message_sent) | safe `filename`, `mime_type`, `kind`, `message_id` |
| `visitor_identified` | Host identify moves anonymous → named/email | `name`/`email`/`phone`, `changes[]` |
| `visitor_profile_updated` | Host/operator profile patch with actual field diffs | `changes[]`, `source` |
| `conversation_status_changed` | Status UPDATE (incl. reopen) | `from_status`, `to_status` |
| `conversation_assigned` | `NULL → member` | from/to member id + safe labels |
| `conversation_transferred` | `member → other member` | from/to member id + safe labels |
| `conversation_unassigned` | `member → NULL` | from member id + safe labels |
| `internal_note_created` | Note create | `note_id`, author labels — **no body** |
| `internal_note_updated` | Note update | `note_id`, author/updater labels — **no body** |
| `internal_note_deleted` | Soft delete | `note_id`, author/deleter labels — **no body** |
| `mention_created` | New mention on a note | `note_id`, mentioned + author labels |
| `tag_added` | Contact tag assigned (new assignment only) | `tag_id`, `tag_name`, `tag_color` |
| `tag_removed` | Contact tag unassigned or removed via tag soft-delete | `tag_id`, `tag_name` |
| `company_linked` | Contact linked to a company (explicit link or profile `company_id`) | `company_id`, `company_name`, `previous_company_id` |
| `company_unlinked` | Contact unlinked from a company (explicit unlink / profile clear) | `previous_company_id` |
| `custom_field_updated` | Custom field value set or cleared with a real change | `field_id`, `key`, `from`, `to` |

Assignment mutations use `take_conversation` / `assign_conversation` / `unassign_conversation` with row-lock + version CAS. No-ops emit nothing. See `docs/CONVERSATION-ASSIGNMENT.md` and ADR-005. Internal notes use dedicated RPCs; see `docs/INTERNAL-NOTES.md` and ADR-006. CRM-lite profile/tag/company/custom-field events: see `docs/VISITOR-PROFILE.md` and ADR-008. **Company soft-delete** clears `company_id` on linked contacts without emitting per-contact `company_unlinked` (bulk unlink; avoids timeline spam).

---

## 4. Dedupe / idempotency

| Source | Mechanism |
|--------|-----------|
| Page views | Existing 30s URL dedupe prevents INSERT → no timeline row |
| Messages | `dedupe_key = message:client:{conversation_id}:{client_message_id}` or `message:{id}` |
| Attachments | `dedupe_key = message:{id}:attachment` (one event per message) |
| Conversation started | `conversation:{id}:started` |
| Identity | Only when name/email/phone **actually change**; no-op patches emit nothing |
| Internal notes | `internal_note:{id}:created` / `:updated:{epoch}` / `:deleted`; mentions `internal_note:{id}:mention_row:{mention_row_id}` (re-add after remove can emit again) |
| Emit helper | `ON CONFLICT (workspace_id, dedupe_key) DO NOTHING` |

Retries of the same durable action must not create duplicate timeline history.

**Viewer isolation:** For `role = viewer`, both direct SELECT / Realtime RLS on `customer_timeline_events` and `list_customer_timeline` exclude `internal_note_created`, `internal_note_updated`, `internal_note_deleted`, and `mention_created`. Owner/admin/agent retain these events. Do not rely on UI filtering.

---

## 5. Pagination

RPC: `list_customer_timeline(p_workspace_id, p_query)`.

- Keyset cursor: `{ occurred_at, id }` with order `occurred_at DESC, id DESC`
- Default limit 20, max 50
- `before` loads older pages without OFFSET
- Response: `{ events, next_before, has_more }`

Indexes:

- `(workspace_id, contact_id, occurred_at DESC, id DESC)` — primary contact timeline
- partial `(workspace_id, conversation_id, occurred_at DESC, id DESC)` — conversation filter

---

## 6. Realtime

- Table is in `supabase_realtime` with `REPLICA IDENTITY FULL`
- Operators subscribe to `INSERT` filtered by `contact_id` (RLS applies)
- On reconnect/`connected`, the UI re-fetches the recent page and merges by id (no duplicates)
- Auth refresh uses the shared operator realtime `setAuth` + resubscribe pattern

No polling.

---

## 7. Privacy rules

Metadata **must never** contain:

- continuity tokens / hashes
- session or auth tokens
- signed upload/download URLs
- message bodies / AI prompts
- secrets or API keys

Page URLs reuse `app_private.sanitize_page_url` / shared `sanitizePageUrl` (origin + path + allowlisted UTMs only).

Filenames are sanitized for display (`sanitizeAttachmentFilename`).

Visitors cannot call `list_customer_timeline` (authenticated members only; anon EXECUTE revoked).

---

## 8. Retention / cascade

| Parent delete | Timeline effect |
|---------------|-----------------|
| `contacts` | `ON DELETE CASCADE` — contact history removed |
| `conversations` | `conversation_id` SET NULL — contact history retained |
| `visitor_sessions` | `visitor_session_id` SET NULL |
| workspace | RESTRICT (workspace deletion is controlled separately) |

Future retention jobs can purge by `occurred_at` / workspace settings without changing the event write path. See `DATA-RETENTION.md`.

---

## 9. Operator UI

Conversation sidebar **Timeline** section:

- newest first
- event type badge + description + timestamp
- load older
- empty / loading / error + retry
- live inserts via realtime
- labels centralized in `@site-chat/shared` (`customerTimelineMessagesEn`) — not hardcoded in components

Operator dashboard i18n is still backlog; timeline strings are already keyed for future locale packs. Widget `i18n:check` is unchanged (timeline is operator-only).

---

## 10. Future extension points

| Consumer | How to extend |
|----------|---------------|
| CRM | Query/filter by `event_type` + metadata; add CRM-specific types carefully |
| Analytics | Aggregate from events; do not join product tables ad hoc for history |
| AI context | Pass bounded recent events as structured context (never raw secrets) |
| Routing / automation | Subscribe to inserts or poll keyset pages by type |
| Integrations | Outbox/webhook from emit helper (future); keep payloads compact |

Do not rebuild Timeline by merging product tables on every render.
