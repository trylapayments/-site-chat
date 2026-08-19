# Site Chat — Widget Studio

**Version:** 1.0  
**Status:** Implemented foundation  
**Last updated:** 2026-08-19

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [WIDGET-I18N.md](./WIDGET-I18N.md), [ADR-009](./adr/ADR-009-widget-studio-draft-publish.md)

---

## 1. Purpose and scope

Widget Studio is the workspace settings surface for configuring the visitor widget without editing code. It provides:

- a strict, versioned appearance/behavior model
- a private editable draft and an independently published production config
- live desktop, tablet, phone, and RTL preview
- typed presets and WCAG-oriented contrast warnings
- private uploads for logos, launcher icons, and agent avatars
- a visitor-safe public configuration endpoint with versioned caching

Widget Studio is not a general theme-code editor. It does not accept arbitrary CSS, JavaScript, font URLs, remote image URLs, routing rules, SLA policies, or a custom widget domain.

---

## 2. Architecture at a glance

```text
Settings UI
    │ authenticated Server Actions + capability checks
    ▼
widget_configs.draft_json
    │ publish_widget_studio() — one atomic row update
    ▼
widget_configs.published_json + published_version
    │ explicit public DTO allowlist + asset URL signing
    ▼
GET /api/v1/widget/config?key=wk_...
    │ ETag / short public cache
    ▼
Embedded visitor widget
```

The dashboard previews `draft_json`. Visitor bootstrap and the standalone config endpoint read only `published_json`. The detailed rationale for keeping both states in one durable row is recorded in [ADR-009](./adr/ADR-009-widget-studio-draft-publish.md).

---

## 3. Typed configuration model

The canonical TypeScript contract is `WidgetAppearanceConfig` in `packages/shared/src/widget-studio/schema.ts`. Both draft and published JSON use the same strict `schemaVersion: 1` shape. Unknown keys are rejected by Zod, and the database validates required fields and key safety again.

| Area | Typed fields and constraints |
|------|------------------------------|
| Colors | `primaryColor`, `accentColor`, `backgroundColor`, `textColor`, `launcherColor`; each is `#RRGGBB` |
| Launcher | allowlisted icon, shape, and size; physical `bottom-left` / `bottom-right`; integer x/y offsets from 0–120 px; optional uploaded launcher asset UUID |
| Chat window | width 300–480 px, height 360–800 px, maximum height 360–900 px (and not below height), radius 0–32 px, allowlisted shadow and density |
| Header and brand | allowlisted header style; localized title/subtitle; optional logo and agent-avatar asset UUIDs |
| Messages | localized welcome and placeholder copy; allowlisted send-button style |
| Typography | allowlisted font family, size scale, and light/dark/system mode; no font URL input |
| Behavior | optional auto-open delay up to 60 seconds; greeting, launcher visibility, avatar, powered-by, sound, and mobile-behavior flags |
| Locale/session | canonical widget locale and conversation reopen window from 1–720 hours |
| Business hours | enabled flag, timezone, up to 21 typed weekly intervals, and optional localized online/offline/away copy |
| Presets | optional informational `presetId`; individual typed fields remain authoritative |

Five presets (`clean`, `minimal`, `modern`, `dark`, and `rounded`) apply allowlisted field patches. A preset is not a free-form style bundle and cannot introduce a field outside the schema.

Contrast checks warn about common low-contrast combinations. They do not silently rewrite customer-selected colors.

For `colorMode: light` and `colorMode: dark`, the widget uses the configured background and text colors unchanged; the dark preset supplies suitable dark values. For `colorMode: system`, configured colors are treated as the light theme. The widget starts with that light theme, listens to `prefers-color-scheme`, and switches background/text to neutral slate/light defaults in dark mode while retaining configured primary, accent, and launcher branding. Preference changes are applied live.

### 3.1 No arbitrary CSS or JavaScript

