# Site Chat — Database Design

**Version:** 1.1  
**Status:** Foundation  
**Last updated:** 2026-08-17

---

## 1. Overview

Site Chat uses PostgreSQL 15+ hosted on Supabase. The database is the single source of truth for all application state. Supabase Realtime, Storage, and Auth integrate directly with PostgreSQL roles and Row Level Security (RLS).

### 1.1 Design Principles

1. **Every tenant-scoped table has `workspace_id`.** No exceptions.
2. **UUIDs for all primary keys.** Generated via `gen_random_uuid()`; no serial integers exposed externally.
3. **Timestamps on every mutable table.** `created_at` and `updated_at` with automatic trigger-based updates.
4. **Soft delete where recovery is valuable.** Hard delete for ephemeral data (typing events, session tokens).
5. **Append-only audit logs.** No UPDATE or DELETE policies for tenant users on audit tables.
6. **RLS enabled on all tables** except reference/lookup tables with no tenant data.

### 1.2 Schema Conventions

| Convention | Rule |
|------------|------|
| Table names | snake_case, plural (`conversations`) |
| Column names | snake_case (`workspace_id`) |
| Primary keys | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Foreign keys | `{referenced_table_singular}_id` |
| Indexes | `idx_{table}_{columns}` |
| Enums | PostgreSQL native ENUM types, prefixed `app_` |
| JSON columns | `{purpose}_json` or `{purpose}_metadata` |

---

## 2. Entity Relationship Diagram

```
                                    ┌─────────────┐
                                    │    plans    │ (reference)
                                    └──────┬──────┘
                                           │
┌──────────────┐     ┌─────────────────────┴──────────────────────┐
│ auth.users   │     │              workspaces                     │
│ (Supabase)   │     │  id, name, slug, settings_json, status     │
└──────┬───────┘     └───────────────────┬────────────────────────┘
       │                                 │
       │         ┌───────────────────────┼───────────────────────────┐
       │         │                       │                           │
       ▼         ▼                       ▼                           ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐          ┌───────────────┐
│ workspace_   │ │ workspace_   │ │ allowed_     │          │ workspace_    │
│ members      │ │ subscriptions│ │ domains      │          │ settings      │
└──────────────┘ └──────────────┘ └──────────────┘          └───────────────┘

       workspace_id (all below)
       ─────────────────────────

┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ visitor_     │────▶│ contacts     │◀────│ conversations│
│ sessions     │     └──────────────┘     └──────┬───────┘
└──────┬───────┘                                 │
       │                                         ▼
       │                                  ┌──────────────┐
       │                                  │ messages     │
       ▼                                  └──────┬───────┘
┌──────────────┐                                 │
│ visitor_     │                                 ▼
│ page_views   │                          ┌──────────────┐
└──────────────┘                          │ message_     │
                                          │ attachments  │
                                          └──────────────┘

┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ canned_      │  │ notifications│  │ audit_logs   │  │ agent_       │
│ responses    │  │              │  │              │  │ invitations  │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
```

---

## 3. Enum Types

```sql
CREATE TYPE app_workspace_status AS ENUM ('active', 'suspended', 'pending_deletion');
CREATE TYPE app_member_role AS ENUM ('owner', 'admin', 'agent', 'viewer');
CREATE TYPE app_member_status AS ENUM ('active', 'deactivated');
CREATE TYPE app_subscription_status AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'suspended');
CREATE TYPE app_conversation_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE app_message_sender_type AS ENUM ('visitor', 'agent', 'system');
CREATE TYPE app_message_delivery_status AS ENUM ('sent', 'delivered', 'failed');
CREATE TYPE app_notification_type AS ENUM (
  'conversation_new',
  'conversation_assigned',
  'mention',
  'billing_payment_failed',
  'trial_ending'
);
CREATE TYPE app_audit_action AS ENUM (
  'member.invited',
  'member.removed',
  'member.role_changed',
  'widget.settings_updated',
  'domain.added',
  'domain.removed',
  'conversation.exported',
  'contact.exported',
  'billing.plan_changed',
  'auth.login_new_device'
);
CREATE TYPE app_agent_presence AS ENUM ('online', 'away', 'offline');
CREATE TYPE app_device_type AS ENUM ('desktop', 'mobile', 'tablet', 'bot', 'unknown');
```

---

## 4. Reference Tables

### 4.1 plans

Platform-wide plan definitions. Not tenant-scoped; no RLS (read-only for authenticated users).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PK | Slug identifier: `starter`, `team`, `business` |
| name | TEXT | NOT NULL | Display name |
| stripe_price_id | TEXT | NOT NULL | Stripe Price ID (production) |
| stripe_price_id_test | TEXT | NOT NULL | Stripe Price ID (test mode) |
| agent_seats | INTEGER | NOT NULL | Maximum active agents |
| monthly_conversations | INTEGER | NOT NULL | Conversation limit per billing period |
| storage_bytes | BIGINT | NOT NULL | Attachment storage quota |
| audit_log_retention_days | INTEGER | NOT NULL | Audit log retention |
| price_cents | INTEGER | NOT NULL | Monthly price in cents |
| is_active | BOOLEAN | NOT NULL DEFAULT true | Available for new subscriptions |

---

## 5. Core Tenant Tables

### 5.1 workspaces

Top-level tenant entity.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Workspace identifier |
| name | TEXT | NOT NULL | Display name |
| slug | TEXT | NOT NULL, UNIQUE | URL-safe identifier |
| status | app_workspace_status | NOT NULL DEFAULT 'active' | Lifecycle status |
| settings_json | JSONB | NOT NULL DEFAULT '{}' | Widget and workspace settings |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| deleted_at | TIMESTAMPTZ | NULL | Soft delete timestamp |

