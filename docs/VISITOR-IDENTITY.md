# Site Chat — Visitor Identity + Context

**Version:** 1.0  
**Status:** Foundation  
**Last updated:** 2026-08-10

Related: [PRIVACY.md](./PRIVACY.md), [DATA-RETENTION.md](./DATA-RETENTION.md), [ADR-003](./adr/ADR-003-visitor-identity-model.md), [DATABASE.md](./DATABASE.md), [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Overview

Site Chat separates **who the visitor is** from **which browser session they are in** and **which conversation they are chatting in**. This document describes the identity model shipped as the visitor identity + context foundation.

| Concept | Table | Lifetime | Purpose |
|---------|-------|----------|---------|
| **Visitor (contact)** | `contacts` | Durable, workspace-scoped | Stable identity record (anonymous or identified) |
| **Session** | `visitor_sessions` | Browser-scoped (~30 days TTL) | Auth token, device/page context for one browser |
| **Conversation** | `conversations` | Messaging thread | Open/pending/resolved chat linked to a session (and usually a contact) |
| **Page view** | `visitor_page_views` | Bounded trail | Recent URLs/titles for operator context |

Contacts are the visitor identity. The product language says “visitor”; the schema keeps the table name `contacts` (see ADR-003).

---

## 2. Visitor vs session vs conversation

### 2.1 Contact (visitor identity)

A `contacts` row is the durable visitor record within one workspace:

- Created anonymously on first session when no valid `public_id` is supplied, or when identify/profile flows need a contact.
- May later gain `name`, `email`, `phone` / `phone_e164`, and `custom_attributes_json`.
- Email uniqueness is **per workspace** (`(workspace_id, lower(email))` when email is present).
- `visit_count` increments when a **new** session reuses an existing contact by `public_id`.
- `first_seen_at` / `last_seen_at` track identity lifetime; session `last_seen_at` tracks browser activity.

### 2.2 Session

A `visitor_sessions` row binds one browser (or embed instance) to a hashed session token:

- Token is opaque; only `session_token_hash` is stored.
- Carries page/device/UTM context for the current visit (no raw IP, no raw User-Agent string).
- Optionally links to `contact_id`.
- Expires (default ~30 days from last activity); used by widget APIs for authorization.

### 2.3 Conversation

A conversation is the messaging thread:

- Always tied to a `visitor_session_id`.
- Usually denormalizes `contact_id` for inbox queries.
- Identity/context updates that should refresh the operator UI bump `conversations.updated_at` for open/pending rows (see §6).

```
Host page ──► Widget ──► Session (token)
                              │
                              ├──► Contact (public_id, PII, attributes)
                              │
                              └──► Conversation(s) ──► Messages
                                        │
                                        └── recent page views (via contact or session)
```

---

## 3. Stable `public_id` semantics

| Property | Rule |
|----------|------|
| Format | `vis_` + 32 lowercase hex characters (`^vis_[a-f0-9]{32}$`) |
| Opacity | Cryptographically random (`gen_random_bytes(16)`); not derived from email, IP, or sequence |
| Scope | Unique per `(workspace_id, public_id)`; same visitor in another workspace gets a different id |
| Client use | Safe for widget `localStorage` and host `identify` / init payloads |
| Enumeration | Not guessable; knowing one id does not reveal others |
| Stability | Survives session rotation; new sessions may resume the same contact when a valid `public_id` is presented |
| Not identity alone | Still requires workspace context; never treat as a global user id |

Internal UUID `contacts.id` remains the primary key for FKs. `public_id` is the **client-facing** opaque identifier.

---

## 4. Page-view model and dedupe

### 4.1 Storage

`visitor_page_views` stores a bounded trail:

- Required: `workspace_id`, `visitor_session_id`, `url`
- Optional: `title`, `referrer`, UTM fields, `contact_id`
- Length bounds match session URL/title/UTM limits
- Operators see up to **20** recent views in conversation detail (`VISITOR_RECENT_PAGE_VIEWS_LIMIT`)

Deleting a session **cascades** to its page views. Deleting a contact sets `contact_id` to null on page views (session trail can remain).

### 4.2 Dedupe

| Layer | Behavior |
|-------|----------|
| **Server** | `widget_record_page_view` skips insert when the same session already recorded the **same URL** within the last **30 seconds** (`VISITOR_PAGE_VIEW_DEDUPE_SECONDS`). Response includes `recorded` / `deduped`. |
| **Client** | Widget throttles SPA page-view posts (~**1 second**, `VISITOR_PAGE_VIEW_CLIENT_THROTTLE_MS`) and skips hash-only navigations unless configured otherwise. |

Even when deduped, the RPC still refreshes session `current_url` / `current_title` / `last_seen_at` and may touch open conversations for realtime.

### 4.3 API

- Widget: `POST /api/v1/widget/page-view` (session token) → `widget_record_page_view`
- Privileges: **service_role only** at the database RPC (Route Handler authorizes the session)

---

## 5. Identity update flows

### 5.1 Widget identify

Host or widget supplies name / email / phone / attributes for the current session:

1. Resolve session by token within the workspace.
2. Ensure a contact on the session (create anonymous if needed).
3. If email matches another contact in the same workspace, **merge** into that contact (reassign session + open/pending conversations; orphan anonymous contact may be deleted).
4. Otherwise patch the current contact fields and merge attributes.
5. Touch open/pending conversations so the inbox refreshes.

RPC: `widget_identify_visitor` (service_role). HTTP: `POST /api/v1/widget/identify`.

### 5.2 Operator edit

Dashboard agents update profile from a conversation:

- RPC: `update_visitor_profile(workspace_id, conversation_id, patch)`
- Requires **messaging role** (`owner` / `admin` / `agent`); **viewers are denied**
- Patch may include `name`, `email`, `phone`, `phone_e164` (at least one required)
- Ensures a contact exists on the conversation/session if missing
- Email uniqueness conflicts raise a clear error

### 5.3 Attribute merge rules

`custom_attributes_json` / host `attributes`:

- Object of primitive values only (string, number, boolean); `null` deletes a key
- Max **50** keys; key ≤ 64 chars matching `[a-zA-Z][a-zA-Z0-9_.-]{0,63}`; string values ≤ 500
- Reserved keys rejected (`workspace_id`, `visitor_id`, `public_id`, `__proto__`, etc.)

---

## 6. Realtime flow (sidebar refresh)

Identity and page context should appear in the operator inbox without a full reload:

```
widget identify / page-view / operator profile update
        │
        ▼
UPDATE contacts / visitor_sessions / visitor_page_views
        │
        ▼
touch open|pending conversations.updated_at
        │
        ▼
Supabase Realtime CDC on conversations (inbox channel)
        │
        ▼
Dashboard sidebar / detail re-fetches conversation detail
  (visitor, visitor_context, visitor_activity)
```

`contacts`, `visitor_sessions`, and `visitor_page_views` are also published for CDC where useful; the primary inbox signal remains **conversation `updated_at`**.

---

## 7. Host identify API (v1)

### 7.1 Shape

```js
window.SiteChat.identify({
  name?: string,
  email?: string,
  phone?: string,
  attributes?: Record<string, string | number | boolean | null>,
});
```

### 7.2 Semantics (v1)

| Rule | Detail |
|------|--------|
| Queue until ready | Calls before widget init are queued and flushed after session is ready |
| Workspace scope | Resolved from the embed public key / workspace of the loaded widget — not from caller-supplied workspace ids |
| Cannot set | `visitor_id`, `workspace_id`, `public_id`, `session_id`, or other reserved identity keys via attributes |
| Transport | Loader → iframe / API using the existing session token; server validates origin + session |
| Partial updates | Omitted fields are left unchanged; explicit clearing follows server null rules where supported |

Host pages must not invent or override visitor/workspace identifiers. The durable id returned by init/identify (`visitor_public_id`) is server-issued.

---

## 8. Privacy choices

| Choice | Behavior |
|--------|----------|
| No raw IP | `visitor_sessions` has **no** `ip_address` column; IPs are not persisted by default |
| No fingerprinting | No canvas, audio, WebGL, or cross-site fingerprint libraries |
| No raw User-Agent | Store parsed `browser_family`, `browser_version`, `os_family`, `device_type` only |
| `country_code` | Column reserved for **future trusted platform headers only**; never derive from IP geolocation in this path |
| PII isolation | Contact PII is workspace-scoped; RLS blocks cross-tenant SELECT |
| Page titles/URLs | Treated as untrusted text; sanitized/bounded; rendered safely in the dashboard |

See [PRIVACY.md](./PRIVACY.md) and [DATA-RETENTION.md](./DATA-RETENTION.md).

---

## 9. Non-goals (this foundation)

Out of scope for the identity + context foundation:

- Full CRM (deals, pipelines, lifecycle stages)
- Tags, companies / accounts, assignment notes as CRM objects
- Marketing automation or drip campaigns
- Custom-field admin UI (attributes are host/API-driven JSONB with bounds)
- Precise geolocation or IP-based geo

---

## 10. Future work

- CRM / company / custom-field expansion with admin UI
- Configurable retention via `settings_json.privacy.visitorDataRetentionDays` + purge jobs
- Visitor export / delete workflows aligned with GDPR
- Optional trusted `country_code` from platform edge headers (still no raw IP storage unless explicitly redesigned)

---

## 11. Key RPCs and privileges

| Function | Caller | Notes |
|----------|--------|-------|
| `widget_create_or_resume_visitor_session` | service_role | Creates/resumes session; returns `visitor_public_id` |
| `widget_identify_visitor` | service_role | Host/widget identify |
| `widget_record_page_view` | service_role | Page trail + 30s dedupe |
| `update_visitor_profile` | authenticated | Messaging roles only |
| `app_private.ensure_visitor_contact` | internal | Resolve/create by `public_id` |

---

## Revision History

| Date | Change |
|------|--------|
| 2026-08-10 | Initial visitor identity + context foundation doc |
