# Site Chat — Security Model

**Version:** 1.2  
**Status:** Foundation  
**Last updated:** 2026-08-19

---

## 1. Security Overview

Site Chat handles business communications between companies and their website visitors. A security failure — cross-tenant data exposure, unauthorized message access, or billing manipulation — would destroy customer trust and create legal liability. Security is designed into every layer, not added as an afterthought.

### 1.1 Security Objectives

1. **Tenant isolation:** Workspace A cannot access Workspace B's data under any circumstance.
2. **Least privilege:** Users, services, and the widget receive only the permissions required for their function.
3. **Defense in depth:** No single control is solely responsible for protection; RLS, application checks, and network controls overlap.
4. **Auditability:** Security-relevant actions produce immutable audit records.
5. **Recoverability:** Incidents can be detected, contained, and investigated using logs and audit trails.

### 1.2 Threat Model

| Threat | Impact | Primary controls |
|--------|--------|------------------|
| Cross-tenant data access | Critical | RLS, workspace context validation |
| Widget origin spoofing | High | Domain allowlist, Origin header validation |
| Session token theft | High | Short-lived tokens, HTTPS-only, iframe isolation |
| Privilege escalation | Critical | Role checks in app + RLS, immutable owner role rules |
| Stripe webhook forgery | Critical | Signature verification, idempotency |
| XSS via message content | High | Output encoding, CSP, no HTML in visitor messages (MVP) |
| File upload abuse | Medium | MIME validation, size limits, storage quotas |
| DDoS on widget API | Medium | Rate limiting, Vercel edge protection |
| Insider threat (platform operator) | Medium | Separate admin tooling, audit logs, minimal service-role usage |
| Data exfiltration via export | Medium | Role-gated exports, audit logging |
| Visitor identity enumeration | Medium | Opaque `vis_` public ids; workspace-scoped uniqueness; RLS |
| `public_id` treated as an authorization secret | Critical | `public_id` is never checked by any RPC for lookup/resume/bind; leaking it cannot enable session takeover or contact binding — see §4.5 |
| Unsigned identify used to take over another visitor's identity | High | `widget_identify_visitor` never searches/merges by email or reassigns session/conversation `contact_id`; email conflicts error without touching the other contact — see §4.5 |
| Continuity token theft / enumeration | High | Hashed at rest (SHA-256); invalid/unknown tokens ignored (no distinguishing error) to prevent an enumeration oracle |
| Query-string/fragment secret leakage via tracked URLs | Medium | Allowlist sanitizer strips fragment + all non-UTM query params before storage (SQL + shared TS) — see §4.5 |
| Widget request replay from an unauthorized origin | High | `Origin`, when present, must match embed `parentOrigin` **or** the widget API origin (iframe same-origin); other origins denied `403` |
| XSS via page title/URL in inbox | Medium | Treat as untrusted text; encode on render; length bounds |
| Attribute key pollution | Medium | Reserved keys rejected; primitive-only JSONB; count/length caps |
| Cross-tenant identify / page-view | Critical | Session token + workspace binding; service-role RPCs after origin checks |
| Cross-tenant customer timeline read | Critical | `list_customer_timeline` requires `workspace_is_accessible`; RLS on `customer_timeline_events`; contact must belong to workspace |
| Timeline metadata secret leakage | High | Emit helper strips forbidden keys; page URLs sanitized; no signed URLs/bodies/tokens persisted |
| Unpublished Widget Studio draft exposed to visitors | High | Public resolver selects `published_json` explicitly; DTO allowlist excludes draft/settings/member/billing fields; route schema regression tests |
| Cross-tenant or unverified brand asset | High | Workspace/kind/verified-state checks before signing; immutable workspace-prefixed keys; private bucket; raster magic-byte/dimension verification |
| Arbitrary style/script injection through customization | High | Strict typed config, allowlisted fonts/assets, no CSS/JS/remote URL fields |

---

## 2. Authentication

### 2.1 Operator Authentication

**Provider:** Supabase Auth

**Supported methods (MVP):**
- Email and password

**Password policy:**
- Minimum 10 characters
- Must not appear in known breach lists (Supabase leaked password protection)
- Password reset via time-limited email link (1 hour expiry, single use)

