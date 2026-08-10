# ADR-002: AI Provider Foundation + Suggested Replies

**Status:** Accepted  
**Date:** 2026-08-10

## Context

Site Chat needs an AI capability that can survive provider changes, per-workspace configuration, billing metering, and future features (summaries, RAG, agents) without rewriting product code. The first customer-facing feature is operator Suggested Replies.

Constraints:

- Multi-tenant isolation remains non-negotiable
- Provider API keys must never reach the browser
- CI must not call paid external AI APIs
- Suggested Replies must never auto-send or execute tools

## Decision

1. Create a dedicated `@site-chat/ai` package with a provider interface (`generate`, `stream`, `embeddings`, `moderate`, usage, metadata).
2. Implement `OpenAIProvider` and `MockProvider` fully; keep Anthropic/Gemini/Ollama as explicit stubs.
3. Store minimal per-workspace AI config in `workspaces.settings_json.ai`, disabled by default.
4. Keep prompts/context/telemetry in the AI package; wire Suggested Replies through a server SSE route.
5. Expose browser-safe helpers via `@site-chat/ai/client` only.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Call OpenAI directly from route handlers | Couples product to one vendor; hard to test/meter consistently |
| Visitor-facing chatbot first | Higher safety/product risk; less due-diligence friendly as first AI ship |
| Store API keys in workspace settings | Secret sprawl and RLS/export risk |
| Fake streaming with timers over full responses | Violates “do not fake streaming” requirement |

## Consequences

- New migration for `ai_usage_events` and `ai_rate_limit_buckets`
- Root/CI build order includes `@site-chat/ai`
- Future providers plug into `createAIProvider` without API route rewrites
- Future features should add prompt ids + capabilities rather than new one-off integrations