**Indexes:**
- `idx_workspaces_slug` UNIQUE ON `(slug)` WHERE `deleted_at IS NULL`

**settings_json schema (validated in application):**
```json
{
  "widget": {
    "primaryColor": "#0066FF",
    "position": "bottom-right",
    "greetingMessage": "Hi! How can we help?",
    "offlineMessage": "We're away. Leave a message.",
    "requireEmailBeforeChat": false,
    "reopenWindowHours": 24
  },
  "notifications": {
    "emailOnNewConversation": true
  },
  "privacy": {
    "visitorDataRetentionDays": 365
  }
}
```

### 5.2 workspace_members

Links Supabase Auth users to workspaces with roles.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| user_id | UUID | NOT NULL, FK → auth.users | Supabase Auth user |
| role | app_member_role | NOT NULL DEFAULT 'agent' | Permission level |
| status | app_member_status | NOT NULL DEFAULT 'active' | |
| display_name | TEXT | NULL | Override name shown to visitors |
| presence | app_agent_presence | NOT NULL DEFAULT 'offline' | Current presence |
| last_seen_at | TIMESTAMPTZ | NULL | Last dashboard activity |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_workspace_members_user` ON `(user_id)`
- `idx_workspace_members_workspace` ON `(workspace_id)`
- UNIQUE `(workspace_id, user_id)`

### 5.3 workspace_subscriptions

Mirrors Stripe subscription state for entitlement enforcement.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, UNIQUE, FK → workspaces | One subscription per workspace |
| plan_id | TEXT | NOT NULL, FK → plans | Current plan |
| status | app_subscription_status | NOT NULL | |
| stripe_customer_id | TEXT | NOT NULL | |
| stripe_subscription_id | TEXT | NULL | Null during trial before payment |
| trial_ends_at | TIMESTAMPTZ | NULL | |
| current_period_start | TIMESTAMPTZ | NULL | |
| current_period_end | TIMESTAMPTZ | NULL | |
| conversations_used | INTEGER | NOT NULL DEFAULT 0 | Counter reset each period |
| storage_used_bytes | BIGINT | NOT NULL DEFAULT 0 | Running total |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_workspace_subscriptions_stripe_customer` ON `(stripe_customer_id)`
- `idx_workspace_subscriptions_stripe_subscription` ON `(stripe_subscription_id)`

### 5.4 allowed_domains

Domain allowlist for widget embedding.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| domain | TEXT | NOT NULL | e.g., `example.com`, `*.example.com` |
| verified | BOOLEAN | NOT NULL DEFAULT false | DNS verification (post-MVP; MVP manual) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- UNIQUE `(workspace_id, domain)`

---

## 6. Visitor and Contact Tables

Visitor identity semantics: [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md). Privacy: [PRIVACY.md](./PRIVACY.md). Retention: [DATA-RETENTION.md](./DATA-RETENTION.md).

**Doc/code gap closed:** Session metadata columns documented below match the schema (locale, URLs, UTM, parsed device fields, timezone, language, `last_seen_at`). **Raw IP is intentionally omitted** — there is no `ip_address` / `ip_address_hash` column on `visitor_sessions`. Raw User-Agent is also not stored; only parsed `browser_*` / `os_family` / `device_type`.

**URL storage policy:** `current_url`, `initial_url`, `landing_url`, `referrer` (here), `url` / `referrer` on `visitor_page_views`, and widget-sourced `conversations.source_url` / `conversations.referrer` are all written through the same allowlist sanitizer (`app_private.sanitize_page_url`, mirrored in `packages/shared/src/visitor/page-context.ts`): keep `scheme://host[:port]` + `pathname` + only `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` / `utm_term`; the URL fragment and every other query parameter are stripped before the row is written. See [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md) §5.

### 6.1 visitor_sessions