Arbitrary CSS and JavaScript are deliberately excluded:

- strict schemas reject unknown properties, including `customCss`
- SQL rejects nested `customCss` and `customJS`
- fonts come from an allowlist of embedded/system stacks
- image configuration stores asset UUIDs, not user-supplied URLs

This keeps the public contract serializable and testable, avoids CSS exfiltration and layout-breakage risks, preserves CSP assumptions, and makes old published versions safe for newer widget clients to interpret.

A future Enterprise custom-CSS feature would require a separate security design: isolated and size-bounded input, parsing and sanitization rather than string filtering, CSP compatibility, versioning, failure containment, and an explicit entitlement. The current schema does not reserve or accept such a payload, and no commitment to that feature is implied.

---

## 4. Draft and publish lifecycle

Each workspace has one `widget_configs` row:

- `draft_json` is the latest saved operator editing state
- `published_json` is the production state delivered to visitors
- `published_version` is a positive, monotonic integer
- draft and publish timestamps and actors are recorded separately

The lifecycle is:

1. **Initialize:** migration backfill, or the idempotent lazy initializer, converts allowlisted legacy `settings_json.widget` fields into both draft and published state at version 1.
2. **Edit/preview:** form edits update the local live preview. `Save draft` validates and persists the complete draft. Applying a preset also saves the resulting draft.
3. **Publish:** the UI first saves the current form, then submits the version it displayed as `p_expected_published_version`. `publish_widget_studio` copies draft to published, increments `published_version`, and records publisher/time only when that expected version still matches.
4. **Discard:** copies the published config back into the draft.
5. **Reset:** replaces only the draft with canonical defaults; a separate publish is still required.

Saving or resetting a draft has no visitor-visible effect. A visitor sees the old published state until publish succeeds. Publishing currently increments the version on every successful publish call, including a publish whose content is unchanged.

The current model keeps the latest draft and published snapshot, not a historical revision log. Concurrent draft saves are last-write-wins. Publish uses compare-and-swap (CAS): if another admin published first, the stale publish fails with `PUBLISH_CONFLICT` instead of overwriting the newer publication.

---

## 5. Public configuration boundary

Widget appearance is intentionally visible to visitors, but the visitor receives only an explicit DTO assembled from published state. The public shape includes:

- published `version` and `updatedAt`
- locale and reopen-window values
- typed colors, launcher placement, dimensions, header, typography, behavior, and mobile settings
- localized copy override maps
- business-hours foundation fields
- short-lived signed asset URLs
- `greetingMessage` and `branding` compatibility aliases for older widget clients

It never includes:

- `draft_json`, dirty state, draft timestamps, or draft actor
- raw `settings_json`
- workspace billing, Stripe, AI, privacy, CRM, member, or operator-email data
- service-role or storage credentials
- storage object keys or raw asset metadata rows
- arbitrary unknown JSON keys

The SQL mapper constructs the allowlist explicitly, and the application validates it with `widgetPublicAppearanceSchema`. Entitlement remapping is then applied on every visitor delivery path, including payloads that already match the public schema. Asset enrichment reads published asset IDs separately; it does not trust URLs from stored appearance JSON.

Both `GET /api/v1/widget/bootstrap` and `GET /api/v1/widget/config` resolve the widget public key server-side and require an allowed request origin. Bootstrap also returns an embed token and is `no-store`; the config endpoint returns appearance only and never includes an embed token.

---

## 6. Brand asset rules

`widget_assets` stores workspace-scoped metadata for three kinds:

- `logo`
- `launcher_icon`
- `agent_avatar`

Upload rules are:

| Rule | Value |
|------|-------|
| MIME allowlist | PNG, JPEG, WebP (raster only; SVG is not accepted) |
| Maximum bytes | 512 KiB |
| Dimensions | 16–1024 px for both width and height |
| Filename | sanitized, maximum 128 characters, extension must match declared MIME |
| Upload URL lifetime | 10 minutes |
| Public download URL lifetime | 1 hour |
| Storage | private `widget-assets` bucket under a workspace-prefixed object key |

