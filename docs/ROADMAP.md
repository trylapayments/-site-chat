# Site Chat — Product Roadmap

**Version:** 1.1  
**Status:** Foundation  
**Last updated:** 2026-08-10

---

## 1. Roadmap Overview

This document defines the phased delivery plan for Site Chat from foundation through general availability and beyond. Phases are sequenced by dependency and customer value, not calendar dates. Each phase has explicit entry criteria, deliverables, and exit criteria.

Site Chat is a commercial product intended for decade-long maintenance. The roadmap balances speed to market with architectural decisions that avoid costly rewrites.

---

## 2. MVP Definition

The Minimum Viable Product is the smallest feature set that a paying customer can use to replace an existing live chat tool for a single website with a small support team.

### 2.1 MVP Includes

| Feature | Scope |
|---------|-------|
| Workspace signup and creation | Owner signup, workspace slug, 14-day trial |
| Team management | Invite agents by email, roles (owner, admin, agent, viewer) |
| Widget embed | Script tag, iframe widget, domain allowlist, basic customization (color, position, greeting) |
| Visitor chat | Anonymous sessions, send/receive text messages, session persistence |
| Operator inbox | Conversation list, detail view, realtime updates, assignment, status changes |
| Realtime messaging | Sub-second delivery via Supabase Realtime, typing indicators |
| File attachments | Images and PDF, 10 MB limit, signed URLs |
| Contacts | Auto-create on email capture, manual create, view linked conversations |
| Canned responses | CRUD, shortcut autocomplete, variable substitution |
| Notifications | In-app notification center, email for new/assigned conversations |
| Stripe billing | Starter and Team plans, trial, checkout, customer portal, webhook sync |
| Audit logs | Core events logged, viewable by owner/admin/viewer |
| Authentication | Email/password login, password reset, invite acceptance |

### 2.2 MVP Excludes

| Feature | Rationale |
|---------|-----------|
| Visitor-facing AI chatbot / auto-replies | Higher safety scope; operator Suggested Replies ships first on the AI foundation |
| Mobile apps | Web dashboard is responsive; native apps are expensive |
| CRM integrations | Manual workflow sufficient for early customers |
| Custom SSO | Enterprise feature; email auth covers SMB/mid-market |
| Public API | No third-party integration demand yet |
| Proactive chat triggers | Nice-to-have; increases widget complexity |
| Multi-language UI | English-only acceptable for initial market |
| Advanced analytics | Basic conversation counts sufficient |
| White-label dashboard | Agency feature for later phase |
| Markdown/rich text messages | Plain text reduces XSS surface for MVP |
| Read receipts | Low priority vs. delivery reliability |
| Browser push notifications | Email + in-app sufficient for MVP |

### 2.3 MVP Success Criteria

The MVP is complete when:

1. A new user can sign up, embed the widget, and receive a visitor message within 15 minutes without support assistance.
2. Two agents in the same workspace can both see and reply to conversations in realtime.
3. A customer can subscribe to a paid plan via Stripe and have entitlements enforced (agent seats, conversation limits).
4. Cross-tenant isolation verified by automated RLS test suite with zero failures.
5. Widget load time under 500 ms p95 on simulated 4G connection.
6. Message delivery latency under 300 ms p95 in staging load test (100 concurrent conversations).
7. Zero critical or high severity open security findings from pre-launch review.

---

## 3. Development Phases

### Phase 0: Foundation

**Goal:** Project infrastructure, documentation, and development environment ready for feature work.

**Deliverables:**
- [x] Product documentation (PRD, Architecture, Database, Security, Roadmap)
- [ ] Monorepo scaffolding (Next.js app, shared packages, widget package)
- [ ] Supabase project setup (local + staging)
- [ ] CI/CD pipeline (lint, typecheck, test, preview deploy)
- [ ] Database migrations for core schema (workspaces, members, plans)
- [ ] Authentication flows (signup, login, logout, password reset)
- [ ] shadcn/ui design system setup with Tailwind config
- [ ] Sentry integration (client + server)
- [ ] Environment configuration (.env.example, Vercel env setup)

**Exit criteria:** Developer can clone repo, run locally, sign up, and land on an empty dashboard shell authenticated against staging Supabase.