Browser-scoped visitor session (auth token + page/device context).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | Session identifier |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| contact_id | UUID | NULL, FK → contacts | Linked visitor identity |
| session_token_hash | TEXT | NOT NULL | SHA-256 hash of current token |
| locale | TEXT | NOT NULL DEFAULT `'en'` | Widget UI locale |
| initial_url | TEXT | NULL | First page URL (≤ 2048) |
| current_url | TEXT | NULL | Most recent page URL (≤ 2048) |
| current_title | TEXT | NULL | Most recent page title (≤ 500) |
| landing_url | TEXT | NULL | Landing URL for the session (≤ 2048) |
| referrer | TEXT | NULL | Referrer (≤ 2048) |
| utm_source / utm_medium / utm_campaign / utm_content / utm_term | TEXT | NULL | UTM params (≤ 200 each) |
| browser_family | TEXT | NULL | Parsed browser family (≤ 64); not raw UA |
| browser_version | TEXT | NULL | Parsed browser version (≤ 64) |
| os_family | TEXT | NULL | Parsed OS family (≤ 64) |
| device_type | app_device_type | NULL | `desktop` / `mobile` / `tablet` / `bot` / `unknown` |
| timezone | TEXT | NULL | IANA timezone (≤ 64) |
| language | TEXT | NULL | BCP 47 language tag (≤ 35) |
| country_code | CHAR(2) | NULL | Reserved for future trusted platform headers; never from IP geo |
| active_tab_id | TEXT | NULL | Most recently reported `tab_id` from a page-view POST (≤ 64); `current_url`/`current_title` reflect this tab, not a locked "primary" tab |
| active_tab_seen_at | TIMESTAMPTZ | NULL | Timestamp `active_tab_id` was last reported |
| last_seen_at | TIMESTAMPTZ | NOT NULL | Last **visitor** activity (session create/resume, identify, page view) — never bumped by operator edits |
| expires_at | TIMESTAMPTZ | NOT NULL | Session expiration |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_visitor_sessions_workspace_id` ON `(workspace_id)`
- `idx_visitor_sessions_token_hash` ON `(session_token_hash)` (widget foundation)
- `idx_visitor_sessions_contact_id` ON `(contact_id)` WHERE `contact_id IS NOT NULL`

**Auth token:** `session_token_hash` is a SHA-256 hash of an opaque, randomly generated Bearer token — **not** a JWT; the visitor DB role never receives identity as JWT claims. See [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md) §10.

**Intentionally absent:** `ip_address`, `ip_address_hash`, raw `user_agent`.

### 6.2 contacts

Persistent visitor identity records (anonymous or identified). Table name remains `contacts` (ADR-003).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| public_id | TEXT | NOT NULL, `DEFAULT 'vis_' \|\| encode(gen_random_bytes(16), 'hex')` | Opaque `vis_` + 32 hex; UNIQUE per workspace. **Display/correlation id only — never authorization.** No RPC resolves or binds a session by this value. |
| continuity_token_hash | TEXT | NULL, `CHECK` matches `^[a-f0-9]{64}$` | SHA-256 hex of the opaque continuity credential (`^[a-f0-9]{64}$`). **This — not `public_id` — is the cross-session binder.** Plaintext is returned to the client once (on mint) and never stored server-side. |
| email | TEXT | NULL | Unique per workspace when present (`lower(email)`); unsigned identify enforces this as a write-time conflict, never a merge |
| name | TEXT | NULL | |
| phone | TEXT | NULL | Display phone |
| phone_e164 | TEXT | NULL | Normalized `+digits` (≤ 20) |
| company_id | UUID | NULL | Optional CRM company; composite FK → `companies (id, workspace_id)` `ON DELETE SET NULL`; cleared on company soft-delete |
| job_title | TEXT | NULL | Operator CRM field (≤ 120) |
| locale | TEXT | NULL | Profile locale preference (≤ 35); not session language |
| country_code | CHAR(2) | NULL | ISO 3166-1 alpha-2 profile field (`^[A-Z]{2}$`); distinct from `visitor_sessions.country_code` |
| custom_attributes_json | JSONB | NOT NULL DEFAULT `'{}'` | Host attributes (bounded primitives); **not** CRM custom fields |
| search_vector | TSVECTOR | NULL | Trigger-maintained FTS: name, email, phone, job_title, company **name and domain**, tag names, custom field text/select/number/date values (+ definition labels/keys); reused by `global_search` and `list_contacts` q |
| visit_count | INTEGER | NOT NULL DEFAULT 1 | Increments only when a **new** session links to this contact via a valid `continuity_token` (≥ 1) |
| first_seen_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| last_seen_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Visitor activity only — `update_visitor_profile` / `update_contact_profile` do **not** bump this |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `uq_contacts_workspace_public_id` UNIQUE ON `(workspace_id, public_id)`
- `uq_contacts_workspace_continuity_token_hash` UNIQUE ON `(workspace_id, continuity_token_hash)` WHERE `continuity_token_hash IS NOT NULL`
- `idx_contacts_workspace_email` UNIQUE ON `(workspace_id, lower(email))` WHERE `email IS NOT NULL`
- `idx_contacts_workspace_name` ON `(workspace_id, name)`
- `idx_contacts_workspace_company` ON `(workspace_id, company_id)` WHERE `company_id IS NOT NULL`
- `idx_contacts_job_title` ON `(workspace_id, job_title)` WHERE `job_title IS NOT NULL`
- `idx_contacts_search_vector` GIN ON `(search_vector)`

CRM-lite tables (`companies`, `contact_tags`, `contact_tag_assignments`, `custom_field_definitions`, `custom_field_values`) and RPCs: see [VISITOR-PROFILE.md](./VISITOR-PROFILE.md) and §6.5 below.

### 6.3 visitor_page_views

Bounded page-view trail for operator context.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| visitor_session_id | UUID | NOT NULL | Composite FK → visitor_sessions `(id, workspace_id)` **ON DELETE CASCADE** |
| contact_id | UUID | NULL | Composite FK → contacts; **ON DELETE SET NULL** |
| url | TEXT | NOT NULL | Page URL (1–2048), sanitized to origin + path + allowlisted UTM (see URL storage policy above) |
| title | TEXT | NULL | ≤ 500 |
| referrer | TEXT | NULL | ≤ 2048, sanitized the same way as `url` |
| utm_* | TEXT | NULL | ≤ 200 each |
| tab_id | TEXT | NULL | ≤ 64; client-generated tab activity id (`sessionStorage`); distinguishes concurrent tabs in one session |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_visitor_page_views_contact_created` ON `(workspace_id, contact_id, created_at DESC)`
- `idx_visitor_page_views_session_created` ON `(visitor_session_id, created_at DESC)`
- `idx_visitor_page_views_session_url_created` ON `(visitor_session_id, url, created_at DESC)` (dedupe lookup)

**RLS:** Authenticated SELECT when `workspace_is_accessible`; no INSERT/UPDATE/DELETE for `authenticated` (writes via service-role RPCs).

**Dedupe:** `widget_record_page_view` skips insert when the same session+URL was recorded within 30 seconds.

### 6.4 customer_timeline_events