Upload initiation creates a `pending` metadata row with `verified_at = NULL` and returns a signed upload URL. The `storage_key` is generated server-side, must remain under `workspaces/{workspace_id}/widget-assets/`, and is immutable. Completion downloads the object server-side, verifies exact byte length, detects PNG/JPEG/WebP from content, determines dimensions, and atomically moves the row to `verified` with `verified_at`; invalid objects become `rejected` and are deleted best-effort.

Public enrichment signs only an active `verified` asset with `verified_at` and dimensions in the same workspace whose kind matches the referenced field. Missing, deleted, mismatched, pending, rejected, invalid-path, or inaccessible assets are omitted rather than breaking widget bootstrap.

Authenticated users have SELECT-only table access to `widget_assets`; INSERT/UPDATE/DELETE are closed. Asset Server Actions first enforce `manage_widget_studio`, then use the server-only service role for the narrow lifecycle mutations. The private bucket has no anonymous or authenticated object policy.

Appearance config accepts only asset UUIDs. Arbitrary remote asset URLs are not supported, and legacy `branding.logoUrl` is intentionally ignored during migration. This avoids an SSRF/proxy boundary, persistent third-party tracking URLs, and unreviewed remote content in the widget.

---

## 7. Localization and RTL

Localized fields use:

```json
{
  "useSystemDefaults": true,
  "overrides": {
    "en": "Hi! How can we help?",
    "he": "היי! איך אפשר לעזור?"
  }
}
```

Override keys must be canonical locales from the shared 48-locale widget registry. Resolution is per locale:

1. use the exact active-locale override when present
2. otherwise use the widget’s localized system dictionary

An English override applies only to `en`. It never replaces Hebrew, Arabic, French, or any other locale. Updating the English value merges that key into the override map and preserves existing non-English entries.

The model and public DTO support per-locale overrides for header title, subtitle, welcome message, composer placeholder, and optional business-hours copy. The current Studio UI selects the default locale and exposes English copy editors; it does not yet provide a complete 48-locale override editor. Existing non-English overrides remain part of the durable model and are preserved.

For RTL locales, the visitor widget sets `lang` and `dir="rtl"` and uses logical layout for text and message flow. Launcher position is different by design: `bottom-left` and `bottom-right` are physical site positions and are never mirrored by RTL direction. Studio includes an RTL preview toggle so this behavior can be checked before publishing.

See [WIDGET-I18N.md](./WIDGET-I18N.md) for locale resolution, dictionary provenance, and completeness checks.

---

## 8. Caching and versioning

`published_version` is the cache invalidation token for public appearance. Publish increments it in the same database update that replaces `published_json`.

`GET /api/v1/widget/config?key=<widget-public-key>`:

- returns `Cache-Control: public, max-age=60, stale-while-revalidate=60`
- returns an ETag containing the public key, published version, and a 15-minute signing bucket
- returns `304 Not Modified` when `If-None-Match` equals the current ETag
- is rate-limited through the widget bootstrap bucket
- returns the standard widget API success/error envelope

Draft saves do not change `published_version`. Publish changes both the response version and ETag. The signing bucket changes the ETag before the one-hour signed download URLs can expire, preventing a long-lived `304` from pinning dead URLs. Clients should obtain signed URLs through bootstrap/config rather than persist them as canonical asset locations.

The bootstrap endpoint includes the same ETag for correlation but remains `no-store` because it also returns an embed token.

---

## 9. Capabilities and tenant authorization

Widget Studio uses capability names rather than scattering role checks through UI code:

| Capability | Roles | Effect |
|------------|-------|--------|
| `view_widget_studio` | owner, admin, agent, viewer | Open Studio and inspect its read-only state/preview |
| `manage_widget_studio` | owner, admin | Save, publish, discard, reset, apply presets, and upload brand assets |

