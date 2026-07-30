# ADR-001: Multi-Tenancy Architecture

**Status:** Accepted  
**Date:** 2026-07-30  
**Deciders:** Site Chat Engineering  
**Supersedes:** None (first ADR)

---

## Context

Site Chat is a multi-tenant SaaS live chat platform. Each paying customer operates within an isolated **workspace** where agents manage conversations with website visitors through an embeddable widget. The platform must support thousands of workspaces on shared infrastructure while guaranteeing that no tenant can read, modify, or infer another tenant's data.

This decision is needed now because multi-tenancy is the foundational architectural choice that affects every subsequent design: database schema, authentication, authorization, realtime messaging, file storage, billing, audit logging, and future channel integrations. Changing tenancy models after launch would require a costly migration and risk data integrity. The first ADR establishes the long-term boundary before application code is written.

### Business Goals

- **Commercial viability.** Operate as a subscription SaaS with predictable unit economics. Infrastructure and operational costs must scale sub-linearly with tenant count.
- **Market reach.** Serve SMB teams, mid-market support organizations, and agencies managing multiple client sites from a single platform.
- **Customer trust.** Tenant isolation failures would destroy the product. Isolation must be provable through automated testing and auditable controls.
- **Time to market.** MVP must ship without provisioning per-customer infrastructure. Onboarding a new workspace must be instantaneous.
- **Pricing alignment.** Subscription tiers (Starter, Team, Business) map to workspace-level entitlements: agent seats, conversation volume, storage, and audit retention.
- **Regulatory readiness.** Support GDPR data export, deletion, and configurable retention without per-tenant infrastructure overhead.

### Technical Goals

- **Strong tenant isolation** enforced at the database layer, not solely in application code.
- **Single migration path** so schema evolution applies uniformly to all tenants.
- **Horizontal scalability** to 10,000 active workspaces and 100,000 concurrent widget connections without architectural redesign.
- **Supabase-native integration** leveraging PostgreSQL Row Level Security, Realtime, Storage, and Auth as a unified platform.
- **Defense in depth** with overlapping controls: middleware, application authorization, and database policies.
- **Future extensibility** for additional communication channels (WhatsApp, SMS, email), AI features, CRM integrations, white-label deployments, and a public API — all scoped to the same workspace boundary.

---

## Decision

Site Chat adopts a **shared PostgreSQL database, shared schema, row-level tenant isolation** model. The **workspace** is the tenant. Every tenant-scoped entity carries a `workspace_id` foreign key, and Supabase Row Level Security (RLS) policies enforce access boundaries for authenticated operators, visitor sessions, and background jobs.

### Shared PostgreSQL Database

All workspaces share a single PostgreSQL 15+ instance hosted on Supabase. One database serves all tenants in each environment (production, staging, local). Platform-wide reference data (plan definitions, feature flags) lives in the same database but is not tenant-scoped.

**Justification:** A single database eliminates per-tenant provisioning, simplifies backup and point-in-time recovery, enables cross-tenant platform analytics for operators, and aligns with Supabase's managed service model. Connection pooling via PgBouncer supports serverless deployment on Vercel without per-tenant connection overhead.

### Shared Schema

All tenants use identical table structures. There is no per-tenant schema variation. Schema changes are applied once via forward-only migrations and take effect for all workspaces simultaneously.

**Justification:** One schema means one migration pipeline, one set of RLS policies to test, and one query pattern to optimize. This dramatically reduces operational burden compared to managing hundreds or thousands of independent schemas or databases. Additive schema changes (new columns, new tables) deploy without tenant-specific coordination.

### Workspace ID Model

The workspace is the sole tenant boundary. Every mutable, tenant-owned record includes a non-null `workspace_id` referencing the workspaces table. There is no shared mutable data between workspaces except platform-level reference tables (e.g., plan definitions).

Workspace context propagates through every request path:

