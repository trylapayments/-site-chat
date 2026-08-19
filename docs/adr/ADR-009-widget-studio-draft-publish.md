# ADR-009: Widget Studio Draft, Publish, and Versioning

**Status:** Accepted  
**Date:** 2026-08-19  
**Deciders:** Site Chat Engineering  
**Supersedes:** The use of `workspaces.settings_json.widget` as the primary widget appearance store

---

## Context

Widget customization needs two conflicting properties:

1. Operators need to save and preview incomplete work without changing the production widget.
2. Visitor bootstrap needs one small, stable, cacheable configuration that can never include operator-only state.

The legacy model stored a few widget fields under `workspaces.settings_json.widget`. Editing that object directly would either make every save immediately public or require implicit draft conventions inside an unrelated workspace settings bag. It would also make cache invalidation depend on timestamps or JSON hashing and encourage visitor endpoints to pass through broad workspace settings.

Widget Studio adds a larger typed contract, private brand assets, presets, localization overrides, and future entitlement checks. The publication boundary must remain explicit as those capabilities grow.

Multiple owners/admins can keep Studio open concurrently. An atomic publish alone is insufficient if a stale tab can publish after a newer publication without detecting that its displayed production version is obsolete.

---

## Decision

1. **One workspace-scoped row stores both current states.** `widget_configs` has one row per workspace, keyed by `workspace_id`, with `draft_json` and `published_json`. Both use the same strict, schema-versioned `WidgetAppearanceConfig` shape.
2. **Draft is operator state; published is visitor state.** Dashboard reads may return both to authorized workspace members. Visitor resolution selects `published_json` explicitly and maps it into an allowlisted public DTO. Draft is never an input to visitor bootstrap or `/api/v1/widget/config`.
3. **Publish is an atomic copy.** `publish_widget_studio` copies draft to published and updates `published_version`, `published_at`, and `published_by` in one row update. A visitor cannot observe new JSON with an old version or a partially published config.
4. **Published version is monotonic.** It starts at 1 and increments on every successful publish, including a publish with unchanged content. It is the stable cache validator used in the public ETag.
5. **Publish uses version CAS.** The client submits the `published_version` it displayed. The publish update includes that value in its predicate; a mismatch raises `PUBLISH_CONFLICT`, so a stale tab cannot silently publish over a newer publication. Omitting the expected value remains an internal compatibility path, not the Studio UI behavior.
6. **Draft operations do not mutate production.** Save replaces the current draft; discard copies published back to draft; reset replaces draft with canonical defaults. Only publish changes visitor-visible state.
7. **The public shape is a DTO, not stored JSON passthrough.** SQL explicitly constructs visitor fields, application code validates the result, and asset UUIDs are replaced by short-lived signed URLs only after workspace/kind/confirmation checks.
8. **Legacy settings are converted, not kept as the new authority.** Migration backfills active workspaces, and lazy initialization handles missing rows. Only allowlisted legacy widget fields are copied. Legacy remote logo URLs are ignored.
9. **No revision-history table in v1.** The durable state is the latest draft plus latest published snapshot. Draft saves are last-write-wins. Historical rollback, approvals, and named releases require a separate additive design if product requirements justify them.

---

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Continue using `workspaces.settings_json.widget` | Mixes a growing publication lifecycle into a broad settings bag; weak public boundary; difficult independent RLS, actors, and versioning |
| Edit one live config directly | Every save changes production; cannot safely preview incomplete work or provide explicit publish |
| Keep a client-only draft | Draft is lost across browsers/sessions and cannot be reviewed read-only by another workspace member |
| Separate `widget_drafts` and `widget_publications` current-state tables | Adds joins and cross-row transaction invariants without benefit for one current draft and one current publication |
| Append every edit/publish as an immutable revision | Useful for approvals/history but adds retention, cleanup, selection, and rollback semantics not required in v1 |
| Derive ETag from JSON or timestamp | Hashing is unnecessary work and timestamp precision/format is a fragile client contract; a monotonic integer is explicit and cheap |
| Blind atomic publish without expected version | The row update is atomic but a stale admin tab can still publish without noticing a newer production version |
| Return stored published JSON directly | Future internal fields could leak by accident; an explicit DTO allowlist fails closed |
| Normalize every appearance field into columns | Produces a wide, migration-heavy table for a cohesive versioned document; typed Zod/SQL boundaries preserve contract integrity without field-by-field relational queries |

---

## Consequences

### Positive

- Operators can save, preview, discard, and reset without affecting visitors.
- Publish updates config, version, timestamp, and actor atomically.
- Stale publishers receive a typed conflict instead of silently replacing a newer publication.
- Public caching has a deterministic invalidation key.
- Public delivery cannot accidentally expose draft or unrelated workspace settings.
- The JSON schema can evolve through `schemaVersion` while the row lifecycle remains stable.
- Legacy workspaces receive equivalent typed defaults without continuing to depend on the old settings shape.
- Asset signing and future entitlement resolution remain application-layer enrichment, outside durable public JSON.

### Negative

- JSON validation must stay aligned across shared TypeScript and SQL boundaries.
- The current latest-snapshot model provides no built-in publication history or rollback.
- Concurrent draft saves are last-write-wins; there is no draft revision/CAS conflict prompt.
- A publish conflict requires the operator to reload/review the latest production version before retrying.
- Publishing unchanged content still increments the version and invalidates caches.
- Signed asset URLs are ephemeral and must be refreshed through bootstrap/config rather than treated as durable config values.

### Follow-ups

- Billing may provide feature grants to the existing Widget Studio entitlement abstraction; UI and public mapping must continue to avoid hardcoded plan names.
- A future revision-history/approval feature should append immutable publication records without weakening the current explicit published pointer/boundary.
- Any future Enterprise arbitrary-CSS proposal requires a separate sandboxing and security ADR. It must not be added as an unchecked property to the current config.
- Full white-label custom domains and business-hours routing/SLA remain separate roadmap features.

---

## References

- [Widget Studio feature documentation](../WIDGET-STUDIO.md)
- [Architecture](../ARCHITECTURE.md)
- [Database design](../DATABASE.md)
- [Security model](../SECURITY.md)
- Migration `supabase/migrations/20260819120000_widget_studio.sql`
- Shared contract `packages/shared/src/widget-studio/`
- Public route `apps/web/app/api/v1/widget/config/route.ts`