---

### Phase 1: Core Messaging

**Goal:** End-to-end message flow from widget to dashboard and back.

**Deliverables:**
- [ ] Workspace creation on signup with trial subscription
- [ ] Domain allowlist management (settings UI + validation)
- [ ] Widget loader script and iframe host page
- [ ] Widget init API (session creation, origin validation)
- [ ] Visitor session management (create, resume, expire)
- [ ] Conversation creation on first visitor message
- [ ] Message send/receive (widget API + dashboard Server Actions)
- [ ] Supabase Realtime subscriptions (conversation channel)
- [ ] Dashboard inbox page (conversation list, sorted by last activity)
- [ ] Dashboard conversation detail page (message thread)
- [ ] Agent message sending from dashboard
- [ ] Conversation status management (open, pending, resolved)
- [ ] Basic widget customization (color, position, greeting message)

**Exit criteria:** Widget embedded on a test site sends a message that appears in the dashboard inbox in realtime; agent reply appears in the widget in realtime.

---

### Phase 2: Team and Roles

**Goal:** Multi-agent workspace with role-based access control.

**Deliverables:**
- [ ] Agent invitation flow (email via Resend, token acceptance)
- [ ] Workspace member management UI (list, change role, deactivate)
- [ ] Role-based UI gating (hide actions user cannot perform)
- [ ] RLS policies for all core tables with role enforcement
- [ ] Conversation assignment (assign to agent, unassigned queue)
- [ ] Agent presence (online/offline based on dashboard activity)
- [ ] Workspace switcher for multi-workspace users
- [ ] Typing indicators (broadcast channel)
- [ ] Internal notes on conversations (agent-only messages)

**Exit criteria:** Owner invites two agents; all three see shared inbox; assignment routes conversations correctly; viewer role can read but not write; RLS test suite passes.

---

### Phase 3: Productivity Features

**Goal:** Tools that make agents efficient and workspaces configurable.

**Deliverables:**
- [ ] Canned responses CRUD and autocomplete in composer
- [ ] Variable substitution in canned responses
- [x] Contact / visitor identity foundation (opaque `public_id`, auto-create on session, widget identify, operator profile update)
- [x] Visitor context (session device/UTM fields, `visitor_page_views`, page-view API + 30s dedupe)
- [ ] Contact list page with linked conversations
- [ ] Visitor identification UX polish in widget (name/email prompt UI)
- [x] File attachment upload (widget + dashboard)
- [x] Attachment display (inline images, download links)
- [ ] Storage quota enforcement
- [ ] Notification center (in-app, unread count)
- [ ] Email notifications via Resend (configurable per agent)
- [ ] Notification preferences UI

**Notes:** This phase’s identity + context foundation (docs + schema/RPCs) delivers durable visitor contacts, host `SiteChat.identify`, page-view trail, and privacy defaults (no raw IP / no fingerprinting). Remaining work: contacts list UI, widget prompt UX, and retention purge jobs (`docs/DATA-RETENTION.md`).

**Exit criteria:** Agent uses canned response with visitor name variable; visitor uploads image visible in dashboard; contact created automatically when visitor provides email; agent receives email notification for new conversation.

---

### Phase 4: Billing and Compliance

**Goal:** Monetization live and audit trail operational.

**Deliverables:**
- [ ] Stripe Checkout integration (Starter and Team plans)
- [ ] Stripe Customer Portal (manage subscription, payment method, invoices)
- [ ] Webhook handlers (subscription lifecycle, payment failure)
- [ ] Entitlement enforcement (agent seats, conversation limits, storage)
- [ ] Grace period logic for failed payments
- [ ] Usage metering (conversation counter, storage counter)
- [ ] Billing settings page (Owner only)
- [ ] Trial expiration flow (prompt to add payment method)
- [ ] Audit log implementation (all defined events)
- [ ] Audit log viewer UI
- [ ] Data export (contacts CSV, conversations CSV)
- [ ] Privacy settings (visitor data retention configuration)

**Exit criteria:** Customer completes Stripe Checkout, plan limits enforced, payment failure triggers grace period, audit logs record billing and configuration changes, contact export produces valid CSV.

---

### Phase 5: Production Hardening