- **Dashboard requests** resolve workspace from URL slug, verify authenticated user membership, and attach workspace context before any data access.
- **Widget requests** bind to a workspace via embed configuration and validate origin against that workspace's domain allowlist.
- **Background jobs and webhooks** receive an explicit workspace identifier and never operate without it.

Denormalizing `workspace_id` onto child tables (e.g., messages) is acceptable where it improves RLS policy performance or simplifies query patterns.

**Justification:** A single, consistently named tenant key makes isolation auditable. Every query, policy, and index can be reasoned about in terms of `workspace_id`. This model maps directly to the product concept (a business customer account) and to billing (one Stripe customer per workspace).

### Supabase Row Level Security

RLS is enabled on every tenant-scoped table. RLS is the last line of defense against cross-tenant data leaks; application-layer checks provide user-facing authorization and business logic, but must not be the sole protection.

Policy design follows these principles:

- **Authenticated operators** access rows where `workspace_id` matches a workspace they belong to as an active member. Membership is resolved through a security-definer helper function querying `workspace_members`.
- **Role-gated mutations** restrict INSERT, UPDATE, and DELETE based on the member's role within the specific workspace (owner, admin, agent, viewer).
- **Visitor access** uses a separate database role with policies scoped to a single visitor session or conversation, set via session context variables validated by server-side Route Handlers before any direct database access.
- **Service role** bypasses RLS and is used exclusively in trusted server contexts after explicit authorization checks. It is never exposed to client bundles.
- **Storage objects** follow the same workspace prefix pattern with RLS mirroring database attachment records.
- **Realtime subscriptions** inherit RLS from underlying tables; clients subscribe only to channels they are authorized to access.

RLS policies are treated as security-critical code: every policy is covered by automated cross-tenant negative tests.

**Justification:** Application bugs happen. A missing filter in a query should not cause a data breach. RLS provides database-enforced guarantees that survive refactors, new endpoints, and third-party integrations. Supabase Auth integrates natively with RLS via `auth.uid()`, making this the natural enforcement point for a Supabase-based stack.

### UUID Strategy

All primary keys use UUIDs generated at insert time. No sequential integer identifiers are exposed externally or used as primary keys on tenant-scoped tables.

**Why UUIDs:**

- **Non-enumerable.** UUIDs cannot be guessed or iterated, reducing the risk of insecure direct object reference attacks even if other controls fail.
- **Distributed generation.** IDs can be generated client-side or server-side without coordination, supporting offline-first widget message deduplication via client-generated message IDs.
- **Merge-safe.** UUIDs avoid collision when importing, exporting, or replicating data across environments.
- **API stability.** External integrations and public APIs can reference stable UUID identifiers without leaking tenant count or creation order.
- **Future partitioning.** Time-based or hash-based partitioning schemes work cleanly with UUID primary keys.

Workspace slugs remain human-readable URL identifiers; UUIDs serve as the authoritative internal and API identifier.

### User Membership Model

Authentication and tenancy are deliberately separated:

- **Supabase Auth** manages user identity (email/password, future social and SSO providers). A user exists once globally.
- **Workspace membership** links a user to one or more workspaces via a `workspace_members` junction record containing role and status.

A single user may belong to multiple workspaces with different roles in each. Membership status (`active` or `deactivated`) is checked on every authorization decision. Deactivating a member revokes access immediately across all layers.

The workspace creator receives the owner role automatically at signup. Membership records are the source of truth for authorization; JWT custom claims may cache workspace IDs for performance but are never authoritative for mutations.

**Justification:** Separating identity from tenancy supports agencies, consultants, and agents who work across multiple customer workspaces without duplicate accounts. It also simplifies invitation flows: accepting an invite links an existing or new auth user to a workspace without creating a new identity.

### Workspace Roles

Four roles define permissions within a workspace, ordered by privilege:

