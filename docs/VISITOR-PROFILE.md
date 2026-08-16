# Visitor Profile / CRM-lite

**Status:** Implemented (v1) — schema, RPCs, shared schemas, Server Actions, contact UI, CRM settings  
**Last updated:** 2026-08-16

Related: [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md), [CUSTOMER-TIMELINE.md](./CUSTOMER-TIMELINE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [adr/ADR-008-crm-companies-custom-fields.md](./adr/ADR-008-crm-companies-custom-fields.md), [adr/ADR-003-visitor-identity-model.md](./adr/ADR-003-visitor-identity-model.md)

---

## 1. Purpose

Operators need a durable contact profile beyond the lean conversation sidebar: identity fields, tags, an optional company link, and workspace-defined custom fields — without building a full CRM (deals, pipelines, lifecycle stages).

v1 delivers:

- Extended **contact profile** (`job_title`, `locale`, `country_code`, optional `company_id`)
- Workspace **tags** with assign/unassign and soft delete
- First-class **companies** (no auto-merge by email domain)
- **Typed custom fields** (EAV with typed columns; definitions owner/admin only)
- Contacts list with `q` search (FTS + ILIKE) — **search readiness for PR #32**
- Timeline events for profile/tag/company/custom-field mutations
- Operator realtime SELECT on CRM tables; profile live refresh on the contact page
- RBAC via capabilities + SECURITY DEFINER RPCs

Key files:

| Layer | Location |
| ----- | -------- |
| Migration | `supabase/migrations/20260816200000_visitor_profile_crm.sql` |
| Database tests | `supabase/tests/database/018_visitor_profile_crm.test.sql` |
| Shared schemas | `packages/shared/src/schemas/crm.ts` |
| Shared helpers | `packages/shared/src/crm/` |
| Queries/actions | `apps/web/lib/crm/` |
| Realtime | `apps/web/lib/realtime/use-contact-profile.ts` |
| Contact UI | `apps/web/components/crm/`, `apps/web/app/app/[workspaceSlug]/contacts/` |
| Settings UI | `apps/web/components/settings/CrmSettingsManager.tsx` |
| E2E | `e2e/tests/visitor/visitor-profile-crm.spec.ts` |

---

## 2. Profile model

`contacts` remains the visitor identity row (ADR-003). CRM-lite adds operator-editable columns:

| Column | Notes |
| ------ | ----- |
| `company_id` | Optional FK to `companies` (composite with `workspace_id`); cleared on company soft-delete or unlink |
| `job_title` | ≤ 120 chars |
| `locale` | ≤ 35 chars (profile preference, not session language) |
| `country_code` | ISO 3166-1 alpha-2 (`^[A-Z]{2}$`); profile field, distinct from `visitor_sessions.country_code` |
| `search_vector` | Trigger-maintained `tsvector` (name/email/phone/job_title + company name/domain + tag names + custom text/select values) — prep for PR #32 |

Host-supplied `custom_attributes_json` (widget identify) is **unchanged** and separate from CRM custom fields (see ADR-008).

`update_visitor_profile` (conversation sidebar) and `update_contact_profile` (contact page) both accept CRM keys. Neither bumps `last_seen_at`. No-op patches emit **no** timeline events.

---

## 3. Tags

| Table | Role |
| ----- | ---- |
| `contact_tags` | Workspace tag definitions (`name`, `color`, soft `deleted_at`) |
| `contact_tag_assignments` | `(contact_id, tag_id)` join; unique per pair |

- Tag names are unique per workspace among active rows (case-insensitive).
- Assign/unassign are idempotent: re-assigning an existing tag emits **no** timeline event.
- Soft-deleting a tag removes assignments and emits `tag_removed` per contact that had the tag.
- Soft-deleted tags cannot be assigned.

---

## 4. Companies

`companies` is a first-class workspace entity (`name`, optional `domain` / `website` / `industry` / `size`).

- **No automatic merge by domain.** Domain uniqueness among active rows is a conflict guard only — two people at `acme.com` are not auto-linked into one company.
- Contacts link via `company_id` (at most one company per contact in v1).
- Explicit `link_contact_company` / `unlink_contact_company` emit `company_linked` / `company_unlinked`.
- **Soft-delete clears `company_id` on linked contacts without per-contact timeline events** (avoids bulk timeline spam). Operators who need an audit trail should unlink contacts individually first.

See [ADR-008](./adr/ADR-008-crm-companies-custom-fields.md).

---

## 5. Custom fields

| Table | Role |
| ----- | ---- |
| `custom_field_definitions` | Workspace field defs (`key`, `label`, `field_type`, `options_json`, `sort_order`, `is_required`, soft delete) |
| `custom_field_values` | One row per `(contact_id, field_id)` with typed value columns |

Field types (`app_custom_field_type`): `text`, `number`, `boolean`, `date`, `select`.

- Definitions: **owner/admin only** (`manage_crm_definitions`).
- Values: any messaging role (`update_visitor_profile` capability / `require_crm_write_access`).
- Wrong-type writes are rejected with prefixed errors (`INVALID_FIELD_VALUE`, etc.).
- Soft-deleting a definition clears values; emits `custom_field_updated` when a value actually changes.

Host `custom_attributes_json` remains the identify-side bag; CRM fields are operator-curated and typed.

---

## 6. Editing RBAC

| Capability | Roles | Covers |
| ---------- | ----- | ------ |
| `view_contact_profile` | owner, admin, agent, viewer | Read profiles, tags, companies, field defs/values |
| `update_visitor_profile` | owner, admin, agent | Profile fields, tag assign, company link, field **values** |
| `manage_crm_definitions` | owner, admin | Create/update/soft-delete custom field definitions |

RPC gates:

- `require_crm_read_access` — any active member
- `require_crm_write_access` — messaging roles (`require_messaging_role`)
- `require_crm_definitions_manage` — owner/admin only

Viewers see profiles read-only. Agents may edit values but not definitions. Cross-workspace access is denied by workspace membership checks inside every RPC.

Visitors / widget / anon have **no** execute on CRM RPCs and **no** SELECT on CRM definition/value tables beyond what RLS already denies for non-members.

---

## 7. Realtime

CRM tables are in `supabase_realtime` with `REPLICA IDENTITY FULL`:

- `companies`
- `contact_tags`
- `contact_tag_assignments`
- `custom_field_definitions`
- `custom_field_values`

RLS is SELECT-only for `authenticated` via `workspace_is_accessible`. Mutations go through SECURITY DEFINER RPCs. The contact profile page uses live refresh when related rows change.

---

## 8. Search readiness (PR #32)

| Piece | Status |
| ----- | ------ |
| `contacts.search_vector` + GIN | Shipped |
| Company/tag/custom text folded into vector | Shipped (refresh triggers) |
| `list_contacts` `q` filter (FTS + ILIKE fallback) | Shipped |
| Global cross-entity search UI | Deferred to PR #32 |

`list_contacts` supports keyset pagination, optional `company_id` / `tag_id` filters, and `q`. This is the contact-side index operators will reuse when global search lands.

---

## 9. Timeline events

| Event | Emitted when |
| ----- | ------------ |
| `visitor_profile_updated` | Real identity/profile field diffs (sidebar or contact page) |
| `tag_added` / `tag_removed` | Assign / unassign (and tag soft-delete per contact) |
| `company_linked` / `company_unlinked` | Explicit link/unlink or profile `company_id` change — **not** company soft-delete bulk unlink |
| `custom_field_updated` | Value set/clear that actually changes stored data |

No-ops emit nothing. Metadata is compact and secret-free. See [CUSTOMER-TIMELINE.md](./CUSTOMER-TIMELINE.md).

---

## 10. Security

- Every CRM table: `ENABLE` + `FORCE ROW LEVEL SECURITY`
- Policies: `SELECT` for `authenticated` when `workspace_is_accessible(workspace_id)`
- No direct INSERT/UPDATE/DELETE for `authenticated` / `anon`
- Public wrappers: `REVOKE ALL FROM PUBLIC`, deny `anon`, `GRANT EXECUTE TO authenticated`
- After migration, `app_private` EXECUTE is revoked from `PUBLIC`/`anon`/`authenticated`; RLS helpers (`workspace_is_accessible`, etc.) are re-granted
- Prefixed errors (`INVALID_COMPANY_ID`, `COMPANY_NOT_FOUND`, `TAG_NAME_TAKEN`, `FORBIDDEN`, …) for typed client handling

Details: [SECURITY.md](./SECURITY.md).

---

## 11. Performance

- Partial unique indexes on active tag names and company domains
- Trigram GIN on company names; GIN on `contacts.search_vector`
- Assignment and value lookups keyed by `(workspace_id, contact_id)` / `(workspace_id, field_id)`
- Soft-delete company refreshes search vectors for unlinked contacts without emitting N timeline rows
- `list_contacts` uses keyset cursors (no OFFSET)

---

## 12. Public RPCs

| RPC | Access |
| --- | ------ |
| `get_contact_profile` / `list_contacts` / `update_contact_profile` | read / write as above |
| `list_contact_tags` / `create_contact_tag` / `update_contact_tag` / `soft_delete_contact_tag` | write = messaging |
| `assign_contact_tag` / `unassign_contact_tag` | messaging |
| `list_companies` / `get_company` / `create_company` / `update_company` / `soft_delete_company` | write = messaging |
| `link_contact_company` / `unlink_contact_company` | messaging |
| `list_custom_field_definitions` | any member |
| `create_custom_field_definition` / `update_custom_field_definition` / `soft_delete_custom_field_definition` | owner/admin |
| `set_contact_custom_field_value` / `clear_contact_custom_field_value` | messaging |
| `update_visitor_profile` | messaging (CRM keys + legacy identity keys) |

---

## 13. Non-goals (still out of scope)

- Deals, pipelines, lifecycle stages, lead scoring
- Multi-company membership per contact
- Automatic company merge / enrichment by domain
- Marketing automation
- Visitor-facing CRM definitions or values
- Verified identify / cross-customer merge (still ADR-003 future work)

---

## Revision History

| Date | Change |
|------|--------|
| 2026-08-16 | Initial CRM-lite documentation |