**Goal:** System ready for paying customers with confidence in reliability and security.

**Deliverables:**
- [ ] Rate limiting on all public API endpoints
- [ ] Widget performance optimization (< 30 KB loader, < 500 ms TTI)
- [ ] Error boundaries and graceful degradation in dashboard
- [ ] Widget offline/reconnect handling with message queue
- [ ] Load testing (100 concurrent conversations, 1000 widget inits/minute)
- [ ] Security review (RLS, widget origin, input validation, Stripe webhooks)
- [ ] E2E test suite (Playwright: signup → embed → chat → billing)
- [ ] Production environment setup (Vercel production, Supabase production)
- [ ] Monitoring and alerting (Sentry, uptime check, Stripe webhook failures)
- [ ] Runbooks (secret rotation, incident response, database restore)
- [ ] Legal pages (terms of service, privacy policy)
- [ ] Marketing landing page and pricing page

**Exit criteria:** All MVP success criteria met; E2E tests pass in staging; security review findings resolved; production environment deployed and smoke-tested.

---

### Phase 6: General Availability (GA)

**Goal:** Public launch with onboarding and support infrastructure.

**Deliverables:**
- [ ] Public launch (remove beta gating)
- [ ] Onboarding checklist in dashboard (embed widget, invite agent, send test message)
- [ ] Help documentation (widget installation guide, FAQ)
- [ ] Support email channel
- [ ] Business plan tier activated in Stripe
- [ ] Analytics instrumentation (signup funnel, activation metrics, message volume)
- [ ] Status page (e.g., Instatus or Better Uptime)

**Exit criteria:** First 10 paying customers onboarded without manual intervention; median time-to-first-conversation under 15 minutes.

---

## 4. Post-MVP Roadmap

Features below are prioritized for delivery after GA. Priority may shift based on customer feedback.

### 4.1 Near-Term (Phase 7–8)

| Feature | Value | Dependencies |
|---------|-------|--------------|
| Markdown message rendering (sanitized) | Richer agent replies | XSS-safe renderer |
| Read receipts | Visitor engagement visibility | Message delivery tracking |
| Conversation search (full-text) | Agent productivity | PostgreSQL tsvector index |
| Business hours / offline mode | Professional appearance | Widget visibility rules |
| Proactive chat triggers (time on page) | Lead capture | Widget rule engine |
| Browser push notifications | Faster agent response | Service worker, VAPID |
| Multi-language operator UI | International customers | i18n framework |
| Google/social login | Faster signup | Supabase Auth providers |
| Conversation tags and filters | Inbox organization | Schema addition |
| Agent performance metrics | Manager visibility | Analytics aggregation |

### 4.2 Mid-Term (Phase 9–10)

| Feature | Value | Dependencies |
|---------|-------|--------------|
| Public REST API | Integrations ecosystem | API key management, rate limiting, docs |
| Webhooks (outbound) | Customer automation | Event system, retry logic |
| CRM integrations (HubSpot, Salesforce) | Workflow embedding | Public API, OAuth |
| Slack notifications | Agent workflow fit | Slack app, OAuth |
| AI suggested replies | Agent efficiency | **Foundation shipped** — see `docs/AI-ARCHITECTURE.md`; expand models/settings UX |
| Chatbot / auto-responder | After-hours coverage | AI foundation, conversation routing, visitor-safe prompts |
| Custom attributes on contacts | Host identify attributes shipped (JSONB bounds); admin UI / CRM fields still later | Schema + identify RPCs exist; admin UI pending |
| SLA tracking and alerts | Enterprise support teams | Timer system, reporting |
| Advanced analytics dashboard | Business insights | Data warehouse or aggregation |
| SAML/OIDC SSO | Enterprise security requirement | Supabase Auth enterprise |

### 4.3 Long-Term (Phase 11+)