Durable customer/product history for operator Timeline and future CRM/AI/analytics. See [CUSTOMER-TIMELINE.md](./CUSTOMER-TIMELINE.md) and [ADR-004](./adr/ADR-004-customer-timeline-events.md).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces RESTRICT | Tenant scope |
| contact_id | UUID | NOT NULL | Composite FK → contacts **ON DELETE CASCADE** |
| visitor_session_id | UUID | NULL | Composite FK → sessions **ON DELETE SET NULL** |
| conversation_id | UUID | NULL | Composite FK → conversations **ON DELETE SET NULL** |
| event_type | TEXT | NOT NULL, CHECK taxonomy | Canonical event name |
| actor_type | TEXT | NOT NULL, CHECK | `visitor` \| `operator` \| `system` \| `host` |
| actor_member_id | UUID | NULL | Operator member when applicable |
| metadata_json | JSONB | NOT NULL DEFAULT `{"v":1}` | Compact versioned payload; no secrets |
| occurred_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | Event time (keyset order) |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| dedupe_key | TEXT | NULL, ≤ 256 | Idempotency key |

**Indexes:**
- `idx_customer_timeline_events_contact_occurred` ON `(workspace_id, contact_id, occurred_at DESC, id DESC)`
- `idx_customer_timeline_events_conversation_occurred` (partial) ON `(workspace_id, conversation_id, occurred_at DESC, id DESC)`
- `uq_customer_timeline_events_dedupe` UNIQUE (partial) ON `(workspace_id, dedupe_key)` WHERE `dedupe_key IS NOT NULL`

**RLS:** Authenticated SELECT when `workspace_is_accessible`; no direct writes for `authenticated`/`anon`. Writes via `app_private.emit_customer_timeline_event` from triggers/RPCs.

**Query plan rationale:** Contact timeline lookups use the composite `(workspace_id, contact_id, occurred_at DESC, id DESC)` index for keyset pagination (`WHERE … AND (occurred_at, id) < (cursor)`). Bounded `LIMIT` (≤ 50) keeps result size fixed. Conversation-scoped filters use the partial conversation index. Avoid OFFSET.

**RPC:** `list_customer_timeline(p_workspace_id, p_query jsonb)` — membership via `workspace_is_accessible`; visitors/anon cannot execute.

**Assignment event types (v1):** `conversation_assigned`, `conversation_transferred`, `conversation_unassigned` — see `docs/CONVERSATION-ASSIGNMENT.md`.

**CRM-lite event types (v1):** `tag_added`, `tag_removed`, `company_linked`, `company_unlinked`, `custom_field_updated` (plus existing `visitor_profile_updated`) — see `docs/VISITOR-PROFILE.md`. Company soft-delete unlinks contacts without per-contact `company_unlinked` events. Soft-deleting a custom field definition hard-deletes values and refreshes `search_vector` without per-contact `custom_field_updated` events.

### 6.5 CRM-lite (companies, tags, custom fields)

See [VISITOR-PROFILE.md](./VISITOR-PROFILE.md) and [ADR-008](./adr/ADR-008-crm-companies-custom-fields.md). Migration: `20260816200000_visitor_profile_crm.sql`.

| Table | Purpose | Soft delete | Notable indexes |
|-------|---------|-------------|-----------------|
| `companies` | Workspace accounts | `deleted_at` | active name; unique `(workspace_id, domain)` WHERE active + domain set; name trigram |
| `contact_tags` | Tag definitions | `deleted_at` | unique lower(name) among active |
| `contact_tag_assignments` | Contact ↔ tag | hard delete on unassign | unique `(workspace_id, contact_id, tag_id)` |
| `custom_field_definitions` | Typed field defs (`app_custom_field_type`); `is_required` stored but not enforced in v1 | `deleted_at` | unique `(workspace_id, key)` among active |
| `custom_field_values` | Typed EAV values; date = strict `YYYY-MM-DD` (no `today`/`tomorrow`) | hard delete on clear / definition soft-delete | `(workspace_id, contact_id)`, `(workspace_id, field_id)` |

**RPCs / pagination:** `list_contacts` and `list_companies` use keyset cursors (`before` → `next_before` / `has_more`); contacts UI ships **Load more** (no OFFSET). `list_companies` accepts `q` for picker search (ILIKE substring on name/domain; no trigram). Company `website` is http(s) only (shared Zod + DB normalize). Tag assign is idempotent (`ON CONFLICT DO NOTHING`). Select option shrink captures affected contact ids before deleting orphan values, then refreshes `search_vector`. Combined label+options definition updates refresh orphans ∪ keepers once. `update_company` refreshes linked contacts when **name or domain** changes (both indexed into `search_vector`). Settings tag / custom-field definition lists remain single-page (MEDIUM follow-up for pagination/search at scale).

**RLS:** All five tables `ENABLE` + `FORCE ROW LEVEL SECURITY`; `SELECT` for `authenticated` when `workspace_is_accessible(workspace_id)`; no direct writes. Mutations via SECURITY DEFINER RPCs (`get_contact_profile`, `list_contacts`, `update_contact_profile`, tag/company/custom-field CRUD, `update_visitor_profile` with CRM keys).

**Realtime:** All five tables in `supabase_realtime` with `REPLICA IDENTITY FULL`.

---

## 7. Conversation Tables

### 7.1 conversations

