# ADR-003: Visitor Identity Model

**Status:** Accepted  
**Date:** 2026-08-10  
**Deciders:** Site Chat Engineering  
**Supersedes:** None (complements ADR-001)

---

## Context

The widget needs a durable notion of “the same visitor” across browser sessions, host-provided identify calls, and operator profile edits, without building a full CRM. Early schema already had a `contacts` table for identified people and `visitor_sessions` for browser tokens. We needed to decide how anonymous visitors, opaque client ids, custom attributes, and page-view context fit that model—and what not to build yet.

Constraints:

- Workspace isolation remains mandatory (ADR-001)
- Host `window.SiteChat.identify` must not set `workspace_id` / `visitor_id`
- Avoid fingerprinting and raw IP storage by default
- Keep operator inbox updates realtime-friendly

---

## Decision

1. **Contacts are visitor identity.** Keep the table name `contacts`; do not rename to `visitors`. Product copy may say “visitor”; schema and FKs stay `contact_id` / `contacts`.
2. **Sessions remain distinct.** `visitor_sessions` is browser/auth context (token hash, device/page/UTM fields, expiry). A contact may have many sessions over time.
3. **`public_id` is opaque and workspace-scoped.** Format `vis_` + 32 hex; unique per workspace; safe for localStorage; not enumerable; not a global user id.
4. **Attributes live in JSONB with bounds.** `contacts.custom_attributes_json` stores host/operator primitives with max key count, key/value length, and reserved-key rejection. No custom-field admin UI in this phase.
5. **Page views are a separate table.** `visitor_page_views` holds the trail with session FK `ON DELETE CASCADE`, optional `contact_id`, and server-side 30s URL dedupe—not stuffed into session JSON.

Supporting RPCs: `ensure_visitor_contact`, `widget_identify_visitor`, `widget_record_page_view`, `update_visitor_profile`, plus expanded session create/resume.

---

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Rename `contacts` → `visitors` | Large rename churn across FKs, RLS, and docs for little clarity gain; “contact” matches CRM-adjacent future without forcing CRM now |
| Single table for session + identity | Couples token rotation to PII; breaks multi-session history and email merge |
| Sequential or email-derived public ids | Enumerable or PII-leaking; fails opacity requirement |
| EAV custom-fields tables + admin UI | Overbuilt for v1; JSONB bounds are enough for host identify |
| Embed page history in `metadata_json` | Harder to index, dedupe, cascade, and bound independently |

---

## Consequences

### Positive

- Clear mental model: identity vs session vs conversation vs page trail
- Host and widget can resume visitors via `public_id` without fingerprinting
- RLS and email uniqueness stay workspace-local
- Page-view retention can be purged independently later

### Negative

- “Visitor” vs “contact” naming requires documentation discipline
- JSONB attributes defer rich field typing and admin UX
- Email merge logic must be carefully tested (orphan anonymous contacts)

### Follow-ups

- Retention purge jobs (`settings_json.privacy.visitorDataRetentionDays`)
- Export/delete UX
- Optional CRM/company/custom-field expansion (explicit non-goal now)

---

## References

- [VISITOR-IDENTITY.md](../VISITOR-IDENTITY.md)
- [PRIVACY.md](../PRIVACY.md)
- [DATA-RETENTION.md](../DATA-RETENTION.md)
- [DATABASE.md](../DATABASE.md)
- Migration `supabase/migrations/20260810160000_visitor_identity_context.sql`