| Feature | Value | Dependencies |
|---------|-------|--------------|
| WhatsApp / SMS channels | Omnichannel support | Twilio/MessageBird, channel routing |
| Mobile native apps (iOS, Android) | Agent mobility | React Native or native, push infra |
| White-label / custom dashboard domain | Agency resale | Multi-domain routing, branding system |
| EU data residency | GDPR enterprise requirement | Supabase EU region, data routing |
| Dedicated database tenancy (Enterprise) | Maximum isolation | Provisioning automation |
| Knowledge base integration | Self-service deflection | KB product or integration |
| Co-browsing | High-touch sales support | Screen sharing protocol |
| SOC 2 Type II certification | Enterprise sales enabler | Audit, controls, documentation |
| Marketplace / app directory | Ecosystem growth | Public API, review process |

---

## 5. Technical Debt and Infrastructure Milestones

These items are not customer-facing features but are required for long-term maintainability.

| Milestone | Target phase | Description |
|-----------|--------------|-------------|
| OpenAPI spec generation | Phase 5 | Auto-generate from Route Handlers or maintain manually |
| Database query performance baseline | Phase 5 | EXPLAIN ANALYZE on all inbox and message queries |
| Widget bundle size budget in CI | Phase 5 | Fail CI if loader.js exceeds 30 KB gzipped |
| RLS test coverage 100% | Phase 2 | Every table, every policy, cross-tenant negative tests |
| Staging data anonymization | Phase 6 | Production-like staging without real customer data |
| Automated database backup verification | Phase 6 | Monthly restore test |
| Dependency audit automation | Phase 5 | CI fails on critical CVEs |
| Feature flags system | Phase 7 | Gradual rollout infrastructure (e.g., Vercel Flags or LaunchDarkly) |
| Multi-region evaluation | Phase 10 | Latency testing for EU customers |
| Read replica for analytics | Phase 9 | Offload reporting queries from primary |

---

## 6. Release Strategy

### 6.1 Branching and Deployment

- `main` branch is always deployable to staging.
- Production releases tagged (`v1.0.0`, `v1.1.0`).
- Feature flags control visibility of incomplete features in production.
- Database migrations applied before application deploy in all environments.

### 6.2 Beta Program

Between Phase 5 completion and GA:
- Invite-only access for 20–50 beta workspaces.
- Free access during beta in exchange for feedback.
- Weekly feedback sessions during beta.
- Beta feedback drives priority adjustments in post-MVP roadmap.

### 6.3 Versioning

Site Chat uses semantic versioning for API (`/api/v1/`) and application releases:
- **Major:** Breaking API changes, schema migrations requiring customer action.
- **Minor:** New features, backward-compatible API additions.
- **Patch:** Bug fixes, security patches.

---

## 7. Metrics and Review Cadence

### 7.1 Phase Gate Reviews

At the end of each phase, review:
- All deliverables complete against exit criteria.
- No unresolved critical bugs or security findings.
- Test coverage meets targets defined in Architecture doc.
- Documentation updated to reflect implemented behavior.

### 7.2 Post-Launch Reviews

Monthly review of:
- Activation metrics (signup → first conversation → paid conversion).
- Reliability metrics (uptime, error rate, message latency).
- Customer feedback themes.
- Roadmap priority adjustments.

Quarterly review of:
- Infrastructure costs vs. revenue.
- Security posture (dependency audit, access review).
- Technical debt backlog prioritization.

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Supabase Realtime latency under load | Medium | High | Load test in Phase 5; fallback polling in widget |
| Widget blocked by host site CSP | Medium | Medium | Document CSP requirements; offer CSP header helper |
| Stripe webhook delivery failures | Low | High | Idempotent handlers, retry queue, alerting |
| Cross-tenant data leak | Low | Critical | RLS + integration tests + security review |
| Slow agent adoption (UX friction) | Medium | High | Onboarding checklist, beta feedback loop |
| Conversation limit false positives | Medium | Medium | Clear usage dashboard, grace buffer before hard block |
| GDPR complaint from visitor | Low | High | Privacy controls, DPA, data deletion capability |

---

## 9. Team Assumptions

This roadmap assumes:
- One full-stack engineer can complete Phases 0–4 sequentially.
- Phase 5 benefits from a dedicated QA pass (internal or contracted).
- Design work for dashboard and widget is done incrementally alongside development using shadcn/ui defaults, with custom design polish before GA.
- No dedicated DevOps hire until post-GA scale demands it; Vercel and Supabase managed services cover infrastructure.

If team size increases, Phases 1–3 can be parallelized (widget track and dashboard track).
