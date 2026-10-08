# ADR-008: CRM Companies and Typed Custom Fields

**Status:** Accepted  
**Date:** 2026-08-16  
**Last updated:** 2026-08-17  
**Deciders:** Engineering

## Context

Visitor identity (ADR-003) gave us durable `contacts` with host `custom_attributes_json` and a lean operator profile edit. Operators still need workspace-curated structure: an optional company/account link, tags, and typed custom fields — without shipping a full CRM.

Two design forks dominate:

1. **Companies:** treat company as a free-text string on the contact, infer it from email domain, or make it a first-class entity.
2. **Custom fields:** store operator fields in the existing host JSONB bag, a single JSONB “CRM attributes” column, or a typed EAV schema.

Wrong choices either lose integrity (typos fork “Acme” / “acme”), silently merge strangers who share a domain, or make filtering/validation impossible.

## Decision

1. **Companies are a first-class table.** `companies` is workspace-scoped with soft delete. Contacts optionally reference one company via `company_id` (composite FK). Domain is optional, lowercased, and unique among **active** rows — uniqueness only, never auto-link or auto-merge. Website is optional http(s) only (shared Zod + DB normalize).
2. **No auto-merge by domain.** Creating or identifying a contact whose email domain matches an existing company does nothing. Operators link explicitly (`link_contact_company` / profile `company_id`). Shared domains (Gmail, agencies, freelancers) make automatic merge hazardous.
3. **Typed custom fields use EAV with typed columns.** `custom_field_definitions` + `custom_field_values` with `app_custom_field_type` (`text` | `number` | `boolean` | `date` | `select`) and dedicated value columns (`value_text`, `value_number`, `value_boolean`, `value_date`). Not a JSON blob per contact. Date values are strict `YYYY-MM-DD` (relative tokens like `today` rejected). `is_required` is stored but not enforced on set/clear in v1 (reserved; Settings UI does not expose it).
4. **Host `custom_attributes_json` stays separate.** Widget/host identify attributes remain the untrusted, bounded JSONB bag from ADR-003. CRM definitions are operator-owned, schema-validated, and never writable from the visitor path.
5. **Soft-delete company / field definition unlinks without timeline spam.** Soft-delete company clears `company_id` on linked contacts and refreshes search vectors, but does **not** emit per-contact `company_unlinked` events. Soft-delete field definition hard-deletes values and refreshes search vectors, but does **not** emit per-contact `custom_field_updated` events. Explicit single-contact unlink / set / clear still emits timeline events.
6. **RPC-only writes; RLS SELECT.** Same pattern as notes/canned: `SECURITY DEFINER` in `app_private`, thin `public` wrappers, `authenticated` execute only, FORCE RLS with SELECT via `workspace_is_accessible`.

## Alternatives considered

| Alternative | Why rejected |
| ----------- | ------------ |
| Free-text `company` on contacts | Typos fork entities; no domain uniqueness, no company list, no contact_count |
| Auto-create/link company from email domain | False merges for shared domains; surprising identity side effects; fights ADR-003 “no silent merge” |
| Store CRM fields in `custom_attributes_json` | Mixes host and operator trust domains; no typed validation; hard to index/filter; visitors could overwrite operator keys |
| Single `crm_attributes jsonb` column | Same integrity problems; CHECK constraints and type coercion become application folklore |
| Pure EAV with one `value text` column | Loses type safety; number/date comparisons and select option checks become stringly typed |
| Emit `company_unlinked` / `custom_field_updated` for every contact on bulk soft-delete | Timeline spam for large accounts; cheap for tiny sets but inconsistent UX — document skip instead |

## Consequences

- Domain uniqueness can reject a second active company with the same domain (`COMPANY_DOMAIN_TAKEN`); that is intentional and is **not** a merge.
- Agents edit field **values**; only owners/admins manage field **definitions** (`manage_crm_definitions`).
- `contacts.search_vector` includes name/email/phone/job_title, company **name and domain**, tag names, and custom text/select/number/date values (+ labels/keys) so `list_contacts` `q` and future PR #32 global search share one index.
- Soft-deleting a company or field definition is quieter on the timeline than mutating contacts one-by-one; product copy should say linked data is cleaned without per-contact history spam.
- Select option shrink captures affected contacts before deleting orphan values so `search_vector` does not retain stale option text.
- Full CRM (deals, pipelines, multi-company membership) remains out of scope. Enforcing `is_required` is future work.

## References

- `docs/VISITOR-PROFILE.md`
- `docs/VISITOR-IDENTITY.md`
- `docs/adr/ADR-003-visitor-identity-model.md`
- `docs/DATABASE.md`
- Migration `20260816200000_visitor_profile_crm.sql`