**Session management:**
- JWT access token: 1 hour expiry
- Refresh token: 7 days, rotated on use (Supabase default refresh rotation)
- Sessions stored in HTTP-only, Secure, SameSite=Lax cookies via `@supabase/ssr`
- Explicit logout invalidates refresh token server-side

**Multi-factor authentication:** Post-MVP (TOTP via Supabase Auth MFA).

### 2.2 Visitor Authentication

Visitors do not have accounts. Authentication is session-based:

1. Widget calls `POST /api/v1/widget/init` with workspace ID and page origin.
2. Server validates origin against `allowed_domains`.
3. Server creates or resumes `visitor_sessions` record.
4. Server returns session token (JWT signed with server secret, not Supabase Auth JWT).

**Token properties:**
- Claims: `sub` (session ID), `wid` (workspace ID), `cid` (conversation ID, optional)
- Access token TTL: 1 hour
- Refresh token TTL: 30 days
- Refresh rotates access token; old access tokens rejected after rotation
- Token stored in iframe localStorage (first-party to widget origin, inaccessible to host site)

**Token validation (every widget API request):**
1. Verify JWT signature and expiry.
2. Hash token and match against `visitor_sessions.session_token_hash`.
3. Verify session not expired (`expires_at`).
4. Verify workspace ID in token matches request workspace.

### 2.3 Service Authentication

**Service role key** (`SUPABASE_SERVICE_ROLE_KEY`):
- Used exclusively in Next.js server context (Route Handlers, Server Actions, cron jobs).
- Bypasses RLS; therefore used only after explicit authorization checks in code.
- Never included in client bundles; CI check fails build if detected in client-side code.
- Rotated quarterly; rotation procedure documented in internal runbook.

**Stripe webhook authentication:**
- Verify `Stripe-Signature` header against webhook secret.
- Reject requests with timestamp older than 5 minutes (replay protection).

---

## 3. Authorization (RBAC)

### 3.1 Role Hierarchy

```
owner > admin > agent > viewer
```

Higher roles inherit lower role capabilities unless explicitly restricted (e.g., viewers cannot send messages despite being "lower" in some capability lists).

### 3.2 Enforcement Layers

Authorization is enforced at three layers; all three must pass for a mutation:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Middleware | Next.js middleware checks auth + workspace membership | Block unauthenticated/unauthorized route access |
| Application | Role checks in Server Actions and Route Handlers | Business logic authorization (e.g., only admin can invite) |
| Database | RLS policies | Final enforcement; protects against application bugs |

Application-layer checks are never skipped with the assumption that RLS alone is sufficient for user-facing error messages. RLS is the safety net, not the primary UX layer.

### 3.3 Role Assignment Rules

- Workspace creator receives `owner` role automatically.
- Only `owner` can assign or revoke `owner` role (transfer ownership).
- `owner` role cannot be removed unless ownership is transferred or workspace is deleted.
- Admins cannot promote themselves to owner.
- Deactivated members (`status = 'deactivated'`) fail all authorization checks immediately.
- Deactivating a member clears `conversations.assigned_to` for conversations they owned (returns them to the unassigned queue without bumping `last_message_at`).

### 3.4 Permission Matrix (Detailed)

See [PRD.md](./PRD.md) Section 3 for the user-facing permission matrix. Implementation notes:

| Action | Implementation |
|--------|----------------|
| Manage billing | Check `role = 'owner'` in Server Action; Stripe Customer Portal session created server-side |
| Invite member | Check `role IN ('owner', 'admin')`; verify seat limit against subscription |
| Send message | Check active membership + `role IN ('owner', 'admin', 'agent')` |
| Manage internal notes | Capability `manage_internal_notes` (owner/admin/agent); RPC `require_notes_access` / `require_messaging_role`; viewers cannot read or write; visitors have no RPC path |
| Global search | `public.global_search` for authenticated workspace members; viewers get `can_search_notes = false`, empty notes groups, and never match `messages.is_internal` (or attachments on those messages); anon/visitors cannot execute; results always filtered by `workspace_id`; conversation FTS re-sanitizes `source_url` (secret query params never searchable) |
| Assign conversation | Capability `assign_conversations` (owner/admin/agent); RPC `require_messaging_role`; assignee must be active messaging-role member in same workspace; Take/Assign/Transfer/Unassign use CAS (`ASSIGNMENT_CONFLICT` on stale or raced version) |
| Read canned responses | Capability `view_canned_responses` (owner/admin/agent/viewer); RPC `require_canned_view_access`; RLS restricts `visibility = 'personal'` rows to `owner_member_id` |
| Use / favorite canned response | Capability `use_canned_responses` (owner/admin/agent); RPC `require_canned_use_access`; viewers are rejected because inserting a snippet implies sending a reply |
| Manage shared canned responses | Capability `manage_workspace_canned_responses` (owner/admin); RPC `require_workspace_canned_manage`; personal rows instead require `use_canned_responses` plus row ownership (`assert_can_manage_canned_response`) |
| View contact / CRM profile | Capability `view_contact_profile` (owner/admin/agent/viewer); RPC `require_crm_read_access` |
| Edit contact profile / tags / companies / custom field **values** | Capability `update_visitor_profile` (owner/admin/agent); RPC `require_crm_write_access` (= messaging role) |
| Manage custom field **definitions** | Capability `manage_crm_definitions` (owner/admin); RPC `require_crm_definitions_manage` |
| View Widget Studio | Capability `view_widget_studio` (owner/admin/agent/viewer); workspace-resolved page and read-only state |
| Manage Widget Studio | Capability `manage_widget_studio` (owner/admin); Server Actions + RPC role gate for draft/publish/reset/discard/presets/assets |
| View audit logs | Check `role IN ('owner', 'admin', 'viewer')` |
| Export data | Check `role IN ('owner', 'admin')`; log audit event |