| Role | Purpose |
|------|---------|
| **Owner** | Account-level authority: billing, workspace deletion, ownership transfer |
| **Admin** | Configuration and team management: widget settings, domains, invitations, member roles |
| **Agent** | Operational work: send/receive messages, assign conversations, use canned responses |
| **Viewer** | Read-only access: view conversations, contacts, and audit logs |

Roles are workspace-scoped, not global. Higher roles inherit lower-role capabilities unless explicitly restricted (viewers cannot send messages). Authorization is enforced at three layers: middleware (route access), application (business logic and role checks), and database (RLS policies). Owner role cannot be removed except through ownership transfer or workspace deletion. Only owners can promote or demote other owners.

**Justification:** Four roles cover the SMB-to-mid-market permission model without the complexity of custom role definitions. The hierarchy is intuitive, maps to the PRD permission matrix, and can be extended later with custom roles if enterprise demand requires it.

### Invitation Flow

Team members are invited by email, not pre-provisioned:

1. An owner or admin initiates an invitation specifying email address and role.
2. The system creates a pending invitation record with a hashed token and seven-day expiration.
3. An invitation email is sent via Resend containing a unique acceptance link.
4. The invitee follows the link. If they have no account, they complete signup; if they have an account, they authenticate.
5. Accepting the invitation creates a `workspace_members` record with the assigned role and marks the invitation as accepted.
6. Agent seat limits are enforced before invitation creation and again at acceptance.

Invitation tokens are stored hashed (never in plain text). Expired or already-accepted invitations are rejected. All invitation events are recorded in the audit log.

**Justification:** Email-based invitation is the standard SaaS onboarding pattern. Token hashing prevents token theft from database exposure. Seat enforcement at both creation and acceptance prevents race conditions when multiple admins invite simultaneously.

### Audit Model

Security-relevant and configuration actions produce append-only audit records scoped to the workspace:

- Each record captures timestamp, actor (user or system), action type, resource type and ID, client metadata (IP address, user agent), and action-specific details in a structured metadata field.
- Audit logs are **append-only** for tenant users: no UPDATE or DELETE policies exist. Inserts occur via service-role functions or security-definer functions after successful mutations.
- Retention is plan-dependent (90 days on Starter, up to two years on Team and Business). Automated purge jobs remove expired records.
- Access is restricted to owner, admin, and viewer roles.

Events include member lifecycle changes, widget and domain configuration changes, data exports, billing plan changes, and authentication events from new devices.

**Justification:** Immutable audit trails are required for compliance (SOC 2, GDPR accountability), incident investigation, and customer trust. Workspace-scoped audit records align with the tenant model and support per-customer export without cross-tenant leakage.

### Soft Delete Strategy

Soft delete applies where recovery, compliance, or billing workflows require a grace period. Hard delete applies to ephemeral or high-volume data with no recovery value.

| Entity | Strategy | Retention |
|--------|----------|-----------|
| Workspaces | Soft delete (`deleted_at`, status `pending_deletion`) | 30 days before hard purge; billing must be canceled first |
| Canned responses | Soft delete | Indefinite until workspace purge |
| Messages, contacts, conversations | Configurable retention | Workspace privacy settings (default 12 months); scheduled purge |
| Visitor sessions | Hard delete after expiration | 30 days post-expiration |
| Notifications | Hard delete | 90 days |
| Invitations | Hard delete after acceptance or expiration | Immediate upon resolution |

Partial indexes exclude soft-deleted records from active queries. Slug uniqueness is enforced only among non-deleted workspaces. Workspace suspension (billing failure) is a status change, not a soft delete — suspended workspaces retain data but lose write access via RLS.

**Justification:** Soft delete for workspaces protects against accidental deletion and supports billing finalization before data purge. Hard delete for ephemeral data keeps storage costs predictable. The hybrid approach balances recovery needs with database hygiene.

---

## Alternatives Considered

### Database per Tenant

Each workspace receives a dedicated PostgreSQL database (or Supabase project).

