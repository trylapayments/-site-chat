# Changelog

All notable changes to Site Chat are documented in this file.

## Unreleased

### Added

- AI foundation package `@site-chat/ai` with provider abstraction (`generate`, `stream`, `embeddings`, `moderate`), OpenAI + Mock providers, and stubs for Anthropic/Gemini/Ollama.
- Operator **Suggested Replies** (generate / accept / edit / regenerate / dismiss) with SSE streaming; accept inserts into the composer only and never auto-sends.
- Per-workspace AI config in `workspaces.settings_json.ai` (disabled by default); local/E2E seed uses `MockProvider`.
- AI usage telemetry table `ai_usage_events` and operator AI rate limiting via `ai_rate_limit_buckets`.
- Docs: `docs/AI-ARCHITECTURE.md`, `docs/AI-SECURITY.md`, `docs/AI-ROADMAP.md`, `docs/adr/ADR-002-ai-provider-foundation.md`.