Assignment RPCs (`take_conversation`, `assign_conversation`, `unassign_conversation`) are `SECURITY DEFINER` with `search_path = ''`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated` only. `app_private.apply_conversation_assignment` is not executable by `authenticated`/`anon`. Visitors have no path to these RPCs. See `docs/CONVERSATION-ASSIGNMENT.md`.

Canned response RPCs follow the same SECURITY DEFINER pattern (`REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated` only, `app_private` mutation helpers revoked from `PUBLIC` / `anon` / `authenticated`). The two visibility scopes are separate authorization domains: RLS on `canned_responses` / `canned_response_folders` exposes shared rows to every active member and personal rows only to `owner_member_id`, and `canned_response_favorites` only to the owning member. Visibility is immutable, so Server Actions read the stored row's scope before choosing a gate rather than trusting the submitted scope, and the RPC re-checks ownership. Every action resolves `workspace_id` from the URL slug through the caller's membership, never from a client-supplied id. Snippet bodies are plain text and `{{variable}}` substitution happens client-side into a `<textarea>` at insertion time, so no snippet content reaches a visitor until the operator sends a message — snippets never appear in widget APIs, visitor Realtime, or the visitor-facing timeline. Catch-up tombstone scans are watermarked with a Postgres-computed `server_watermark` (never a browser clock), and `usage_count` bumps deliberately do not emit CDC. See `docs/CANNED-RESPONSES.md`.

CRM-lite RPCs follow the same SECURITY DEFINER pattern. Tables `companies`, `contact_tags`, `contact_tag_assignments`, `custom_field_definitions`, and `custom_field_values` use FORCE RLS with SELECT-only policies gated by `workspace_is_accessible`. Visitors, anon, and widget paths cannot execute CRM RPCs and never receive CRM definition or value payloads. Host `custom_attributes_json` remains identify-only and is not writable through CRM definition APIs. Prefixed errors (`INVALID_COMPANY_ID`, `COMPANY_NOT_FOUND`, `FORBIDDEN`, …) keep client handling typed. Soft-deleting a company clears linked `company_id` values without emitting per-contact timeline events; soft-deleting a custom field definition hard-deletes values and refreshes `search_vector` without per-contact `custom_field_updated` events. Company websites are http(s) only; custom field dates are strict `YYYY-MM-DD` (shared Zod + DB). See `docs/VISITOR-PROFILE.md` and ADR-008.

Internal note RPCs follow the same SECURITY DEFINER pattern (`REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO authenticated` only). After each notes migration, `app_private` EXECUTE is revoked from `PUBLIC` / `anon` / `authenticated` and only intentional RLS helpers are re-granted. RLS on `internal_notes` / `internal_note_mentions` allows SELECT only for owner/admin/agent. Inbox search never returns note-body matches for viewers (active notes only). Viewer role is also blocked from operator-private timeline event types (`internal_note_created` / `updated` / `deleted`, `mention_created`) via both `customer_timeline_events` RLS and `list_customer_timeline`. Create idempotency uses lifetime-unique `client_note_id`; retrying against a soft-deleted key returns typed `NOTE_DELETED` (never resurrects). Catch-up tombstone scans are watermarked (`catch_up_since` + Postgres `server_watermark` DB cursor; never client clock) and indexed. Note bodies never appear in widget APIs, visitor Realtime, visitor-facing timeline, or notification payloads (notification text is a short mention label only). See `docs/INTERNAL-NOTES.md`.

Global search (`public.global_search`) follows the same SECURITY DEFINER pattern with empty `search_path`. Authorization is membership via `require_workspace_access`; notes inclusion is gated by role (`viewer` → empty notes group + `can_search_notes = false`, no error-based existence leak). Viewers also cannot retrieve internal messages or attachments belonging to them via search. Attachment hits expose filename/mime only (never `storage_key`). Conversation hit paths match and display `sanitize_page_url(source_url)` only — dirty legacy URLs with `token`/`code`/`access_token`/fragments cannot become searchable. Cross-workspace probes return no foreign hits. LIKE/ILIKE ranking escapes `%`/`_`/`\`. See `docs/GLOBAL-SEARCH.md`.

Operator notification RPCs (`list_notifications`, mark-read, preferences) are SECURITY DEFINER with locked `search_path`. RLS on `notifications` / `notification_unread_counts` / `notification_preferences` is recipient-only SELECT; `notification_email_outbox` has no authenticated access (claim/finalize are service_role only). After notification migrations, `app_private` EXECUTE is revoked from PUBLIC/anon/authenticated and only intentional RLS helpers are re-granted. Emit helpers refuse Viewer recipients for mention/assignment types. DND/quiet hours suppress email/browser/sound only — durable in-app history still persists when `in_app_*` is enabled. Payloads never include note bodies, tokens, or signed URLs. Browser permission is explicit and denial is sticky via `browser_permission_denied_at`. See `docs/NOTIFICATIONS.md`.

---

## 4. Multi-Tenant Isolation

### 4.1 Data Isolation

Every query against tenant data includes `workspace_id` filtering:

- **Dashboard:** Workspace ID derived from URL slug, validated against membership, passed to Supabase client. RLS policies use `auth.user_workspace_ids()`.
- **Widget:** Workspace ID from embed configuration, validated against session token claims. RLS uses session-scoped context variables.
- **Background jobs:** Service role with explicit `workspace_id` parameter; never query without workspace filter.

### 4.2 Storage Isolation

Supabase Storage paths are prefixed with `workspace_id`. RLS policy on `storage.objects`:

```sql
CREATE POLICY "workspace_storage" ON storage.objects
  FOR ALL TO authenticated
  USING (
    (storage.foldername(name))[1]::UUID IN (SELECT auth.user_workspace_ids())
  );