| Aspect | Assessment |
|--------|------------|
| Isolation | Strongest physical separation |
| Provisioning | Requires automated database creation, connection routing, and credential management per tenant |
| Migrations | Must be applied to every database independently; version drift is a real risk |
| Cost | Supabase project minimums make small tenants economically inefficient |
| Cross-tenant operations | Platform analytics, billing reconciliation, and support tooling require federated queries |
| Backups | Per-database backup management at scale |
| Connection pooling | Serverless functions must route to the correct database per request |

**Rejected because:** Operational complexity grows linearly with tenant count. Migration orchestration across thousands of databases is error-prone. Cost per tenant is higher at SMB price points. The isolation benefit does not justify the overhead at current and projected scale (10,000 workspaces). This option remains a future consideration for an Enterprise tier if a customer contractually requires dedicated infrastructure.

### Schema per Tenant

All tenants share one database but each workspace receives a dedicated PostgreSQL schema (e.g., `tenant_abc`, `tenant_xyz`).

| Aspect | Assessment |
|--------|------------|
| Isolation | Moderate — schemas provide namespace separation but share database resources and roles |
| Provisioning | Requires schema creation and search-path management per tenant |
| Migrations | Must iterate all schemas; failure in one schema blocks the migration pipeline |
| Query tooling | ORMs, Supabase client, and RLS operate on the public schema by default; multi-schema support adds complexity |
| RLS | Policies must be replicated per schema or managed dynamically |
| Connection pooling | Simpler than database-per-tenant but search-path must be set per connection |

**Rejected because:** Schema-per-tenant combines the migration burden of multi-database with weaker isolation than database-per-tenant. Supabase's tooling (RLS, Realtime, Storage policies, Auth integration) is optimized for a shared public schema. Dynamic schema management conflicts with Supabase migration workflows and CI/CD pipelines. No meaningful advantage over shared-schema RLS for Site Chat's threat model.

### Comparison Summary

| Criterion | Shared schema + RLS | Schema per tenant | Database per tenant |
|-----------|:-------------------:|:-----------------:|:-------------------:|
| Tenant isolation strength | High (RLS-enforced) | Medium | Highest |
| Operational complexity | Low | High | Very high |
| Migration simplicity | Single path | N schemas | N databases |
| Cost efficiency | High | Medium | Low |
| Supabase tooling fit | Native | Poor | Poor |
| Provisioning speed | Instant | Seconds | Minutes+ |
| Scale to 10K tenants | Proven pattern | Unwieldy | Impractical |

Shared schema with RLS is the industry-standard approach for B2B SaaS at Site Chat's target scale, used successfully by products with comparable isolation requirements.

---

## Consequences

### Positive

**Scalability.** A single database with connection pooling serves all tenants. Indexing on `workspace_id` keeps queries performant. The architecture targets 10,000 active workspaces without redesign. Horizontal scaling applies at the application layer (Vercel serverless) and connection pool layer (PgBouncer), not by sharding tenants.

**Maintenance.** One schema, one migration pipeline, one set of RLS policies. Schema changes deploy once and apply everywhere. Database monitoring, backup, and recovery operate on a single instance. Engineering effort scales with features, not tenant count.

**Cost.** Shared infrastructure amortizes database, storage, and compute costs across all tenants. No per-tenant Supabase project minimums. SMB pricing tiers remain viable because marginal cost per workspace is low.

**Security.** RLS provides database-enforced isolation that survives application bugs. A centralized policy test suite validates every table. Audit logging, role enforcement, and storage path isolation compose a defense-in-depth model suitable for SOC 2 preparation.

### Negative

**Complexity.** Every query, policy, and background job must include workspace context. Developers must understand RLS semantics, security-definer functions, and the three-layer authorization model. Onboarding new engineers requires explicit multi-tenancy training.

