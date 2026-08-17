# Changelog

All notable changes to Site Chat are documented in this file.

## Unreleased

### Fixed

- CRM-lite hardening (PR #33): concurrent tag assign idempotent (`ON CONFLICT DO NOTHING`); custom field dates strict `YYYY-MM-DD` (reject `today`/`tomorrow`) in shared Zod + DB; select option shrink captures contact ids before orphan delete then refreshes `search_vector`; soft-delete custom field definition hard-deletes values and refreshes search without per-contact `custom_field_updated` spam; company website http(s) only; company picker searchable via `list_companies` `q`; contacts UI keyset **Load more** (`next_before` / `has_more`); dirty-only identity patches with live draft-preserving reconcile; contact profile realtime uses stable subscribe deps + reconnect catch-up (no polling / refresh storm). Docs aligned (`docs/VISITOR-PROFILE.md` and related).

### Added

- Visitor Profile / CRM-lite (v1): workspace `companies`, `contact_tags` / assignments, typed `custom_field_definitions` / `custom_field_values` (EAV with typed columns); contact profile columns (`company_id`, `job_title`, `locale`, `country_code`) and trigger-maintained `search_vector` (PR #32 search readiness); SECURITY DEFINER RPCs for profile/tag/company/custom-field CRUD; timeline events `tag_added` / `tag_removed` / `company_linked` / `company_unlinked` / `custom_field_updated`; capabilities `view_contact_profile` / `manage_crm_definitions`; contact list + profile UI, CRM settings, lean sidebar link; docs `docs/VISITOR-PROFILE.md`, ADR-008; pgTAP `018_visitor_profile_crm.test.sql`; Playwright `e2e/tests/visitor/visitor-profile-crm.spec.ts`.
- Canned Responses (v1): durable `canned_responses` / `canned_response_folders` / `canned_response_favorites` with workspace-shared and per-member personal scopes; slash-free lowercase shortcuts unique per scope; folders with `sort_order` and soft delete that unfiles rather than deletes its snippets; per-member favorites; FTS + `pg_trgm` word-similarity search ranked shortcut-exact > shortcut-prefix > fuzzy, boosted by favorites; `usage_count` that does not bump `updated_at`; operator realtime with watermarked catch-up + tombstone index; docs `docs/CANNED-RESPONSES.md`, ADR-007; pgTAP `017_canned_responses.test.sql`.
- Canned Responses application layer: capabilities `view_canned_responses` / `use_canned_responses` / `manage_workspace_canned_responses`; shared Zod schemas plus a `canned/` helper module (variables, slash trigger, client ranking, realtime merge, typed errors); Server Actions for snippet and folder CRUD, favorites and usage; live list via `subscribeOperatorCannedResponses`; settings library at `/app/[workspaceSlug]/settings/canned-responses` with scope tabs, folders, search, variable chips and optimistic favorite/delete; `/shortcut` insertion in the reply composer with `{{visitor.name}}` / `{{visitor.email}}` / `{{operator.name}}` / `{{workspace.name}}` / `{{conversation.id}}` substitution (`{{agent.name}}` accepted as an alias); Playwright `e2e/tests/inbox/canned-responses.spec.ts`.
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
