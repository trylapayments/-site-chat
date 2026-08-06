# Site Chat — Security Model

**Version:** 1.0  
**Status:** Foundation  
**Last updated:** 2026-07-30

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

### 3.4 Permission Matrix (Detailed)

See [PRD.md](./PRD.md) Section 3 for the user-facing permission matrix. Implementation notes:

| Action | Implementation |
|--------|----------------|
| Manage billing | Check `role = 'owner'` in Server Action; Stripe Customer Portal session created server-side |
| Invite member | Check `role IN ('owner', 'admin')`; verify seat limit against subscription |
| Send message | Check active membership + `role IN ('owner', 'admin', 'agent')` |
| View audit logs | Check `role IN ('owner', 'admin', 'viewer')` |
| Export data | Check `role IN ('owner', 'admin')`; log audit event |

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

**Typing / presence (PR 4D-2):** Client publish is authorized at **topic + extension** granularity (`broadcast` / `presence`), not per event name. A scoped visitor JWT may therefore publish any Broadcast event on its own `widget-conversation:{topic}` channel (including forged `message.created`). Cross-tenant isolation remains enforced by exact topic matching. Receivers must validate payloads and filter by expected `actorRole` / `role`; do not treat ephemeral Broadcast/Presence metadata as authenticated identity. Durable message authority remains PostgreSQL + HTTP catch-up.

### 4.4 Cross-Tenant Attack Scenarios

| Attack | Mitigation |
|--------|------------|
| User guesses another workspace's conversation UUID | RLS blocks SELECT; UUID alone is insufficient |
| Widget sends messages to another workspace's conversation | Session token encodes workspace ID; mismatch rejected |
| Agent manipulates workspace_id in API request | RLS blocks; middleware validates membership for requested workspace |
| Service role query without workspace filter | Code review + lint rule; integration tests verify isolation |

Integration tests include explicit cross-tenant access attempts that must fail.

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
| Visitor email/name | Website visitor | Workspace-configurable (default 12 months) |
| Visitor IP address | Website visitor | 90 days clear text, then hashed |
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