The application resolves the workspace from the authenticated caller’s accessible workspace list and URL slug before applying the capability. Database functions independently require workspace access; mutation RPCs require owner/admin. Deactivated or non-member users cannot use those paths.

---

## 10. Studio UI

The Settings → Widget Studio page provides:

- published version and unpublished-change status
- `Save draft`, `Publish`, `Discard draft`, and `Reset to defaults`
- five typed presets
- controls for general/session values, launcher, window dimensions, header, typography, colors, messages, branding, behavior, and mobile behavior
- a disabled **Business hours (foundation)** section that clearly states scheduling is not enforced in the visitor widget
- direct uploads for logo, launcher icon, and agent avatar
- contrast warnings
- sticky live preview with desktop, tablet, phone, and Hebrew RTL modes
- read-only mode for agents and viewers

Publish saves the currently displayed draft before publishing, so unsaved form edits are included. Asset upload updates the local draft selection; the operator must save or publish to retain that reference.

---

## 11. White-label readiness

Widget Studio does not hardcode billing plan names. Shared entitlement features describe behavior (`basic_styling`, `custom_logo`, `hide_powered_by`, `business_hours`, and related capabilities), and `resolveShowPoweredBy` computes effective branding from configuration plus entitlements.

Billing-backed grants are not wired yet. Current defaults grant Studio editing features except `hide_powered_by` and `custom_domain`, so production branding stays fail-closed: published `showPoweredBy=false` is remapped to `true` until billing grants `hide_powered_by`. Future billing integration should supply feature grants to the same abstraction rather than branch on labels such as “Starter” or “Enterprise” in components.

Full white-labeling—custom widget/dashboard domains and broader product rebranding—remains roadmap work. The entitlement seam and asset/config model make that additive; they do not claim that white-label delivery is already implemented.

---

## 12. Business-hours foundation

The config can store:

- an enable flag
- an IANA timezone string
- typed day/start/end intervals
- optional localized online greeting, offline greeting, and away message

The shared `isWithinBusinessHours` helper evaluates an instant against those intervals, using UTC if the timezone is invalid. Disabled hours evaluate as online; enabled hours with no intervals evaluate as offline.

This is a foundation only. The schema and public DTO retain the fields, but Studio presents them as read-only and clearly labels them as not enforced. Widget Studio v1 does not implement conversation routing, operator scheduling, presence changes, queue assignment, auto-replies, SLA timers, or SLA reporting. Those concerns require separate product and data models.

---

## 13. Security and multi-tenant notes

- `widget_configs` and `widget_assets` carry `workspace_id`, use FORCE RLS, and scope authenticated reads to accessible workspaces.
- Draft/publish mutations are authenticated `SECURITY DEFINER` RPCs with locked `search_path`; execute is revoked by default and granted only to `authenticated`.
- The service-role public-key resolver is server-only. Visitors and anonymous clients cannot execute it directly.
- Draft state is never selected by the visitor mapper or application asset-enrichment path.
- Public DTO construction is allowlist-based rather than “remove known secrets.”
- Asset storage is private and has no anon/authenticated object policy; authenticated table writes are closed, and authorized Server Actions use service role for lifecycle mutations.
- Asset object paths are server-generated, workspace-prefixed, and immutable; public signing requires expected kind plus explicit `verified`/`verified_at` state.
- The public config route validates the widget key, request origin/domain, schema, and rate limit before responding.
- Stored copy and filenames remain untrusted text and must be escaped on render; no appearance field accepts executable HTML, CSS, or JavaScript.

Relevant implementation tests cover strict schemas, forbidden public keys, English/non-English override isolation, physical launcher positioning, entitlement behavior, business-hours evaluation, public route ETag/304 behavior, color-mode resolution, and raster asset format/size/dimension validation.