Message threads between visitors and agents.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| visitor_session_id | UUID | NOT NULL, FK → visitor_sessions | |
| contact_id | UUID | NULL, FK → contacts | Denormalized for query performance |
| assigned_to | UUID | NULL, FK → workspace_members | Current assignee (`NULL` = unassigned queue) |
| assigned_at | TIMESTAMPTZ | NULL | When current assignee was set |
| assigned_by_member_id | UUID | NULL, FK → workspace_members | Member who performed current assignment |
| assignment_version | BIGINT | NOT NULL DEFAULT 0 | Monotonic CAS revision for concurrent Take/Assign |
| status | app_conversation_status | NOT NULL DEFAULT 'open' | |
| subject | TEXT | NULL | Optional subject line |
| source_url | TEXT | NULL | URL where conversation started (sanitized; origin + path + allowlisted UTM only) |
| referrer | TEXT | NULL | Sanitized the same way as `source_url` |
| message_count | INTEGER | NOT NULL DEFAULT 0 | Denormalized counter |
| last_message_at | TIMESTAMPTZ | NULL | For inbox sorting |
| last_message_preview | TEXT | NULL | First 200 chars of last message |
| search_vector | TSVECTOR | NULL | Trigger-maintained FTS over conversation id, contact identity, subject, `sanitize_page_url(source_url)`, preview (**no assignee label**; secrets stripped on every refresh) |
| resolved_at | TIMESTAMPTZ | NULL | |
| resolved_by | UUID | NULL, FK → workspace_members | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_conversations_inbox` ON `(workspace_id, status, last_message_at DESC NULLS LAST)`
- `idx_conversations_assigned` ON `(workspace_id, assigned_to, status)` WHERE `assigned_to IS NOT NULL`
- `idx_conversations_assignee_activity` ON `(workspace_id, assigned_to, last_message_at DESC NULLS LAST)` WHERE `assigned_to IS NOT NULL`
- `idx_conversations_unassigned_queue` ON `(workspace_id, status, last_message_at DESC NULLS LAST)` WHERE `assigned_to IS NULL`
- `idx_conversations_visitor_session` ON `(visitor_session_id)`
- `idx_conversations_contact` ON `(contact_id)` WHERE `contact_id IS NOT NULL`
- `idx_conversations_search_vector` GIN ON `(search_vector)`
- `idx_conversations_source_url_trgm` / `idx_conversations_preview_trgm` GIN trigram (partial)

**Assignment RPCs** (see `docs/CONVERSATION-ASSIGNMENT.md`): `take_conversation`, `assign_conversation`, `unassign_conversation`. Mutations use row lock + `assignment_version` CAS and never bump `last_message_at`.

**Global search:** `conversations.search_vector` is refreshed on conversation metadata changes and when linked contact name/email/phone/`public_id` updates. See `docs/GLOBAL-SEARCH.md`.

### 7.2 messages

Individual messages within a conversation.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | Denormalized for RLS |
| conversation_id | UUID | NOT NULL, FK → conversations | |
| sequence_number | BIGINT | NOT NULL | Per-conversation ordering |
| sender_type | app_message_sender_type | NOT NULL | |
| sender_id | UUID | NULL | workspace_member.id or visitor_session.id |
| body | TEXT | NOT NULL | Plain text content |
| search_vector | TSVECTOR | GENERATED | `to_tsvector('english', body)` STORED; GIN for global search |
| is_internal | BOOLEAN | NOT NULL DEFAULT false | Defense-in-depth flag; product internal notes live in `internal_notes` |
| delivery_status | app_message_delivery_status | NOT NULL DEFAULT 'sent' | |
| client_message_id | UUID | NULL | Client deduplication key |
| metadata_json | JSONB | NOT NULL DEFAULT '{}' | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- UNIQUE `(conversation_id, sequence_number)`
- UNIQUE `(conversation_id, client_message_id)` WHERE `client_message_id IS NOT NULL`
- `idx_messages_conversation` ON `(conversation_id, sequence_number)`
- `idx_messages_workspace_search_vector` GIN ON `(workspace_id, search_vector)` — workspace-scoped FTS for global search
- `idx_messages_body_trgm` GIN trigram on `body`
- `idx_messages_workspace_created` ON `(workspace_id, created_at DESC, id DESC)`

**Triggers:**
- `trg_messages_update_conversation` — on INSERT, increment `conversations.message_count`, update `last_message_at` and `last_message_preview`.
- `trg_messages_increment_usage` — on INSERT where `sender_type = 'visitor'` and conversation is new, increment `workspace_subscriptions.conversations_used`.

### 7.2.1 internal_notes

Operator-only private notes on conversations. See `docs/INTERNAL-NOTES.md` and ADR-006.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| conversation_id | UUID | NOT NULL | Composite FK with workspace |
| author_member_id | UUID | NULL, FK → workspace_members | Composite FK `ON DELETE SET NULL (author_member_id)` so `workspace_id` stays intact |
| body | TEXT | NOT NULL, 1–4000 | |
| client_note_id | UUID | NULL | Create idempotency via atomic `INSERT … ON CONFLICT` |
| search_vector | TSVECTOR | GENERATED | GIN-indexed for global search / inbox note `q` |
| created_at / updated_at | TIMESTAMPTZ | NOT NULL | |
| deleted_at | TIMESTAMPTZ | NULL | Soft delete; catch-up returns watermarked tombstones |

**Related:** `internal_note_mentions (note_id, mentioned_member_id)` unique; messaging-role targets only; edit replaces the mention set (no sticky union).

**RPCs:** `list_internal_notes` (supports `authoritative` + `catch_up_since` for bounded `tombstones`, returns `server_watermark` DB cursor), `create_internal_note` (lifetime-unique `client_note_id`; soft-deleted conflict → `NOTE_DELETED`), `update_internal_note` (no-op when body + mentions unchanged; concurrent edits are LWW), `soft_delete_internal_note`, `get_internal_note`.

**Indexes (notes):** conversation created (active), workspace updated (active), search GIN (active), author (active), **tombstones** `(workspace_id, conversation_id, updated_at DESC, id DESC) WHERE deleted_at IS NOT NULL`.

**RLS:** SELECT for owner/admin/agent only. No direct writes. Visitors/viewers have no access. Note/mention timeline events are hidden from viewers (RLS + list RPC).

**Search:** `list_conversations` `q` matches note bodies/FTS for messaging roles only (never viewers). `global_search` reuses the same vector and excludes soft-deleted notes; viewers get empty notes groups (`can_search_notes = false`).

### 7.3 message_attachments

File metadata linked to messages. See `docs/ATTACHMENTS.md` for upload flow and security.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| message_id | UUID | NOT NULL, FK → messages | |
| conversation_id | UUID | NOT NULL, FK → conversations | Denormalized |
| storage_key | TEXT | NOT NULL, UNIQUE | Path in object storage |
| thumbnail_storage_key | TEXT | NULL | Optional derived thumbnail key |
| filename | TEXT | NOT NULL | Sanitized original filename |
| mime_type | TEXT | NOT NULL | Validated MIME type |
| size_bytes | BIGINT | NOT NULL | |
| kind | app_attachment_kind | NOT NULL | `image` or `document` |
| width | INTEGER | NULL | Image width px |
| height | INTEGER | NULL | Image height px |
| duration_ms | INTEGER | NULL | Reserved for future media |
| scan_status | app_attachment_scan_status | NOT NULL | Antivirus seam |
| sort_order | INTEGER | NOT NULL DEFAULT 0 | Preserve multi-file order |
| metadata_json | JSONB | NOT NULL DEFAULT `{}` | Extensible metadata |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_message_attachments_message` ON `(message_id)`
- `idx_message_attachments_conversation` ON `(conversation_id)`
- `idx_message_attachments_workspace` ON `(workspace_id)`
- `idx_message_attachments_message_sort` ON `(message_id, sort_order)`
- `idx_message_attachments_filename_trgm` GIN trigram on `filename` (global search)
- `idx_message_attachments_workspace_filename` ON `(workspace_id, lower(filename))`
- `idx_message_attachments_workspace_created` ON `(workspace_id, created_at DESC, id DESC)`

