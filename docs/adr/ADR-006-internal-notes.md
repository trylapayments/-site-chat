# ADR-006: Internal Notes as a Dedicated Entity

**Status:** Accepted  
**Date:** 2026-08-13  
**Deciders:** Engineering  

## Context

Operators need private notes on conversations with edit/soft-delete, `@mentions`, durable notifications, Customer Timeline history, realtime catch-up, and search indexing.

The inbox foundation already has `messages.is_internal` (visitor/widget isolation + viewer RLS). Using that flag alone cannot cleanly support soft delete, in-place edits, mention FKs, or `internal_note_*` / `mention_created` timeline taxonomy without overloading the append-only message model.

## Decision

1. **Dedicated `internal_notes` table** (workspace-scoped, soft delete, `client_note_id` idempotency, generated `search_vector`).
2. **`internal_note_mentions`** for structured mention targets (no JSON blobs for member ids).
3. **Minimal `notifications` + `app_notification_type`** so mention delivery is durable now and reusable for Phase 3 notification center.
4. **Keep `messages.is_internal`** as defense-in-depth for visitor/widget paths; do not store product notes as messages.
5. **Timeline events** via existing `emit_customer_timeline_event` with dedupe keys; metadata never includes note body.
6. **Capability `manage_internal_notes`** (owner/admin/agent); viewers excluded at capability, RPC, and RLS layers.
7. **Inbox search** may match note bodies for messaging roles only (viewers excluded).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Store notes as `messages.is_internal = true` | No soft delete/edit/mention FKs; timeline would overload message_sent; inbox preview risk |
| JSON `mentions` on note row | Violates “no JSON blobs for structured data”; weak FK integrity |
| Defer notifications to Phase 3 | Mentions would not be durable; contradicts realtime notify requirement |
| Polling for live notes | Violates realtime architecture; reconnect catch-up already exists for CDC |

## Consequences

- Product notes and chat messages remain separate UX surfaces (Messages / Internal Notes tabs)
- Member removal uses column-specific `ON DELETE SET NULL (author_member_id)` so `workspace_id` remains intact and note history survives (`Former member` label)
- Viewers are excluded from note CRUD and from note/mention timeline events at the database layer (RLS + list RPC)
- Create idempotency is atomic (`client_note_id` + `ON CONFLICT`); mention re-add notifies again (no lifetime unique suppression)
- Concurrent note edits are last-write-wins in v1 (no CAS)
- Reconnect uses authoritative list + tombstones so missed soft-deletes reconcile without inferring deletion from a truncated page
- Phase 3 notification center builds on the same `notifications` table
- Global search (PR #32) can reuse `search_vector` under existing RLS

## References

- `docs/INTERNAL-NOTES.md`
- `docs/CUSTOMER-TIMELINE.md`
- `docs/adr/ADR-004-customer-timeline-events.md`
- Migration `20260813120000_internal_notes.sql`
