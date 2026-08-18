# Site Chat — System Architecture

**Version:** 1.2  
**Status:** Foundation  
**Last updated:** 2026-08-17

---

## 1. Architecture Overview

Site Chat is a multi-tenant SaaS platform composed of four primary runtime surfaces:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CUSTOMER WEBSITES                              │
│  ┌──────────────┐                                                        │
│  │ Chat Widget  │── embed script ──► widget.sitechat.com                │
│  └──────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         VERCEL (Next.js App)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │  Marketing  │  │    Auth     │  │  Dashboard  │  │  API Routes   │  │
│  │   Pages     │  │   Flows     │  │  (App Shell)│  │  + Webhooks   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          │                  │                  │                  │
          ▼                  ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              SUPABASE                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │PostgreSQL│  │ Realtime │  │ Storage  │  │   Auth   │  │  Edge Fn  │  │
│  │  + RLS   │  │ Channels │  │ (files)  │  │          │  │ (optional)│  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └───────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
┌──────────────────┐              ┌──────────────────┐
│      Stripe      │              │      Resend      │
│   (billing)      │              │     (email)      │
└──────────────────┘              └──────────────────┘
          │
          ▼
┌──────────────────┐
│      Sentry      │
│  (observability) │
└──────────────────┘
```

### 1.1 Design Tenets

1. **Database as source of truth.** All state lives in PostgreSQL. Realtime channels reflect database changes; they do not hold authoritative state.
2. **RLS-enforced tenant isolation.** Application code validates permissions, but PostgreSQL Row Level Security is the last line of defense against cross-tenant data leaks.
3. **Server-first for mutations.** All write operations flow through Next.js Route Handlers or Server Actions with service-role or authenticated Supabase clients. Clients never write directly to tables except via narrowly scoped RLS policies for realtime subscriptions.
4. **Widget is untrusted.** The widget runs on arbitrary third-party websites. Treat all widget input as untrusted; validate origin, rate-limit, and scope access to a single visitor session.
5. **Idempotent webhooks.** Stripe and other webhook handlers must be safe to retry.

---

## 2. Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Framework | Next.js 15 (App Router) | Full-stack TypeScript, server components, Route Handlers, Vercel-native deployment |
| Language | TypeScript (strict mode) | Type safety across client, server, and shared packages |
| Styling | Tailwind CSS + shadcn/ui | Consistent design system, accessible components, rapid iteration |
| Database | PostgreSQL via Supabase | Mature RLS, realtime, storage, and auth in one platform |
| Realtime | Supabase Realtime | Postgres CDC for message delivery; broadcast for typing/presence |
| File storage | Supabase Storage | S3-compatible, integrated auth, workspace-scoped buckets |
| Authentication | Supabase Auth | Email/password MVP; JWT-based; integrates with RLS via `auth.uid()` |
| Hosting | Vercel | Edge network, preview deployments, environment management |
| Payments | Stripe | Industry standard; Checkout + Customer Portal + webhooks |
| Email | Resend | Transactional email with good deliverability and developer experience |
| Error tracking | Sentry | Client and server exception capture with release tracking |
| AI foundation | `@site-chat/ai` + provider abstraction | Suggested Replies first; OpenAI/Mock implemented; workspace-scoped, fail-closed |

AI subsystem details: `docs/AI-ARCHITECTURE.md`, `docs/AI-SECURITY.md`, `docs/AI-ROADMAP.md`, `docs/adr/ADR-002-ai-provider-foundation.md`.

Visitor identity + context: `docs/VISITOR-IDENTITY.md`, `docs/PRIVACY.md`, `docs/DATA-RETENTION.md`, `docs/adr/ADR-003-visitor-identity-model.md`.

Visitor Profile / CRM-lite (companies, tags, typed custom fields, contact list + profile): `docs/VISITOR-PROFILE.md`, `docs/adr/ADR-008-crm-companies-custom-fields.md`.

---

## 3. Multi-Tenancy Model

### 3.1 Tenant Boundary

The **workspace** is the tenant. Every tenant-scoped table includes a `workspace_id` column referencing `workspaces.id`. There is no shared mutable data between workspaces except platform-level reference data (e.g., plan definitions).

### 3.2 Isolation Strategy

Site Chat uses **shared database, shared schema** with row-level isolation:

- All tenant tables have `workspace_id NOT NULL`.
- RLS policies on every tenant table enforce `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`.
- Widget/visitor access uses a separate Supabase anonymous role with policies scoped to a single `visitor_session_id` or `conversation_id` validated via session token.
- Storage buckets use path prefixes: `{workspace_id}/{conversation_id}/{file_id}` with RLS on `storage.objects`.

This approach balances operational simplicity (one database, one migration path) with strong isolation. Dedicated-database tenancy is reserved for future Enterprise tier if required.

### 3.3 Workspace Context Propagation

Every authenticated dashboard request resolves workspace context through this chain:

1. Extract workspace slug or ID from URL (`/app/[workspaceSlug]/...`).
2. Verify authenticated user is a member of that workspace (middleware).
3. Attach `{ userId, workspaceId, role }` to request context.
4. Pass context to Supabase client; RLS policies use `auth.uid()` and optionally JWT custom claims.

Custom JWT claims (set via Supabase Auth hook) may include `workspace_ids[]` for policy optimization, but membership is always verified against the database for mutations.

### 3.4 Plan Limits Enforcement

Limits are enforced at two layers:

1. **Application middleware** — rejects requests that would exceed limits before hitting the database (e.g., inviting an agent when seats are full).
2. **Database triggers** — final guard for conversation creation and storage upload when application layer is bypassed.

Current limits per plan are defined in the PRD. Limit definitions live in a `plan_entitlements` reference table, not hardcoded.

---

## 4. Application Structure

### 4.1 Repository Layout

```
site-chat/
├── apps/
│   └── web/                          # Next.js application
│       ├── app/
│       │   ├── (marketing)/          # Public pages: landing, pricing
│       │   ├── (auth)/               # Login, signup, invite accept, reset password
│       │   ├── (dashboard)/          # Authenticated operator UI
│       │   │   └── [workspaceSlug]/  # Workspace-scoped routes
│       │   ├── (widget)/             # Widget loader and iframe host
│       │   └── api/                  # Route Handlers
│       │       ├── v1/               # Public versioned API
│       │       └── webhooks/         # Stripe, etc.
│       ├── components/
│       │   ├── ui/                   # shadcn/ui primitives
│       │   └── ...                   # Feature components
│       ├── lib/
│       │   ├── supabase/             # Client factories (server, browser, service)
│       │   ├── stripe/               # Stripe helpers
│       │   ├── email/                # Resend templates
│       │   └── validations/          # Zod schemas
│       └── middleware.ts             # Auth + workspace membership checks
├── packages/
│   ├── shared/                       # Shared types, constants, validators
│   └── widget/                       # Widget bundle (built separately, served via CDN)
├── supabase/
│   ├── migrations/                   # SQL migrations (source of truth)
│   ├── seed.sql                      # Development seed data
│   └── config.toml
├── docs/                             # This documentation
└── tooling/                          # ESLint, Prettier, TSConfig shared configs
```

Monorepo tooling (Turborepo or pnpm workspaces) is recommended from the start to isolate the widget bundle from the dashboard application.

### 4.2 Route Map

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public | Marketing landing page |
| `/pricing` | Public | Plan comparison |
| `/login`, `/signup` | Public | Authentication |
| `/invite/[token]` | Public (token) | Accept workspace invitation |
| `/app/[slug]/inbox` | Authenticated member | Conversation inbox |
| `/app/[slug]/inbox/[conversationId]` | Authenticated member | Conversation detail |
| `/app/[slug]/contacts` | Authenticated member | Contact list |
| `/app/[slug]/settings/*` | Role-gated | Workspace configuration |
| `/widget/[workspaceId]` | Public (domain-checked) | Widget iframe host page |
| `/api/v1/widget/*` | Public (session token) | Widget API endpoints |
| `/api/v1/workspaces/*` | Authenticated | Dashboard API |
| `/api/webhooks/stripe` | Stripe signature | Billing webhooks |

---

## 5. API Architecture

### 5.1 Style and Versioning

Site Chat uses **REST** over Next.js Route Handlers with URL-based versioning (`/api/v1/...`). REST is chosen for long-term maintainability: easy to document (OpenAPI), debug, and integrate without coupling clients to a specific RPC framework.

GraphQL and tRPC are explicitly not used in v1 to reduce long-term surface area.

### 5.2 API Surfaces

#### Dashboard API (Authenticated)

- Auth: Supabase session JWT in HTTP-only cookie (preferred) or `Authorization: Bearer` header.
- All endpoints require workspace context via path (`/api/v1/workspaces/:workspaceId/...`) or header (`X-Workspace-Id`).
- Responses use a consistent envelope:

```json
{
  "data": { ... },
  "meta": { "requestId": "uuid" }
}
```

- Errors:

```json
{
  "error": {
    "code": "CONVERSATION_NOT_FOUND",
    "message": "Human-readable message",
    "requestId": "uuid"
  }
}
```

#### Widget API (Public, Session-Scoped)

- Auth: Visitor session token issued on widget initialization/resume, sent as a standard `Authorization: Bearer <session_token>` header (opaque token, hashed at rest — not a JWT).
- Rate limited per IP and per session (Vercel edge middleware + Upstash Redis or Supabase-based counter).
- Endpoints:
  - `POST /api/v1/widget/session` — Create/resume session; return token, `visitor_public_id` (display only), and — the first time one is minted — a `continuity_token` the client must persist to resume the same contact later
  - `POST /api/v1/widget/messages` — Send visitor message
  - `GET /api/v1/widget/messages` — Fetch conversation history
  - `POST /api/v1/widget/attachments` — Upload file (returns signed upload URL)
  - `POST /api/v1/widget/identify` — **Unsigned** update of the current session's own contact (name/email/phone/attributes); never merges by email or reassigns to another contact
  - `POST /api/v1/widget/page-view` — Record page view (URL redacted to origin + path + allowlisted UTM; 30s server dedupe; client throttle)

Origin validation: when the request carries a browser `Origin` header, it must match the `parentOrigin` bound to the embed token; a mismatch is rejected. Requests without an `Origin` header still require a valid embed token + session.

Host page API (v1): `window.SiteChat.identify({ name, email, phone, attributes })` queues until the widget is ready (implemented — calls before init are buffered and flushed on ready), is scoped by the embed public key’s workspace, and cannot set `visitor_id` / `workspace_id`. See `docs/VISITOR-IDENTITY.md`.

---

### 5.2.1 Visitor Identity Architecture

Visitors are modeled as durable **contacts**, separate from browser **sessions** and messaging **conversations**. Contacts carry two distinct client-facing values with opposite trust levels: `public_id` (`vis_` + 32 hex) is a **display/correlation id only** — never checked by any lookup or authorization path — while a separate opaque `continuity_token` (hashed as `continuity_token_hash`) is the actual credential a new session must present to bind to an existing contact. Page context lives on the session plus a `visitor_page_views` trail, with URLs redacted to origin + path + allowlisted UTM params before storage.

Unsigned identify (current `SiteChat.identify`) patches only the calling session's own contact and never merges by email; a future **verified identify** (signed HMAC/JWT assertion) is designed but not implemented for durable cross-session merges. Identify touches this session's open/pending `conversations.updated_at` for inbox CDC; page-view does not — operators subscribe directly to `visitor_sessions`/`contacts` realtime for live page context instead.

Privacy defaults: no raw IP storage, no fingerprinting, parsed device fields only, workspace-isolated PII. Full model: `docs/VISITOR-IDENTITY.md`.

### 5.2.2 Customer Timeline Architecture

Meaningful visitor/customer activity is recorded in a durable `customer_timeline_events` table (not assembled by merging product tables on each render). Events are emitted inside the database from durable actions (page views, conversation lifecycle, messages/attachments, identity patches) with `dedupe_key` idempotency. Operators read via keyset-paginated `list_customer_timeline` and subscribe to realtime INSERTs by `contact_id`. Compact versioned metadata never stores tokens, signed URLs, or message bodies. Full model: `docs/CUSTOMER-TIMELINE.md`, ADR-004.

#### Webhook API

- Stripe webhooks verified via `stripe-signature` header.
- Processed idempotently using `stripe_event_id` deduplication table.
- Return 200 immediately; heavy processing deferred to background if needed.

### 5.3 Server Actions vs Route Handlers

| Use case | Mechanism |
|----------|-----------|
| Dashboard form mutations (settings, send message) | Server Actions with Zod validation |
| Widget API | Route Handlers (must support cross-origin) |
| Webhooks | Route Handlers |
| File upload initiation | Route Handlers (return signed URL) |
| Data fetching in dashboard | Server Components + Supabase server client |

Server Actions are preferred for dashboard mutations for colocation with UI and automatic CSRF protection. Route Handlers are required where cross-origin access or third-party webhook signatures apply.

---

## 6. Realtime Architecture

### 6.1 Message Delivery Flow

```
Visitor sends message
        │
        ▼
Widget API Route Handler
        │
        ▼
INSERT into messages (PostgreSQL)
        │
        ▼
Supabase Realtime (postgres_changes on messages)
        │
        ├──────────────────────┐
        ▼                      ▼
Dashboard subscriber     Widget subscriber
(conversation channel)   (session channel)
```

Message inserts trigger Realtime events filtered by `conversation_id`. Both widget and dashboard clients subscribe to the same conversation channel but RLS ensures each side only receives authorized rows.

### 6.2 Channel Design

| Channel pattern | Purpose | Subscribers |
|-----------------|---------|-------------|
| `conversation:{id}` | New messages, status changes (postgres_changes) | Agents (dashboard) |
| `workspace:{id}:inbox` | New conversations, assignment changes | All online agents in workspace |
| `workspace:{id}:inbox` | Message/conversation CDC + `conversation_member_reads` CDC for multi-tab unread | Online operators in workspace |
| `conversation:{id}` | Open-thread conversation CDC (assignee/status) + messages | Agents viewing the thread |
| `conversation-notes:{id}` | Internal note INSERT/UPDATE CDC | Messaging-role operators on Notes tab |
| `notifications:{memberId}` | Mention (and future) notification INSERT | Recipient member only |

### 6.2.0 Conversation assignment

Current assignee is stored on `conversations` (`assigned_to`, `assigned_at`, `assigned_by_member_id`, `assignment_version`). Mutations go through `take_conversation` / `assign_conversation` / `unassign_conversation` with row-lock + version CAS so concurrent Take has exactly one winner. History is emitted to Customer Timeline (`conversation_assigned` / `conversation_transferred` / `conversation_unassigned`). Inbox filters: Mine / Unassigned / All. Assignment never bumps `last_message_at`. See `docs/CONVERSATION-ASSIGNMENT.md` and ADR-005.

### 6.2.0a Internal notes

Operator-only notes live in `internal_notes` (not `messages`). Soft delete, `@mentions`, durable mention `notifications`, timeline events (`internal_note_created` / `updated` / `deleted`, `mention_created`), and CDC on `internal_notes` with list catch-up merge. Visitors/viewers never receive notes. See `docs/INTERNAL-NOTES.md` and ADR-006.

Canned responses live in `canned_responses` (with `canned_response_folders` and per-member `canned_response_favorites`). Workspace-shared and personal scopes share one table; mutations are Server Actions over SECURITY DEFINER RPCs (RLS is SELECT-only for realtime). Composer `/shortcut` insertion interpolates `{{visitor.*}}` / `{{operator.name}}` / `{{workspace.name}}` / `{{conversation.id}}` at insert time. See `docs/CANNED-RESPONSES.md` and ADR-007.

CRM-lite extends `contacts` with optional `company_id`, profile fields, workspace `contact_tags` / `companies` / typed `custom_field_*` tables. Mutations are Server Actions over SECURITY DEFINER RPCs (RLS SELECT-only). Host `custom_attributes_json` stays separate from operator custom fields. Contact `search_vector` is reused by global search. Identity forms use **dirty-only patches** (submit changed fields only); live CDC refresh reconciles pristine fields while preserving dirty local drafts — no full-snapshot overwrite across tabs. See `docs/VISITOR-PROFILE.md` and ADR-008.

### 6.2.0b Global search

Operator global search is a workspace-scoped SECURITY DEFINER RPC (`public.global_search`) backed by FTS + `pg_trgm` indexes across contacts, conversations, messages, internal notes, and attachment filenames. Long queries stage a bounded candidate set (cap ≤ 200) before ranking; short queries (`< 3` chars) are exact/prefix identity only. The dashboard palette (`⌘/Ctrl+K`) calls a Server Action with a request-generation guard so stale responses and workspace switches cannot clobber results. Message deep-links use `list_messages.around_message_id` so hits outside the newest page still load. Viewers receive `can_search_notes = false`, empty notes groups, and no internal-message hits; anon/visitors cannot execute the RPC. See `docs/GLOBAL-SEARCH.md`.

### 6.2.1 Read receipts and unread counters

Message lifecycle is **sent → delivered → seen**, derived from conversation-level cursors (no per-message writes):

| Cursor | Table | Meaning |
|--------|-------|---------|
| Operator `last_read_sequence` / `last_delivered_sequence` / `unread_count` | `conversation_member_reads` | Per-member operator read position + O(1) unread |
| Visitor `last_read_sequence` / `last_delivered_sequence` | `conversation_visitor_reads` | One visitor cursor per conversation |

Derivation: `message.sequence <= peer.last_delivered_sequence` → delivered; `<= peer.last_read_sequence` → seen. **Sent** means the durable message write succeeded (optimistic/pending UI is not “sent” for receipt ticks). Cursors never regress (client merge + SQL `GREATEST`).

Unread (operator, per member, O(1)):

- Denormalized `conversation_member_reads.unread_count` (+ bootstrap from `conversations.visitor_message_count` when no read row).
- Formula: with a read row → `unread_count`; without → `visitor_message_count`. Trigger `+1` only for non-internal visitor inserts with `sequence > last_read`. Mark-read clears/recomputes; CHECK `unread_count >= 0`.
- Operator unread is **per-member**. Visitor ticks for agent messages use `max()` across member cursors (shared-team “someone on the team has seen this”), which does **not** overwrite another member’s unread row.

- **Delivered** advances when the peer client actually receives the message (Realtime Broadcast/CDC or HTTP catch-up). Websocket connect alone does not imply seen.
- **Seen** advances only when the peer views the active conversation (operator opens thread; visitor has panel open **and** `document.visibilityState === "visible"`). This is **panel + document visibility**, not per-message IntersectionObserver viewport checks — messages loaded into the open visible panel are marked seen through the max agent sequence.
- Mark RPCs are monotonic (`GREATEST`) and **no-op** when the watermark does not advance (reopening an already-read conversation performs no write). Concurrent mark-read upserts keep unread from the winning (higher) watermark.
- Live UX: clients broadcast `receipt.v1` on the ephemeral topic after a durable cursor advance (including no-op RPC mirrors when the watermark was already written). Pending broadcasts flush on ephemeral `SUBSCRIBED`. Clients **merge** remote receipts monotonically so a stale `receipt.v1` cannot regress CDC/HTTP truth.
- Operator open-thread also applies CDC on `conversation_visitor_reads` so visitor delivered/seen cannot be lost if an ephemeral event is missed. Multi-tab inbox unread sync uses CDC on `conversation_member_reads`.
- Catch-up: `get_conversation` / `widget_list_visitor_messages` return peer cursors so reconnect/offline recovery rehydrates receipt UI without polling.

### 6.3 Ordering and Idempotency

- Each message has a `sequence_number` (bigint, per-conversation auto-increment via database sequence or `MAX+1` with row lock).
- Clients display messages sorted by `sequence_number`.
- Client-generated `client_message_id` (UUID) enables deduplication on retry.

---

## 7. Widget Architecture

### 7.1 Embed Mechanism

Customers add one script tag to their site:

```html
<script
  async
  src="https://widget.sitechat.com/loader.js"
  data-workspace-id="ws_abc123"
></script>
```

`loader.js` (< 5 KB gzipped) performs:

1. Validate `data-workspace-id` presence.
2. Inject iframe pointing to `/widget/[workspaceId]?origin={encoded host origin}`.
3. Position iframe (fixed, bottom-right by default).
4. Establish `postMessage` bridge between host page and iframe for resize/visibility events.

The iframe hosts the full widget UI, isolating styles and preventing host page JavaScript from accessing widget internals.

### 7.2 Security Considerations

- iframe `sandbox` attribute with minimal required permissions.
- `postMessage` origin validation on both sides.
- Session token stored in iframe first-party storage, not accessible to host site.
- Content Security Policy on widget routes: strict `script-src`, `frame-ancestors` controlled per workspace allowlist.

### 7.3 Internationalization

Visitor widget UI strings are localized via the shared locale registry and per-locale dictionaries. See `docs/WIDGET-I18N.md` for the LiveChat-aligned 48-locale list, resolution order, RTL rules, and `i18n:check` gate. Message bodies are never auto-translated.

---

## 8. Authentication and Session Management

### 8.1 Operator Authentication

- Supabase Auth with email/password for MVP.
- Session managed via `@supabase/ssr` cookie helpers in Next.js middleware.
- Session refresh handled in middleware on every dashboard request.
- Invitation flow: magic link or token-based signup that pre-associates workspace membership.

### 8.2 Visitor Authentication

- No account required. Anonymous session token (JWT or opaque UUID) issued on widget init.
- Token encodes: `visitor_session_id`, `workspace_id`, `exp`.
- Short-lived access token (1 hour) with silent refresh via refresh token stored in iframe localStorage.
- Token rotation on refresh; old tokens invalidated server-side.

---

## 9. File Storage Architecture

### 9.1 Bucket Structure

Single private bucket: `attachments`

Path pattern: `{workspace_id}/{conversation_id}/{attachment_id}/{filename}`

### 9.2 Upload Flow

1. Client requests upload URL via API with file metadata (name, size, MIME).
2. Server validates plan storage quota, file type, and size.
3. Server returns Supabase Storage signed upload URL (short TTL).
4. Client uploads directly to Storage.
5. Client confirms upload; server creates `message_attachments` record and links to message.

### 9.3 Download Flow

- Dashboard and widget request signed download URLs via API.
- URLs expire after 15 minutes.
- RLS on storage objects mirrors database attachment records.

---

## 10. Billing Architecture

### 10.1 Stripe Integration

```
Signup → Create Stripe Customer (on trial start)
       → Trial period (14 days, no payment method)
       → Owner adds payment → Stripe Checkout Session
       → Webhook: checkout.session.completed → activate subscription
       → Sync entitlements to workspace_subscriptions
```

- One Stripe Customer per workspace.
- Subscription items map to plan price IDs stored in environment config.
- Customer Portal session generated server-side for self-service billing management.

### 10.2 Entitlement Sync

A `workspace_subscriptions` table mirrors Stripe state:

- `status`: trialing, active, past_due, canceled, suspended
- `plan_id`: references plan entitlements
- `current_period_start`, `current_period_end`
- `stripe_subscription_id`, `stripe_customer_id`

Application code reads entitlements from this table, not directly from Stripe, to avoid latency and ensure consistent enforcement in RLS.

---

## 11. Email Architecture

Resend sends transactional emails through React Email templates stored in `apps/web/lib/email/templates/`.

| Template | Trigger |
|----------|---------|
| `invite-agent` | Admin invites team member |
| `welcome-owner` | Workspace created |
| `new-conversation` | Unassigned conversation created (if agent opted in) |
| `conversation-assigned` | Conversation assigned to agent |
| `payment-failed` | Stripe invoice.payment_failed |
| `trial-ending` | 3 days before trial expiration |

All emails include unsubscribe links where applicable (notification preferences).

---

## 12. Deployment Architecture

### 12.1 Environments

| Environment | Purpose | URL |
|-------------|---------|-----|
| Production | Live customers | `app.sitechat.com`, `widget.sitechat.com` |
| Staging | Pre-release testing | `staging.sitechat.com` |
| Preview | Per-PR Vercel previews | `*.vercel.app` |
| Local | Development | `localhost:3000` |

Each environment has isolated Supabase project (production and staging required; preview may share staging Supabase with namespace prefix).

### 12.2 CI/CD Pipeline

1. Pull request opened → Vercel preview deployment + Supabase migration dry-run.
2. PR merged to `main` → deploy to staging, run integration tests, apply migrations.
3. Release tagged → promote to production, apply production migrations.
4. Sentry release created on each production deploy.

### 12.3 Environment Variables

Managed in Vercel (production/staging/preview) and `.env.local` (development). Secrets never committed. Required variables documented in `.env.example`.

Critical secrets:
- `SUPABASE_SERVICE_ROLE_KEY` (server only, never exposed to client)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `RESEND_API_KEY`
- `SENTRY_AUTH_TOKEN`

### 12.4 Database Migrations

Supabase CLI manages migrations in `supabase/migrations/`. Migrations are:

- Forward-only (no down migrations in production).
- Reviewed in PR like application code.
- Applied automatically in CI/CD before application deploy.
- Named with timestamp prefix: `20260730120000_create_workspaces.sql`.

---

## 13. Observability

### 13.1 Error Tracking

Sentry configured for:
- Browser (widget + dashboard client components)
- Node.js server (Route Handlers, Server Actions)
- Edge middleware

Each event tagged with `workspaceId`, `userId`, and `requestId` where available. PII scrubbing rules applied to message content and email addresses.

### 13.2 Logging

Structured JSON logs via Vercel log drain or Axiom (post-MVP). Every API request logs:
- `requestId`
- `method`, `path`, `statusCode`, `durationMs`
- `workspaceId`, `userId` (if authenticated)

Message content is never logged.

### 13.3 Alerting

- Sentry alerts: error rate spike, new unhandled exception types.
- Uptime monitoring: health check on `/api/health` (checks database connectivity).
- Stripe webhook failure alert if processing error rate exceeds threshold.

---

## 14. Coding Standards

### 14.1 TypeScript

- `strict: true` in all tsconfig files.
- No `any` without explicit eslint-disable comment and justification.
- Prefer `interface` for object shapes; `type` for unions and computed types.
- All API inputs validated with Zod schemas in `packages/shared` or `lib/validations`.

### 14.2 React and Next.js

- Server Components by default; `"use client"` only when hooks or browser APIs are required.
- Co-locate feature components with routes where scope is limited; shared components in `components/`.
- Data fetching in Server Components; mutations via Server Actions.
- Avoid prop drilling beyond two levels; use React context for workspace context in dashboard layout.

### 14.3 Styling

- Tailwind utility classes; no custom CSS except global resets and Tailwind config extensions.
- shadcn/ui components live in `components/ui/` and are not modified directly; extend via wrapper components.
- Design tokens defined in `tailwind.config.ts`: colors, spacing, typography. No hardcoded hex values in components.

### 14.4 Database Access

- Dashboard reads: Supabase client with user session (RLS enforced).
- Widget writes: Route Handler with service role, after manual authorization checks.
- Never expose service role key to client bundles (verified in CI via grep check).
- All queries use parameterized statements via Supabase client; no raw SQL string interpolation in application code.

### 14.5 Error Handling

- Route Handlers catch all errors and return structured error responses; never leak stack traces to clients.
- Server Actions return `{ success: boolean, error?: string }` or use `useActionState`.
- Database errors mapped to user-friendly messages; unique constraint violations become validation errors.

### 14.6 Testing Strategy

| Layer | Tool | Coverage target |
|-------|------|-----------------|
| Unit (validators, utils) | Vitest | 90% |
| Integration (API routes) | Vitest + Supabase local | Critical paths |
| E2E (dashboard flows) | Playwright | Happy paths per release |
| RLS policies | pgTAP or custom SQL tests | Every policy |

Tests run in CI on every PR. E2E runs on staging before production promotion.

### 14.7 Code Review Requirements

- All changes require PR review.
- Database migrations require explicit review for RLS policy changes.
- Security-sensitive changes (auth, widget, billing) require review from designated security reviewer.

### 14.8 Naming Conventions

| Entity | Convention | Example |
|--------|------------|---------|
| Database tables | snake_case, plural | `workspace_members` |
| TypeScript types | PascalCase | `WorkspaceMember` |
| API routes | kebab-case | `/api/v1/canned-responses` |
| React components | PascalCase | `ConversationList` |
| Files (components) | PascalCase.tsx | `ConversationList.tsx` |
| Files (utilities) | kebab-case.ts | `format-date.ts` |
| Environment variables | SCREAMING_SNAKE | `STRIPE_SECRET_KEY` |

---

## 15. Security Architecture Summary

Detailed security controls are documented in [SECURITY.md](./SECURITY.md). Architecture-level security decisions:

- RLS on all tenant tables; service role used only in trusted server context.
- Widget isolated in iframe with strict CSP.
- All mutations audited.
- Rate limiting on all public endpoints.
- Secrets rotated on quarterly schedule.
- Dependency updates via Dependabot; critical CVEs patched within 48 hours.

---

## 16. Decision Log

| Date | Decision | Rationale | Alternatives considered |
|------|----------|-----------|------------------------|
| 2026-07-30 | Shared schema multi-tenancy | Operational simplicity at current scale | Dedicated DB per tenant |
| 2026-07-30 | REST over tRPC/GraphQL | Long-term openness, easier third-party integration | tRPC, GraphQL |
| 2026-07-30 | Supabase Realtime over custom WebSocket | Reduced infrastructure; Postgres CDC is source of truth | Socket.io, Ably |
| 2026-07-30 | iframe widget over script-only | Stronger isolation from host site CSS/JS | Shadow DOM-only embed |
| 2026-07-30 | Monorepo with separate widget package | Independent bundle size optimization | Single package |
| 2026-08-10 | Contacts as visitor identity + opaque `public_id` | Durable identity without CRM rename/fingerprint | See ADR-003 |
| 2026-08-16 | CRM-lite companies + typed custom fields (EAV) | Operator CRM without host JSONB merge or domain auto-merge | See ADR-008 |

Decisions are append-only. Superseded decisions are marked but not deleted.
