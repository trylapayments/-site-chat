# Changelog

All notable changes to Site Chat are documented in this file.

## Unreleased

### Added

- Internal Notes + @mentions (v1): durable `internal_notes` / `internal_note_mentions` / mention `notifications`; soft delete; ID-backed composer tokens; Customer Timeline note/mention events (hidden from Viewer); operator realtime with watermarked catch-up + tombstone index; create idempotency via lifetime-unique `client_note_id` (`NOTE_DELETED` when retrying a soft-deleted key); docs `docs/INTERNAL-NOTES.md`, ADR-006; pgTAP `016_internal_notes.test.sql`.
- Conversation Assignment & Queues: durable `assigned_at` / `assigned_by_member_id` / `assignment_version` on conversations; `take_conversation` / `assign_conversation` / `unassign_conversation` RPCs with row-lock + version CAS; Mine / Unassigned / All inbox filters; assignee picker; realtime queue updates; timeline events `conversation_assigned` / `conversation_transferred` / `conversation_unassigned`.
- Docs: `docs/CONVERSATION-ASSIGNMENT.md`, `docs/adr/ADR-005-conversation-assignment.md`; updates to Architecture, Database, Security, Customer Timeline, Roadmap.
- pgTAP: `supabase/tests/database/015_conversation_assignment.test.sql`; shared Vitest assignment suite; Playwright assignment E2E.
- Customer Timeline foundation: durable `customer_timeline_events` with DB-side emission, canonical taxonomy, keyset pagination (`list_customer_timeline`), operator sidebar Timeline panel, and realtime INSERT subscriptions.
- Timeline events for page views, conversation start/status/assignment, concise message milestones, attachments, and identity changes (no-op patches emit nothing).
- Docs: `docs/CUSTOMER-TIMELINE.md`, `docs/adr/ADR-004-customer-timeline-events.md`; updates to Architecture, Database, Security, Privacy, Data Retention, Roadmap.
- pgTAP: `supabase/tests/database/014_customer_timeline.test.sql`; shared Vitest timeline suite; Playwright customer timeline E2E.
- Visitor identity + context foundation: durable `contacts.public_id` (`vis_` + 32 hex), session device/UTM fields, `visitor_page_views` with 30s server dedupe, widget identify/page-view RPCs, and operator `update_visitor_profile`.
- Host identify API contract (v1): `window.SiteChat.identify({ name, email, phone, attributes })` — queue until ready, workspace-scoped by embed key, cannot set `visitor_id` / `workspace_id`.
- Privacy defaults documented: no raw IP, no fingerprinting, workspace-isolated PII; retention architecture for future purge via `settings_json.privacy.visitorDataRetentionDays`.
- Docs: `docs/VISITOR-IDENTITY.md`, `docs/PRIVACY.md`, `docs/DATA-RETENTION.md`, `docs/adr/ADR-003-visitor-identity-model.md`; updates to Architecture, Database, Security, Roadmap.
- pgTAP: `supabase/tests/database/013_visitor_identity.test.sql`.
- AI foundation package `@site-chat/ai` with provider abstraction (`generate`, `stream`, `embeddings`, `moderate`), OpenAI + Mock providers, and stubs for Anthropic/Gemini/Ollama.
- Operator **Suggested Replies** (generate / accept / edit / regenerate / dismiss) with SSE streaming; accept inserts into the composer only and never auto-sends.
- Per-workspace AI config in `workspaces.settings_json.ai` (disabled by default); local/E2E seed uses `MockProvider`.
- AI usage telemetry table `ai_usage_events` and operator AI rate limiting via `ai_rate_limit_buckets`.
- Docs: `docs/AI-ARCHITECTURE.md`, `docs/AI-SECURITY.md`, `docs/AI-ROADMAP.md`, `docs/adr/ADR-002-ai-provider-foundation.md`.
