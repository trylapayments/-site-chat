# ADR-004: Durable Customer Timeline Events

**Status:** Accepted  
**Date:** 2026-08-11  
**Deciders:** Site Chat Engineering  
**Supersedes:** None (complements ADR-001, ADR-003)

---

## Context

Operators need a chronological customer history (page views, chat milestones, identity changes, attachments, status/assignment). Future CRM, analytics, AI context, routing, and automation need the same foundation.

Constraints:

- Workspace isolation (ADR-001) and visitor identity model (ADR-003) remain mandatory
- Must not regress URL privacy (sanitized page URLs only)
- Same durable action must not create duplicate history on retry
- Scale assumption: hundreds of thousands of events per workspace; thousands per contact
- Must not turn Timeline into a second copy of the chat transcript

---

## Decision

1. **Durable event store.** Introduce `customer_timeline_events` as the source of truth for customer history. Do not assemble timelines by querying many product tables on every render.
2. **DB-side emission.** Emit from SECURITY DEFINER helpers/triggers inside the same transaction as durable business actions (page views, messages, attachments, conversation lifecycle, identity patches).
3. **Canonical taxonomy in shared code.** Event type strings are a closed set in `@site-chat/shared` and enforced by a DB CHECK constraint. Metadata is compact and versioned (`v`).
4. **Idempotency via `dedupe_key`.** Unique partial index on `(workspace_id, dedupe_key)` with `ON CONFLICT DO NOTHING`.
5. **Keyset pagination.** Order by `(occurred_at DESC, id DESC)`; never OFFSET for large histories.
6. **Realtime on the event table.** Operators subscribe to INSERTs; durable rows remain authoritative for reconnect catch-up.
7. **Cascade strategy.** Contact delete cascades timeline rows; conversation/session delete nulls FKs so contact history can survive conversation purge.

---

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Merge `visitor_page_views` + `messages` + … in app code | N+1, inconsistent privacy, no durable CRM foundation, hard to extend |
| Application-only event writes from Next.js | Retries and multi-path writers duplicate easily; DB is source of truth |
| Store full message bodies in timeline | Duplicates transcript; privacy/retention risk; UI noise |
| OFFSET pagination | Degrades and duplicates/gaps under concurrent inserts |
| Emit noisy transport events | Timeline is product history, not telemetry |

---

## Consequences

### Positive

- Single reusable history for operators and future CRM/AI/analytics
- Idempotent under clientMessageId / attachment retry / page-view dedupe
- Clear privacy boundary (sanitized URLs, no tokens/signed URLs/bodies)
- Indexable, paginated, realtime-friendly

### Negative

- Extra write amplification on durable actions (mitigated by compact rows + targeted triggers)
- Taxonomy changes require migration + shared constant updates
- Historical backfill of pre-v1 activity is out of scope

### Follow-ups

- Retention purge job keyed by `occurred_at` / workspace settings
- Optional conversation-scoped timeline filters in UI
- Operator dashboard i18n for timeline label catalog
- Outbox/webhooks for integrations
