# Site Chat — Product Requirements Document

**Version:** 1.0  
**Status:** Foundation  
**Last updated:** 2026-07-30

---

## 1. Product Overview

### 1.1 Vision

Site Chat is a multi-tenant SaaS live chat platform that enables businesses to engage website visitors in real time. Operators manage conversations from a unified dashboard; visitors interact through an embeddable widget installed on customer websites.

The product is designed for long-term commercial operation: predictable pricing, reliable uptime, tenant isolation, and an operator experience that scales from solo founders to support teams of dozens.

### 1.2 Problem Statement

Businesses lose leads and customer trust when website visitors cannot get immediate answers. Email and contact forms introduce delay. Enterprise live chat tools are expensive, complex, or poorly suited to small and mid-size teams. Site Chat fills the gap with a focused product: install a widget, assign agents, and start conversations without operational overhead.

### 1.3 Target Customers

| Segment | Profile | Primary need |
|---------|---------|--------------|
| SMB | 1–20 employees, 1–5 support agents | Affordable live chat with minimal setup |
| Mid-market | 20–200 employees, dedicated support team | Multi-agent routing, canned responses, audit trail |
| Agencies | Manage chat for multiple client sites | Workspace isolation, per-client configuration |

### 1.4 Product Principles

1. **Tenant isolation is non-negotiable.** No workspace may read or modify another workspace's data.
2. **Realtime is core, not optional.** Message delivery must feel instant under normal network conditions.
3. **Widget load must not harm host sites.** The embed script must be lightweight, async, and isolated from host page styles.
4. **Operators should need minimal training.** The dashboard follows familiar inbox patterns.
5. **Billing maps to value.** Subscription tiers align with agent count, conversation volume, and feature access.

---

## 2. User Personas

### 2.1 Workspace Owner

Creates the workspace, connects billing, invites team members, and owns account-level decisions including plan changes and workspace deletion. Typically a founder, operations lead, or agency principal.

### 2.2 Workspace Admin

Manages day-to-day configuration: widget appearance, allowed domains, canned responses, agent roster, and notification rules. Does not necessarily handle billing.

### 2.3 Agent

Handles live conversations: replies to visitors, assigns or transfers conversations, uses canned responses, and uploads attachments. May work across multiple concurrent conversations depending on plan limits.

### 2.4 Viewer

Read-only access to conversations, contacts, and audit logs. Intended for managers, compliance reviewers, or trainees observing without sending messages.

### 2.5 Website Visitor

Anonymous or identified end user on a customer's website. Initiates chat via the widget, may provide contact details during or after the conversation, and receives realtime message updates.

---

## 3. User Roles and Permissions

Roles are scoped to a **workspace**. A single user may belong to multiple workspaces with different roles in each.

| Capability | Owner | Admin | Agent | Viewer |
|------------|:-----:|:-----:|:-----:|:------:|
| Manage billing and subscription | ✓ | — | — | — |
| Delete workspace | ✓ | — | — | — |
| Transfer workspace ownership | ✓ | — | — | — |
| Invite and remove members | ✓ | ✓ | — | — |
| Change member roles | ✓ | ✓ | — | — |
| Configure widget and domains | ✓ | ✓ | — | — |
| Manage canned responses | ✓ | ✓ | ✓ | — |
| Send and receive messages | ✓ | ✓ | ✓ | — |
| Assign and transfer conversations | ✓ | ✓ | ✓ | — |
| View conversations | ✓ | ✓ | ✓ | ✓ |
| View contacts | ✓ | ✓ | ✓ | ✓ |
| View audit logs | ✓ | ✓ | — | ✓ |
| Export data | ✓ | ✓ | — | — |

Platform operators (Site Chat staff) use a separate internal admin surface not exposed to tenant users. That surface is out of MVP scope but reserved in the security model.

---

## 4. Feature Specifications

### 4.1 Website Chat Widget

**Purpose:** Embeddable interface on customer websites for visitor-initiated chat.

**Requirements:**

- Single JavaScript snippet installed via `<script>` tag; no build step required on the host site.
- Widget loads asynchronously and does not block host page rendering.
- Styles are scoped (Shadow DOM or equivalent) to prevent CSS conflicts with host sites.
- Configurable per workspace: primary color, position (bottom-right/bottom-left), greeting message, offline message, and visibility rules (e.g., show only on specific URL patterns).
- Domain allowlist enforced server-side; requests from unlisted origins are rejected.
- Supports anonymous sessions; optionally prompts for name and email before or during chat.
- Displays message history for the current browser session.
- Supports file attachments within plan limits (type and size restrictions enforced server-side).
- Graceful degradation when WebSocket/realtime connection is unavailable (queued sends with retry, connection status indicator).
- Mobile-responsive layout.

**Out of scope for MVP:** Proactive triggers (time-on-page, scroll depth), co-browsing, video/voice.

### 4.2 Operator Dashboard

**Purpose:** Web application where workspace members manage conversations and configuration.

**Requirements:**