**Migrations.** All migrations are global — a breaking change affects every tenant simultaneously. Destructive changes require multi-phase rollouts (add new, migrate data, remove old). Migration review is security-critical because a policy error can expose or hide data across all tenants.

**RLS maintenance.** RLS policies must be updated whenever tables, roles, or access patterns change. Policies are harder to debug than application-level checks. Performance tuning requires understanding PostgreSQL query planning with policy expressions. Every new table requires policies before production use. Automated RLS test coverage is mandatory overhead.

**Noisy neighbor risk.** A single workspace generating extreme load (millions of messages, runaway queries) could affect others on the shared instance. Mitigation requires rate limiting, usage metering, query monitoring, and eventual per-workspace resource quotas — but the fundamental shared-resource model remains.

**Compliance limitations.** Customers requiring physically dedicated infrastructure cannot be served without architectural change. EU data residency requires region-level database deployment, not per-tenant sharding within the shared model.

---

## Future Compatibility

The workspace-scoped shared schema model is designed to absorb major product expansions without tenancy redesign. New features add tables and policies within the existing `workspace_id` boundary.

### AI (Suggested Replies, Chatbots, Auto-Responders)

AI features attach to the workspace level: model configuration, prompt templates, conversation context retrieval, and usage metering per workspace. AI-generated messages are stored in the existing messages table with a distinct sender type. RLS policies extend to new AI configuration tables using the same membership pattern. Token usage and cost allocation are tracked per workspace for billing.

### WhatsApp, Telegram, SMS, Email, and Voice

Omnichannel support introduces a **channel** abstraction scoped to the workspace. Each channel connection (a WhatsApp Business account, Telegram bot, SMS number, email inbox, or voice line) is a workspace-owned configuration record. Inbound and outbound messages from any channel normalize into the existing conversation and message model with channel metadata. The widget becomes one channel among many; the inbox remains unified. Channel credentials are stored encrypted per workspace. RLS isolates channel configurations and message records by `workspace_id`.

### CRM Integrations (HubSpot, Salesforce)

CRM integrations are workspace-scoped OAuth connections with sync configuration. Contact and conversation records already carry `workspace_id`, enabling outbound sync and inbound webhook processing within tenant boundaries. Integration state, field mappings, and sync logs are new tenant-scoped tables governed by the same RLS pattern. No cross-workspace data sharing occurs during CRM sync.

### White Label

White-label deployments add workspace-level branding configuration (logo, colors, custom domain for dashboard) without changing the tenancy model. Custom domains route to the same application; middleware resolves the domain to a workspace context. The shared schema stores branding overrides in workspace settings. Agency workspaces already support managing multiple client workspaces through the membership model.

### Public API

A public REST API exposes workspace-scoped endpoints authenticated via workspace API keys. Keys are stored hashed, scoped to a workspace, and carry permission scopes. Rate limiting applies per key and per workspace. API access is governed by RLS — the API layer passes workspace context to the database identically to the dashboard. Versioned endpoints (`/api/v1/`) evolve without tenancy changes.

### Multiple Websites per Workspace

A workspace may serve chat widgets on multiple domains and websites. The existing `allowed_domains` table already supports multiple domains per workspace. Future enhancements add website-level configuration (distinct widget settings, routing rules, business hours) as child records under the workspace. Conversations record source URL and website identifier for filtering and reporting. All records remain scoped to a single `workspace_id`.

---

## References

- [PRD](../PRD.md) — Product requirements, roles, and workspace specifications
- [ARCHITECTURE.md](../ARCHITECTURE.md) — System architecture and multi-tenancy model overview
- [DATABASE.md](../DATABASE.md) — Schema design, RLS policies, and data retention
- [SECURITY.md](../SECURITY.md) — Security model, threat analysis, and authorization layers
- [ROADMAP.md](../ROADMAP.md) — Phased delivery plan and post-MVP features

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-07-30 | Initial ADR accepted | Site Chat Engineering |