```

### 4.3 Realtime Isolation

Supabase Realtime channels include workspace or conversation ID. Clients subscribe only to channels they are authorized for. RLS on underlying tables prevents unauthorized postgres_changes events from being delivered.

Broadcast channels (typing, presence) validate membership before allowing publish/subscribe via server-side channel authorization (Supabase Realtime authorization hooks / RLS on `realtime.messages`).

**Typing / presence (PR 4D-2 + dual-topic hardening):** Durable message Broadcast and ephemeral typing/Presence use **separate** private topics derived from the same opaque 64-hex key:

- `widget-conversation:{topic_key}` — server-originated `message.created` only. `widget_realtime` may **SELECT** only (no INSERT).
- `widget-ephemeral:{topic_key}` — `typing.v1` Broadcast + Presence. `widget_realtime` may SELECT+INSERT Broadcast/Presence on this topic only.

Client publish remains authorized at topic + extension granularity on the ephemeral topic (not per event name), so receivers must still validate payloads and filter by expected `actorRole` / `role`. Cross-tenant isolation remains exact topic matching. Do not treat ephemeral metadata as authenticated identity. Durable message authority remains PostgreSQL + HTTP catch-up; visitors cannot forge `message.created` on the message topic.

### 4.4 Cross-Tenant Attack Scenarios

| Attack | Mitigation |
|--------|------------|
| User guesses another workspace's conversation UUID | RLS blocks SELECT; UUID alone is insufficient |
| Widget sends messages to another workspace's conversation | Session token encodes workspace ID; mismatch rejected |
| Agent manipulates workspace_id in API request | RLS blocks; middleware validates membership for requested workspace |
| Service role query without workspace filter | Code review + lint rule; integration tests verify isolation |

Integration tests include explicit cross-tenant access attempts that must fail.

### 4.5 Visitor Identity Threat Notes

| Threat | Mitigation |
|--------|------------|
| Enumerating `public_id` values | 128-bit random hex after `vis_`; not sequential; no list API for anon |
| **`public_id` replay used to bind/resume a session** | `public_id` is generated by a column `DEFAULT` and is **never** read by any resume/bind/lookup RPC — `app_private.ensure_visitor_contact` always creates a new anonymous contact; only a valid `continuity_token` (hashed as `continuity_token_hash`) or an existing session's Bearer token can link a session to a contact. Leaking a `public_id` therefore cannot cause session takeover or contact binding. |
| **Continuity token guessing/enumeration** | Token is 32 random bytes (base64url), hashed with SHA-256 at rest; unknown/invalid tokens are silently ignored (a fresh anonymous contact is created) rather than erroring, so responses do not distinguish "valid but taken" from "invalid" |
| **Unsigned `identify` email takeover** | `widget_identify_visitor` is unsigned (no proof of email ownership) and is scoped to patch **only** the calling session's own contact — it never searches other contacts by email and never reassigns `contact_id` on the session or its conversations. An email already used by another contact raises a conflict; the caller's own contact and session are unaffected, so an attacker cannot pivot into a victim's conversation history this way. |
| **Query-string/fragment secret leakage via tracked URLs** | `current_url` / `landing_url` / `referrer` / page-view URLs / conversation `source_url`+`referrer` are passed through an allowlist sanitizer (origin + path + `utm_*` only; fragment and all other query params dropped) enforced in both shared TypeScript and SQL (`app_private.sanitize_page_url`) before any write — including message send and attachment initiate/complete — so nothing sensitive ever reaches storage or the dashboard |
| **Widget request from a mismatched Origin** | When a browser `Origin` header is present, it must equal the embed token's bound `parentOrigin` **or** the widget API origin (iframe same-origin fetches). Other origins are rejected `403 FORBIDDEN` on `session`, `identify`, and `page-view` (`requestOriginMatchesEmbed`) |
| Host page sets another workspace’s visitor | Embed key resolves workspace server-side; identify cannot pass `workspace_id` / `visitor_id` |
| XSS via `current_title` / URL in sidebar | Sanitize/bound on write; React text encoding on read; no HTML from page titles |
| Prototype pollution via attributes | Reject `__proto__` / `constructor` / `prototype` and reserved identity keys |
| Cross-tenant contact SELECT | RLS `workspace_is_accessible`; pgTAP negative tests |
| Viewer elevates to edit PII | `update_visitor_profile` requires messaging role (`owner`/`admin`/`agent`) |
| Widget RPC abuse from browser JWT | `widget_identify_visitor` / `widget_record_page_view` / session create: **service_role only**; all `app_private` helper functions have `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated` |

See [VISITOR-IDENTITY.md](./VISITOR-IDENTITY.md) and [PRIVACY.md](./PRIVACY.md).

---

## 5. Widget Security

### 5.1 Embed Security

The widget runs on untrusted third-party websites. Assumptions:
- Host site JavaScript may be malicious or compromised.
- Host site may attempt to impersonate the widget or intercept communications.
- Visitors may use browser extensions that modify page behavior.

**Controls:**

| Control | Detail |
|---------|--------|
| iframe isolation | Widget UI runs in iframe on `widget.sitechat.com` origin |
| sandbox attribute | `sandbox="allow-scripts allow-same-origin allow-forms allow-popups"` — no top navigation |
| postMessage validation | Both iframe and loader validate `event.origin` before processing messages |
| CSP on widget routes | `default-src 'self'; script-src 'self'; frame-ancestors` dynamically set per workspace allowlist |
| No sensitive data in loader.js | Loader contains only workspace ID; config fetched after origin validation |

### 5.2 Domain Allowlist

- Each workspace maintains a list of allowed domains in `allowed_domains`.
- Every widget API request validates the `Origin` or `Referer` header against this list.
- Wildcard subdomains supported (`*.example.com`).
- Localhost allowed in development/staging environments only.
- Domain changes logged in audit trail.

### 5.3 Rate Limiting

Widget API endpoints are rate limited to prevent abuse:

| Endpoint | Limit |
|----------|-------|
| `POST /widget/init` | 30 requests/minute per IP |
| `POST /widget/messages` | 60 requests/minute per session |
| `POST /widget/attachments` | 10 requests/minute per session |

Implementation: Vercel Edge Middleware with Upstash Redis sliding window counter. Rate limit headers included in responses (`X-RateLimit-Remaining`).

### 5.4 Widget Studio configuration and assets

Widget Studio uses a deny-by-default publication boundary:

- `widget_configs` / `widget_assets` have FORCE RLS and workspace-scoped SELECT policies. Authenticated INSERT/UPDATE/DELETE on `widget_assets` is closed.
- Dashboard context derives the workspace from authenticated membership and the URL slug. `view_widget_studio` allows read-only access; `manage_widget_studio` is owner/admin only.
- Draft mutations use authenticated SECURITY DEFINER RPCs with locked `search_path`. `app_private` execute is revoked from `PUBLIC`, `anon`, and `authenticated` except intentional RLS helpers.
- The service-role public-key resolver is server-only. Visitor endpoints cannot call the underlying database function directly.
- Visitor mapping selects only `published_json` and explicitly constructs `widgetPublicAppearanceSchema`; it never serializes a table row or `settings_json`.
- The public DTO allows appearance, behavior, localized copy, business-hours foundation, version/timestamp, compatibility branding aliases, and signed asset URLs. It excludes draft state, actors, storage keys, members/operator emails, billing/Stripe, CRM, AI, privacy settings, secrets, and credentials.
- `GET /api/v1/widget/config` requires a valid public key and allowed origin, is rate-limited, and uses a published-version plus signing-bucket ETag. It returns no embed token.

Brand uploads accept raster PNG/JPEG/WebP only, up to 512 KiB and 16–1024 px. Initiation requires `manage_widget_studio`; after that application check, a server-only service-role path creates a `pending` row and a 10-minute signed upload URL. Completion re-downloads the object, verifies exact size, magic bytes, and dimensions, then sets `status = 'verified'` and `verified_at`; failures become rejected. Public delivery signs for one hour only when a non-deleted asset is explicitly verified, its workspace/kind match the published UUID reference, and its immutable `storage_key` has the required workspace prefix. The bucket is private and has no anon/authenticated object policy. Config cannot contain arbitrary remote asset URLs; legacy logo URLs are ignored.

See [WIDGET-STUDIO.md](./WIDGET-STUDIO.md) and [ADR-009](./adr/ADR-009-widget-studio-draft-publish.md).

---

## 6. Input Validation and Output Encoding

### 6.1 API Input Validation

All API inputs validated with Zod schemas before processing:
- Type coercion disabled (`strict()` mode).
- String length limits enforced at schema level.
- UUID format validated for all ID parameters.
- Email format validated with RFC 5322 compliant regex.

### 6.2 Message Content

**MVP policy:** Messages are plain text only. No HTML, Markdown rendering, or rich text in visitor messages.

- Maximum body length: 4,000 characters.
- Null bytes and control characters stripped.
- Dashboard renders message body via React text nodes (automatic escaping).
- Post-MVP Markdown support will use a sanitizing renderer (DOMPurify with strict allowlist).

### 6.3 File Upload Validation

| Check | Method |
|-------|--------|
| File size | Rejected if > plan limit (10 MB default) |
| MIME type | Validated via magic bytes (`file-type` library), not Content-Type header |
| Filename | Sanitized; path traversal characters rejected |
| Allowed types | Whitelist: JPEG, PNG, GIF, WebP, PDF, plain text, CSV |

### 6.4 SQL Injection

All database access via Supabase client with parameterized queries. No dynamic SQL in application code. Migrations use static SQL only.

---

## 7. Transport and Network Security

### 7.1 TLS

- All traffic over HTTPS. HTTP redirects to HTTPS.
- TLS 1.2 minimum; TLS 1.3 preferred.
- HSTS enabled with `max-age=31536000; includeSubDomains`.

### 7.2 HTTP Security Headers

Applied via Next.js middleware and Vercel configuration:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY (dashboard); ALLOW-FROM for widget (via CSP frame-ancestors)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: [route-specific, see below]
```