- Authenticated access via email/password (Supabase Auth); social login deferred to post-MVP.
- Workspace switcher for users belonging to multiple workspaces.
- Unified inbox listing conversations sorted by last activity, with filters: open, pending, resolved, unassigned, assigned to me.
- Conversation detail view: full message thread, visitor metadata, contact link, assignment controls, status changes, internal notes (visible only to agents, not visitors).
- Realtime updates for new messages, assignment changes, and typing indicators.
- Agent presence indicator (online, away, offline) based on dashboard activity and explicit status.
- Notification center for missed conversations, assignments, and mentions.
- Settings pages segmented by permission: widget, team, canned responses, notifications, billing (Owner only).

### 4.3 Workspaces (Companies)

**Purpose:** Top-level tenant boundary. All data belongs to exactly one workspace.

**Requirements:**

- Created during signup; user becomes Owner.
- Unique slug for URL routing (e.g., `/app/acme-corp/inbox`).
- Workspace settings stored as structured JSON with schema validation.
- Soft-delete with 30-day retention before hard purge (billing must be canceled first).
- Plan limits enforced at workspace level (agent seats, monthly conversations, storage quota).

### 4.4 Agents (Team Members)

**Purpose:** Users who operate within a workspace.

**Requirements:**

- Invited by email; invitation expires after 7 days.
- Accepting an invitation creates or links a Supabase Auth user and a `workspace_members` record.
- Role assigned at invite time; changeable by Owner/Admin.
- Deactivating a member revokes access immediately; open conversations assigned to them become unassigned.
- Agent seat count enforced against subscription tier.

### 4.5 Conversations

**Purpose:** Threaded exchange between a visitor and one or more agents within a workspace.

**Requirements:**

- Created when a visitor sends the first message or opens chat (configurable).
- States: `open`, `pending` (awaiting visitor reply), `resolved`, `closed`.
- Assignment: optional single assignee (agent). Unassigned conversations appear in a shared queue.
- Metadata: created timestamp, last activity timestamp, source URL, referrer, assigned agent, linked contact, linked visitor session.
- Transfer: agent or admin reassigns to another agent with optional note.
- Resolution: agent marks resolved; visitor can reopen by sending a new message within a configurable window (default 24 hours).
- Full-text search across message content (post-MVP enhancement; MVP uses timestamp and contact name filters).

### 4.6 Realtime Messaging

**Purpose:** Sub-second delivery of messages between widget and dashboard.

**Requirements:**

- Powered by Supabase Realtime (PostgreSQL changes + broadcast channels).
- Message ordering guaranteed per conversation via monotonic sequence numbers.
- Delivery states: `sent`, `delivered` (recipient client acknowledged), `failed` (with retry).
- Typing indicators with 5-second TTL.
- Read receipts for agent-side viewing (visitor read state post-MVP).
- Maximum message body length: 4,000 characters plain text; markdown rendering in dashboard only for MVP.

### 4.7 File Attachments

**Purpose:** Share files within a conversation.

**Requirements:**

- Stored in Supabase Storage under workspace-scoped paths.
- Allowed types for MVP: images (JPEG, PNG, GIF, WebP), PDF, plain text, CSV. Maximum file size: 10 MB (configurable per plan).
- Virus scanning deferred; MIME type validated server-side via magic bytes, not just extension.
- Attachments generate time-limited signed URLs for download; URLs are not permanently public.
- Thumbnail generation for images in dashboard (post-MVP; MVP shows full image inline if under size threshold).

### 4.8 Visitor Sessions

**Purpose:** Track anonymous or identified visitors across page loads within a browser.

**Requirements:**

- Session token stored in first-party cookie scoped to the widget iframe/origin, not the host site domain.
- Session persists across page navigations on the same site within 30-day window.
- Captured metadata: user agent, IP address (hashed at rest after 90 days for privacy), initial landing URL, current page URL, referrer, timezone, language.
- Session linked to at most one active open conversation at a time; reopening creates a new conversation after prior resolution.
- GDPR: workspace Owner can configure data retention period (default 12 months).

### 4.9 Contacts

**Purpose:** Persistent record of a visitor who has provided identifying information.

**Requirements:**

- Created manually by agents or automatically when a visitor provides email/name.
- Fields: email (unique per workspace), name, phone (optional), custom attributes (JSON, schema defined per workspace post-MVP).
- Linked to one or more visitor sessions and conversations.
- Merge duplicate contacts by email (Admin action).
- Export contacts as CSV (Owner/Admin).

### 4.10 Canned Responses

**Purpose:** Pre-written reply snippets to accelerate agent responses.

**Requirements:**

- Scoped to workspace; not shared across workspaces.
- Fields: title, body (plain text with variable placeholders), shortcut (e.g., `/greeting`), category (optional), created by, usage count.
- Variables for MVP: `{{visitor.name}}`, `{{agent.name}}`, `{{workspace.name}}`.
- Accessible via shortcut autocomplete in the message composer.
- CRUD restricted to Admin and above; Agents have read and use access.

### 4.11 Notifications

**Purpose:** Alert agents to events requiring attention.