Pending uploads (before durable message creation) live in `attachment_uploads`.

### 7.4 Global search RPC

`public.global_search(p_workspace_id uuid, p_query jsonb)` — workspace-isolated operator search across contacts, conversations, messages, notes, and attachments. `SECURITY DEFINER` with empty `search_path`; `GRANT EXECUTE` to `authenticated` only; `app_private.global_search` not executable by clients. Empty `q` returns empty groups. Short queries (`char_length < 3`) skip fuzzy message/note/attachment scans. Long queries stage candidates (`≤ 200`) before final rank — **`limit_per_type` bounds returned rows, not scan cost**. Conversation vectors re-sanitize `source_url` on refresh; assignee labels are not indexed. `list_messages` accepts optional `around_message_id` for deep-links. See `docs/GLOBAL-SEARCH.md`.

---

## 8. Agent Productivity Tables

### 8.1 canned_responses

Pre-written reply templates in two scopes: shared (workspace) and personal. See `docs/CANNED-RESPONSES.md` and ADR-007.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| visibility | app_canned_visibility | NOT NULL | `workspace` (shared) or `personal` |
| owner_member_id | UUID | NULL iff shared, NOT NULL iff personal | Composite FK `ON DELETE CASCADE` — personal data leaves with the member |
| folder_id | UUID | NULL | Composite FK → `canned_response_folders (id, workspace_id)`, `ON DELETE SET NULL (folder_id)`; must match the snippet's visibility/owner |
| title | TEXT | NOT NULL, 1–200 | Display name |
| body | TEXT | NOT NULL, 1–4000 | Template with `{{variable}}` placeholders |
| shortcut | TEXT | NULL, `^[a-z0-9][a-z0-9_-]{0,63}$` | Stored **without** the leading slash, lowercase |
| usage_count | INTEGER | NOT NULL DEFAULT 0, `>= 0` | Bumped by `record_canned_response_usage`; does not touch `updated_at` |
| search_vector | TSVECTOR | GENERATED | title + shortcut + body; GIN-indexed |
| created_by / updated_by | UUID | NULL, FK → workspace_members | Composite FKs with column-scoped `ON DELETE SET NULL` so shared history survives |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| updated_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| deleted_at | TIMESTAMPTZ | NULL | Soft delete |

**Indexes:**
- UNIQUE `(workspace_id, shortcut)` WHERE `deleted_at IS NULL AND visibility = 'workspace' AND shortcut IS NOT NULL`
- UNIQUE `(workspace_id, owner_member_id, shortcut)` WHERE `deleted_at IS NULL AND visibility = 'personal' AND shortcut IS NOT NULL` — a member may shadow a shared shortcut
- `idx_canned_responses_workspace_active` ON `(workspace_id, visibility, title, id)` WHERE `deleted_at IS NULL`
- `idx_canned_responses_owner_active`, `idx_canned_responses_folder`, `idx_canned_responses_owner_member`
- GIN on `search_vector` and a `pg_trgm` GIN expression index over `title || ' ' || coalesce(shortcut,'') || ' ' || body`, both WHERE `deleted_at IS NULL`
- **Tombstones** `(workspace_id, updated_at DESC, id DESC)` WHERE `deleted_at IS NOT NULL`

**Related:** `canned_response_folders` (same visibility/owner rules, `name` 1–100, `sort_order`, soft delete) and `canned_response_favorites` (unique `(member_id, canned_response_id)`, per-member pins).

