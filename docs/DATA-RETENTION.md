# Site Chat — Data Retention (Visitor Identity Context)

**Version:** 1.0  
**Status:** Foundation (architecture; purge jobs future)  
**Last updated:** 2026-08-10

Related: [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md), [PRIVACY.md](./PRIVACY.md), [DATABASE.md](./DATABASE.md)

---

## 1. Goal

Keep visitor **page views**, **sessions**, and **contacts** bounded over time so storage and privacy risk do not grow without limit, while preserving enough context for support quality during an active relationship.

This document describes the **architecture**. Automated purge jobs and settings UI are planned; they are not all required for the identity foundation to ship.

---

## 2. Data classes and intended bounds

| Data | Default intent | Notes |
|------|----------------|-------|
| `visitor_page_views` | Short–medium trail | High volume; primary candidate for aggressive purge |
| `customer_timeline_events` | Align with contact/message retention | Contact delete cascades; conversation delete nulls `conversation_id`; purge-by-`occurred_at` is a future job hook |
| `visitor_sessions` | ~30 days after expiry / inactivity | Token hash + device/page context; hard delete |
| `contacts` | Workspace-configurable (default aligned with message retention, e.g. 12 months) | Keep while conversations may still be needed |
| Conversation messages | Workspace-configurable | Separate from page-view trail; see DATABASE §15 |
| Audit logs | Plan-dependent | Not visitor browsing data |

Operator conversation detail returns at most **20** recent page views regardless of stored history.

---

## 3. Configuration (future)

Retention will be driven by workspace settings:

```json
{
  "privacy": {
    "visitorDataRetentionDays": 365
  }
}
```

Path: `workspaces.settings_json.privacy.visitorDataRetentionDays`.

Semantics (planned):

- Integer days; application-validated range (e.g. minimum floor for abuse investigation, maximum cap for plans)
- Applies to visitor identity context purge (page views first; then eligible sessions/contacts per job rules)
- Missing key → product default (document in release notes when jobs ship)

Schema already reserves this key in DATABASE settings examples.

---

## 4. Purge job (future)

Planned characteristics:

- Runs as cron (Vercel Cron or Supabase scheduled function) with **service role**
- Always filters by `workspace_id`; never cross-tenant bulk without workspace iteration
- Idempotent: safe to retry; logs rows affected
- Order of operations (recommended):
  1. Delete `visitor_page_views` older than retention (or older than session expiry + grace)
  2. Delete expired `visitor_sessions` with no open/pending conversations (page views cascade)
  3. Optionally anonymize or delete `contacts` with no remaining sessions/conversations and `last_seen_at` beyond retention — **only** with explicit product rules so support history is not destroyed unexpectedly

Exact eligibility rules ship with the job implementation and tests.

---

## 5. Cascade behavior (current schema)

Documented so purge and manual deletes stay predictable:

| Parent delete | Child effect |
|---------------|--------------|
| `visitor_sessions` row deleted | `visitor_page_views` for that session **CASCADE** delete; `customer_timeline_events.visitor_session_id` **SET NULL** |
| `contacts` row deleted | `visitor_page_views.contact_id` **SET NULL**; `customer_timeline_events` for that contact **CASCADE** delete; sessions/conversations FKs follow their own `ON DELETE` rules |
| `conversations` row deleted | `customer_timeline_events.conversation_id` **SET NULL** (contact history retained) |
| `workspaces` restricted | Tenant tables use `ON DELETE RESTRICT` on workspace; workspace soft-delete + hard purge is a separate lifecycle |

Application contact delete (when implemented) must respect conversation history product rules and audit logging.

---

## 6. What we do not retain

- Raw IP addresses (intentionally omitted from visitor session schema)
- Raw User-Agent strings (parsed fields only)
- Fingerprinting artifacts

See [PRIVACY.md](./PRIVACY.md).

---

## 7. Export and delete (future)

Aligned with GDPR-oriented controls in SECURITY/PRIVACY:

- Export contacts / conversations (owner/admin)
- Delete contact or workspace with cascading cleanup
- Retention setting changes take effect on subsequent purge runs (not retroactive rewrite of audit logs)

---

## Revision History

| Date | Change |
|------|--------|
| 2026-08-10 | Initial retention architecture for visitor identity context |
