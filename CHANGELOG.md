# Changelog

All notable changes to Site Chat are documented in this file.

## Unreleased

### Added

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