**RPCs:** `list_canned_responses` (fuzzy `q`, folder/visibility/favorites filters, `authoritative` + `catch_up_since` tombstones, `server_watermark`), `get_canned_response`, `create_canned_response`, `update_canned_response`, `soft_delete_canned_response`, `list_canned_response_folders`, `create_canned_response_folder`, `update_canned_response_folder`, `soft_delete_canned_response_folder` (unfiles active snippets first), `set_canned_response_favorite`, `record_canned_response_usage`.

**RLS:** SELECT only. Shared rows are readable by every active member; personal rows only by `owner_member_id`; favorites only by their member. All writes go through the RPCs — owner/admin manage shared snippets, non-viewers manage their own personal ones, and viewers cannot use, favorite, or record usage.

### 8.2 agent_invitations

Pending team member invitations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| email | TEXT | NOT NULL | Invitee email |
| role | app_member_role | NOT NULL DEFAULT 'agent' | Assigned role on accept |
| token_hash | TEXT | NOT NULL | SHA-256 hash of invite token |
| invited_by | UUID | NOT NULL, FK → workspace_members | |
| expires_at | TIMESTAMPTZ | NOT NULL | 7 days from creation |
| accepted_at | TIMESTAMPTZ | NULL | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_agent_invitations_token` ON `(token_hash)` WHERE `accepted_at IS NULL`
- `idx_agent_invitations_email` ON `(workspace_id, email)` WHERE `accepted_at IS NULL`

---

## 9. Notification and Audit Tables

### 9.1 notifications

In-app notifications for workspace members. Extended in PR #35 (center UI, dedupe, unread counters, emit hooks). See `docs/NOTIFICATIONS.md`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| recipient_id | UUID | NOT NULL, FK → workspace_members | |
| type | app_notification_type | NOT NULL | Includes `mention`, `conversation_new`, `visitor_message`, assignment/transfer/unassign |
| title | TEXT | NOT NULL | |
| body | TEXT | NULL | Safe label only — never note body |
| resource_type | TEXT | NULL | e.g., `internal_note`, `conversation`, `message` |
| resource_id | UUID | NULL | |
| conversation_id | UUID | NULL, composite FK → conversations | Deep-link |
| actor_member_id | UUID | NULL, composite FK → workspace_members | Nullable after member removal |
| dedupe_key | TEXT | NOT NULL | Unique per `(workspace_id, recipient_id, dedupe_key)` |
| payload_json | JSONB | NOT NULL DEFAULT `{}` | Safe metadata only |
| read_at | TIMESTAMPTZ | NULL | |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_notifications_recipient_created` ON `(workspace_id, recipient_id, created_at DESC, id DESC)` — keyset feed
- `idx_notifications_recipient_unread` partial WHERE `read_at IS NULL`
- `uq_notifications_recipient_dedupe` UNIQUE `(workspace_id, recipient_id, dedupe_key)`

**RLS:** SELECT for recipient only. No direct INSERT/UPDATE/DELETE for `authenticated`.

### 9.1b notification_unread_counts

Per-member O(1) unread badge. PK `(workspace_id, member_id)`. Maintained by triggers on `notifications`.

### 9.2 notification_preferences

Per-member channel preferences (no workspace overwrite). Columns cover in-app / browser / sound / email categories, DND quiet hours, timezone, and `browser_permission_denied_at`. Writes via `update_notification_preferences` only.

### 9.2b notification_email_outbox

Idempotent email delivery queue (`dedupe_key` unique per workspace). Statuses: `pending` / `sent` / `skipped` / `failed`. No authenticated access.

### 9.3 audit_logs

Immutable security and configuration audit trail.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| workspace_id | UUID | NOT NULL, FK → workspaces | |
| actor_id | UUID | NULL, FK → auth.users | Null for system actions |
| action | app_audit_action | NOT NULL | |
| resource_type | TEXT | NULL | |
| resource_id | UUID | NULL | |
| ip_address | INET | NULL | |
| user_agent | TEXT | NULL | |
| metadata_json | JSONB | NOT NULL DEFAULT '{}' | Action-specific details |
| created_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |

**Indexes:**
- `idx_audit_logs_workspace` ON `(workspace_id, created_at DESC)`
- `idx_audit_logs_actor` ON `(actor_id, created_at DESC)`

**RLS:** SELECT only for owner, admin, viewer. No INSERT/UPDATE/DELETE for authenticated role (inserts via service role or security definer function).

---

## 10. Platform Tables

### 10.1 stripe_webhook_events

Idempotency tracking for Stripe webhooks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | UUID | PK | |
| stripe_event_id | TEXT | NOT NULL, UNIQUE | Stripe event ID |
| event_type | TEXT | NOT NULL | |
| processed_at | TIMESTAMPTZ | NOT NULL DEFAULT now() | |
| payload_json | JSONB | NOT NULL | Full event payload |
| error | TEXT | NULL | Processing error if failed |

---

## 11. Row Level Security Policies

RLS is enabled on all tenant-scoped tables. Below is the policy pattern for each access class.

### 11.1 Helper Functions

```sql
-- Returns workspace IDs the current user belongs to
CREATE OR REPLACE FUNCTION auth.user_workspace_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id
  FROM workspace_members
  WHERE user_id = auth.uid()
    AND status = 'active';
$$;

-- Returns the member's role in a specific workspace
CREATE OR REPLACE FUNCTION auth.user_workspace_role(ws_id UUID)
RETURNS app_member_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM workspace_members
  WHERE user_id = auth.uid()
    AND workspace_id = ws_id
    AND status = 'active'
  LIMIT 1;
$$;
```

### 11.2 Dashboard User Policies (authenticated role)

**Pattern for all tenant tables:**