**Requirements:**

- In-app notification center with unread count badge.
- Email notifications via Resend for: new unassigned conversation, conversation assigned to you, mention in internal note (post-MVP).
- Per-agent notification preferences: email on/off per event type, quiet hours.
- Notifications stored in database for 90 days.
- Push notifications (browser/mobile) deferred to post-MVP.

### 4.12 Stripe Subscriptions

**Purpose:** Monetize the platform with recurring billing.

**Requirements:**

- Plans (initial tiers):

  | Plan | Agent seats | Monthly conversations | Storage | Price |
  |------|-------------|----------------------|---------|-------|
  | Starter | 2 | 500 | 1 GB | $29/mo |
  | Team | 10 | 5,000 | 10 GB | $99/mo |
  | Business | 25 | 25,000 | 50 GB | $249/mo |

- 14-day free trial on Starter; no credit card required to start trial.
- Stripe Checkout for initial subscription; Stripe Customer Portal for plan changes, payment method updates, and invoice history.
- Webhook handlers for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`.
- Grace period: 3 days after payment failure before restricting write operations; 7 days before read-only; 14 days before workspace suspension.
- Usage metering: conversation count resets monthly; overage blocked (hard limit) for MVP rather than overage billing.
- Entitlements synced to `workspace_subscriptions` table; enforced in API middleware and RLS policies.

### 4.13 Audit Logs

**Purpose:** Immutable record of security-relevant and configuration actions.

**Requirements:**

- Logged events: member invited/removed/role changed, widget settings changed, domain allowlist changed, conversation exported, contact exported, billing plan changed, login from new device, API key created/revoked (post-MVP).
- Fields: timestamp, actor user ID, workspace ID, action type, resource type, resource ID, IP address, metadata JSON.
- Append-only; no updates or deletes by tenant users.
- Retention: 2 years on Team and Business plans; 90 days on Starter.
- Viewable by Owner, Admin, and Viewer roles.

---

## 5. Non-Functional Requirements

### 5.1 Performance

| Metric | Target |
|--------|--------|
| Widget script load (gzip) | < 30 KB |
| Widget time-to-interactive | < 500 ms on 4G |
| Message delivery latency (p95) | < 300 ms |
| Dashboard initial load (LCP) | < 2.5 s |
| API response time (p95) | < 200 ms for reads, < 500 ms for writes |

### 5.2 Availability

- Target uptime: 99.9% monthly (excluding scheduled maintenance).
- Scheduled maintenance announced 72 hours in advance.
- Database backups: continuous (Supabase PITR) with 7-day recovery window.

### 5.3 Scalability

- Architecture supports 10,000 active workspaces and 100,000 concurrent widget connections without redesign.
- Horizontal scaling via Vercel serverless functions and Supabase connection pooling (PgBouncer).

### 5.4 Compliance and Privacy

- GDPR-ready: data export, deletion requests, consent for visitor tracking configurable per workspace.
- SOC 2 Type II is a post-MVP goal; security controls are designed with this audit in mind.
- Data residency: US region for MVP (Supabase US East); EU region planned for Business tier.

### 5.5 Observability

- Error tracking via Sentry (client, server, edge).
- Structured logging with correlation IDs on all API requests.
- Metrics: conversation volume, message throughput, widget load errors, webhook processing latency.

---

## 6. Success Metrics

### 6.1 Business

- Monthly Recurring Revenue (MRR)
- Trial-to-paid conversion rate (target: 15% within 30 days)
- Net revenue retention (target: > 100% at 12 months)
- Churn rate (target: < 5% monthly for paid accounts)

### 6.2 Product

- Time from signup to first conversation (target: < 15 minutes median)
- Median first response time across all workspaces
- Agent daily active usage (DAU/MAU ratio target: > 40%)
- Widget load success rate (target: > 99.5%)

### 6.3 Technical

- Error rate (target: < 0.1% of API requests)
- Realtime message delivery success rate (target: > 99.9%)
- p95 message latency (target: < 300 ms)

---

## 7. Explicit Non-Goals (MVP)

The following are intentionally excluded from the MVP release:

- Mobile native apps (iOS/Android)
- AI-powered suggested replies or chatbots
- Knowledge base / help center integration
- CRM integrations (Salesforce, HubSpot)
- Multi-language operator interface
- Custom SSO (SAML/OIDC)
- Public REST API for third-party integrations
- WhatsApp, SMS, or social channel routing
- SLA dashboards and advanced analytics
- White-label / custom domain for dashboard

These items appear on the roadmap where appropriate.

---

## 8. Glossary

| Term | Definition |
|------|------------|
| Workspace | A tenant account representing one business customer of Site Chat |
| Agent | A workspace member who handles conversations |
| Visitor | An end user on a customer's website who interacts with the widget |
| Conversation | A message thread between a visitor and agents |
| Widget | The embeddable JavaScript chat interface |
| Session | A browser-scoped visitor identity persisted via cookie |
| Contact | A persistent visitor record with identifying information |
| Canned response | A pre-written message template for agents |