**Dashboard CSP:**
```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
connect-src 'self' *.supabase.co wss://*.supabase.co;
img-src 'self' data: blob: *.supabase.co;
frame-src 'none';
```

**Widget CSP:**
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
connect-src 'self' *.supabase.co wss://*.supabase.co;
img-src 'self' data: blob: *.supabase.co;
frame-ancestors [dynamic: workspace allowed domains];
```

### 7.3 CORS

- Dashboard API: same-origin only (no CORS headers).
- Widget API: CORS allows origins matching workspace domain allowlist. Preflight cached for 24 hours.

---

## 8. Secrets Management

### 8.1 Secret Classification

| Secret | Storage | Rotation |
|--------|---------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env (server) | Quarterly |
| `SUPABASE_JWT_SECRET` | Supabase dashboard | On compromise |
| `STRIPE_SECRET_KEY` | Vercel env (server) | On compromise |
| `STRIPE_WEBHOOK_SECRET` | Vercel env (server) | Per-endpoint rotation via Stripe |
| `RESEND_API_KEY` | Vercel env (server) | Quarterly |
| `WIDGET_JWT_SECRET` | Vercel env (server) | Quarterly |
| `SENTRY_AUTH_TOKEN` | Vercel env (CI) | Quarterly |

### 8.2 Client-Exposed Keys

Only the Supabase **anon key** and **project URL** are exposed to browser clients. These are designed for public exposure and rely on RLS for protection.

The anon key is scoped via RLS policies and Realtime authorization. It cannot bypass tenant isolation.

---

## 9. Audit Logging

### 9.1 Logged Events

| Event | Actor | Metadata |
|-------|-------|----------|
| `member.invited` | Admin/Owner | email, role |
| `member.removed` | Admin/Owner | removed member ID, role |
| `member.role_changed` | Admin/Owner | member ID, old role, new role |
| `widget.settings_updated` | Admin/Owner | changed fields |
| `domain.added` | Admin/Owner | domain |
| `domain.removed` | Admin/Owner | domain |
| `conversation.exported` | Admin/Owner | conversation count, format |
| `contact.exported` | Admin/Owner | contact count |
| `billing.plan_changed` | Owner/System | old plan, new plan |
| `auth.login_new_device` | User | user agent, IP |

### 9.2 Audit Log Properties

- **Append-only:** No UPDATE or DELETE policies for tenant users. Platform operators cannot modify tenant audit logs.
- **Tamper-evident:** Consider hash chaining for audit logs in post-MVP hardening phase.
- **Retention:** Plan-dependent (90 days Starter, 2 years Team/Business). Automated purge after retention period.

### 9.3 Access

Audit logs viewable by Owner, Admin, and Viewer roles. Agents cannot view audit logs.

---

## 10. Data Protection and Privacy

### 10.1 Data Classification

| Classification | Examples | Handling |
|----------------|----------|----------|
| Public | Marketing content, pricing | No restrictions |
| Internal | Application logs, metrics | Access restricted to platform operators |
| Confidential | Message content, contact emails | Encrypted at rest (Supabase default), RLS-protected |
| Restricted | Service role keys, Stripe secrets | Secrets manager, never logged |

### 10.2 Encryption

- **At rest:** Supabase encrypts PostgreSQL storage and Storage objects at rest (AES-256).
- **In transit:** TLS 1.2+ for all connections.
- **Application-level encryption:** Not used in MVP. Considered for particularly sensitive custom attributes in future.

### 10.3 Personal Data Handling

Site Chat processes personal data on behalf of workspace customers (data processors under GDPR):

| Data | Subject | Retention |
|------|---------|-----------|
| Visitor email/name/phone | Website visitor | Workspace-configurable (default 12 months); see DATA-RETENTION |
| Visitor page views / session context | Website visitor | Bounded; configurable retention (future purge job) |
| Visitor IP address | — | **Not stored** on visitor sessions by default |
| Agent email | Workspace member | Duration of membership + 30 days |
| Message content | Visitor and agent | Workspace-configurable (default 12 months) |

**Data subject rights (GDPR):**
- **Access:** Workspace Owner can export contact and conversation data.
- **Deletion:** Workspace Owner can delete contacts; deletion cascades to linked sessions. Full workspace deletion available.
- **Portability:** CSV export for contacts and conversations.

### 10.4 Data Processing Agreement

A DPA template will be provided to Business tier customers. MVP launch includes a privacy policy and terms of service covering data processing roles.

---

## 11. Billing Security

### 11.1 Stripe Integration Security

- Stripe Checkout and Customer Portal handle all payment data. Site Chat never stores card numbers, CVV, or bank details.
- PCI compliance scope: SAQ A (Stripe handles card data).
- Webhook endpoint validates Stripe signature on every request.
- Webhook events deduplicated via `stripe_webhook_events` table.
- Subscription state changes applied idempotently.

### 11.2 Entitlement Bypass Prevention

- Plan limits enforced in application middleware AND database constraints.
- Direct database manipulation (service role) is the only bypass; service role usage is logged and restricted to trusted server code.
- Workspace suspension (billing failure) enforced via RLS policy that checks `workspace_subscriptions.status NOT IN ('suspended')` for write operations.

---

## 12. Incident Response

### 12.1 Detection

- Sentry alerts on error rate anomalies.
- Audit log review for suspicious patterns (mass export, role changes).
- Supabase dashboard monitoring for unusual query patterns.
- Stripe radar for payment fraud.

### 12.2 Response Procedure

1. **Identify:** Confirm incident scope via logs, Sentry, audit trail.
2. **Contain:** Revoke compromised tokens/keys; suspend affected workspaces if needed.
3. **Eradicate:** Patch vulnerability; rotate secrets.
4. **Recover:** Restore service; verify tenant isolation intact.
5. **Notify:** Affected customers notified within 72 hours if personal data was compromised (GDPR requirement).
6. **Review:** Post-incident review documented; controls updated.

### 12.3 Secret Compromise Procedure

If any server secret is compromised:
1. Rotate secret immediately in Vercel/Supabase.
2. Redeploy all environments.
3. Invalidate all active sessions if JWT secret compromised.
4. Review audit logs for unauthorized access during exposure window.

---

## 13. Dependency and Supply Chain Security

### 13.1 Dependency Management

- Dependabot enabled for npm dependencies.
- Critical and high CVEs patched within 48 hours.
- Lock file (`pnpm-lock.yaml`) committed; CI installs with `--frozen-lockfile`.
- No dependencies with known critical vulnerabilities allowed in production builds (CI gate).

### 13.2 CI/CD Security

- GitHub branch protection on `main`: require PR review, passing CI.
- Vercel preview deployments for all PRs; no direct production deploys.
- Environment secrets scoped per environment (preview cannot access production secrets).
- Service role key not available in preview deployments unless explicitly needed for integration tests.

---

## 14. Compliance Roadmap

| Standard | MVP | Target |
|----------|-----|--------|
| GDPR | Privacy controls, export, deletion | Full compliance at launch |
| CCPA | Covered by GDPR controls | Launch |
| SOC 2 Type II | Controls designed-in | 12 months post-launch |
| HIPAA | Not supported | Not planned |
| PCI DSS | SAQ A via Stripe | Launch |

---

## 15. Security Testing

### 15.1 Automated Testing

- RLS policy tests: verify cross-tenant access fails for every table.
- API authorization tests: verify each role can/cannot perform gated actions.
- Input validation tests: fuzz test message content, file uploads, API parameters.
- CI check: grep for service role key in client bundles.

### 15.2 Manual Testing

- Penetration test before public launch (external firm or structured internal test).
- Widget security review: origin bypass attempts, token manipulation, XSS payloads in messages.
- Stripe webhook replay and forgery attempts.

### 15.3 Ongoing

- Quarterly dependency audit.
- Annual penetration test once SOC 2 preparation begins.
- Security review required for all PRs touching auth, RLS, widget, or billing code.