```sql
-- SELECT: member of workspace
CREATE POLICY "members_select" ON {table}
  FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT auth.user_workspace_ids()));

-- INSERT/UPDATE/DELETE: role-gated (varies by table)
```

**Role-gated examples:**

| Table | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|
| conversations | agent+ | agent+ | — |
| messages | agent+ (non-internal or any agent) | — | — |
| canned_responses | admin+ | admin+ | admin+ |
| workspace_members | admin+ | admin+ (not owner role change) | admin+ |
| allowed_domains | admin+ | — | admin+ |

### 11.3 Visitor Policies (anon role)

Visitors authenticate via session token validated in Route Handlers. Direct database access for visitors uses a custom role `visitor` with JWT claims:

```sql
-- messages: visitor can SELECT and INSERT for their conversation
CREATE POLICY "visitor_messages_select" ON messages
  FOR SELECT TO visitor
  USING (
    conversation_id = (current_setting('app.conversation_id'))::UUID
    AND is_internal = false
  );

CREATE POLICY "visitor_messages_insert" ON messages
  FOR INSERT TO visitor
  WITH CHECK (
    conversation_id = (current_setting('app.conversation_id'))::UUID
    AND sender_type = 'visitor'
    AND is_internal = false
  );
```

Session context (`app.conversation_id`, `app.workspace_id`) is set via `SET LOCAL` in a security definer function called from Route Handlers.

---

## 12. Database Functions and Triggers

### 12.1 Updated At Trigger

Applied to all tables with `updated_at`:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### 12.2 Conversation Counter Trigger

On message INSERT, update parent conversation metadata (see section 7.2).

### 12.3 Usage Metering Trigger

On first visitor message in a new conversation period, increment `workspace_subscriptions.conversations_used`. Enforced with CHECK constraint:

```sql
ALTER TABLE workspace_subscriptions
  ADD CONSTRAINT chk_conversations_within_limit
  CHECK (conversations_used <= (
    SELECT monthly_conversations FROM plans WHERE id = plan_id
  ));
```

### 12.4 Audit Log Function

```sql
CREATE OR REPLACE FUNCTION log_audit_event(
  p_workspace_id UUID,
  p_action app_audit_action,
  p_resource_type TEXT DEFAULT NULL,
  p_resource_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
-- Inserts audit log with current auth.uid() and request metadata
$$;
```

Called from application code after successful mutations.

---

## 13. Indexing Strategy

Beyond per-table indexes listed above:

- **Partial indexes** for active records (`WHERE deleted_at IS NULL`, `WHERE status = 'open'`) to keep index size manageable.
- **No indexes on low-cardinality boolean columns alone.**
- **Composite indexes** match query patterns: inbox sort, assignment filters, audit log time-range scans.
- **Avoid over-indexing write-heavy tables** (`messages` gets only conversation-scoped indexes).

Query patterns validated against EXPLAIN ANALYZE during development.

---

## 14. Migration Strategy

### 14.1 Workflow

1. Author migration SQL in `supabase/migrations/`.
2. Test locally with `supabase db reset`.
3. Review in PR; CI runs migration against ephemeral database.
4. Merge to main → apply to staging.
5. Production apply during low-traffic window with monitoring.

### 14.2 Naming

```
YYYYMMDDHHMMSS_descriptive_name.sql
```

Example: `20260730120000_create_workspaces_and_members.sql`

### 14.3 Breaking Changes

- Additive changes (new columns, tables, indexes) deploy freely.
- Destructive changes require multi-phase migration: add new → migrate data → remove old.
- RLS policy changes are treated as security-critical and require explicit review.

### 14.4 Seed Data

`supabase/seed.sql` provides:
- Three plan records (starter, team, business)
- One demo workspace with owner, two agents, sample conversations
- Used for local development and staging smoke tests only

---

## 15. Data Retention and Purge

| Data | Retention | Purge mechanism |
|------|-----------|-----------------|
| Messages | Workspace-configurable (default 12 months) | Scheduled job |
| Visitor page views | Bounded trail; configurable via `settings_json.privacy.visitorDataRetentionDays` (future) | Scheduled job (future); session delete cascades |
| Visitor sessions | 30 days after expiration | Scheduled job |
| Contacts (visitor identity) | Workspace-configurable (same privacy setting, future) | Scheduled job / owner delete |
| IP addresses (clear text) | **Not stored** on visitor sessions (intentional) | — |
| Audit logs | Plan-dependent (90 days – 2 years) | Scheduled job |
| Notifications | 90 days | Scheduled job |
| Soft-deleted workspaces | 30 days | Hard delete job |
| Stripe webhook events | 1 year | Scheduled job |

Purge jobs run as Supabase Edge Functions or Vercel Cron invoking service-role endpoints. Each job is idempotent and logs rows affected. Visitor identity retention architecture: [DATA-RETENTION.md](./DATA-RETENTION.md).

---

## 16. Performance Considerations

### 16.1 Connection Pooling

- Application uses Supabase connection pooler (PgBouncer, transaction mode) for serverless functions.
- Direct connection reserved for migrations and admin tasks.

### 16.2 Read Replicas

Not required at launch. Supabase read replicas evaluated when dashboard query latency exceeds targets under load.

### 16.3 Partitioning

`messages` and `audit_logs` are candidates for time-based partitioning if row counts exceed 100M. Not implemented at launch; schema designed to allow future partitioning on `created_at`.

### 16.4 Denormalization

Justified denormalizations:
- `conversations.message_count`, `last_message_at`, `last_message_preview` — inbox queries must not aggregate messages.
- `messages.workspace_id` — RLS policy performance.
- `workspace_subscriptions.conversations_used` — fast limit checks.

All denormalized fields maintained by triggers, not application code.
