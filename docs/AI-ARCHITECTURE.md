# Site Chat — AI Architecture

**Status:** Active  
**Last updated:** 2026-08-10

---

## 1. Purpose

This document describes the reusable AI foundation introduced for Site Chat and the first product surface built on it: **operator Suggested Replies**.

Site Chat is a commercial multi-tenant messaging product. AI must be:

- Workspace-scoped and fail-closed
- Provider-swappable without rewriting product features
- Safe for operators (no auto-send, no tools, plain text only)
- Metered for future billing
- Free of provider secrets in browser bundles

---

## 2. Package layout

```
packages/ai/
  providers/     # OpenAI + Mock implementations; Anthropic/Gemini/Ollama stubs
  prompts/       # Prompt registry (suggested_reply active)
  context/       # Bounded conversation context builder
  streaming/     # Stream aggregation helpers
  telemetry/     # Usage event shaping (no prompt bodies)
  safety/        # Plain-text sanitization / HTML escaping
  types/         # Provider contracts, errors, config, telemetry
  features/      # Capability model (ai.enabled, ai.suggestedReplies, …)
  ui/            # Composer accept helpers (browser-safe)
  client.ts      # Browser entry (@site-chat/ai/client)
  index.ts       # Server entry (@site-chat/ai)
```

Provider-specific HTTP/SDK details stay inside `providers/`. Product code depends on the `AIProvider` interface only.

---

## 3. Provider abstraction

`AIProvider` supports:

| Method | Purpose |
|--------|---------|
| `generate()` | Non-streaming completion |
| `stream()` | First-class token streaming |
| `embeddings()` | Future RAG |
| `moderate()` | Future safety gates |
| Token usage | Nullable-safe prompt/completion/total |
| Model metadata | Provider id, model, capability flags |

Implemented:

- `OpenAIProvider` — real OpenAI Chat Completions streaming
- `MockProvider` — deterministic local/CI provider (no paid APIs)

Stubs only (fail with `AI_UNAVAILABLE` / `AI_NOT_CONFIGURED`):

- Anthropic, Gemini, Ollama

Provider selection is configuration-driven via `workspaces.settings_json.ai.provider` plus server env credentials (`OPENAI_API_KEY`).

---

## 4. Workspace configuration

Minimum persistence for this release lives in `workspaces.settings_json.ai`:

```json
{
  "enabled": false,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "features": {
    "suggestedReplies": false,
    "summary": false,
    "rag": false,
    "agent": false
  }
}
```

Defaults are **disabled**. Future work can move this into a dedicated settings UI / table without changing the provider package boundary. API keys are **never** stored in `settings_json`.

Local/E2E seed enables `provider: "mock"` for `acme-support`.

---

## 5. Prompt + context layers

- Prompts are not hardcoded in route handlers or React components.
- Active prompt: `suggested_reply`.
- Registry extension points exist for summary, classification, RAG, routing, translation, and agents — unimplemented ids fail closed.
- `buildConversationContext()` accepts only workspace/operator/visitor display fields and recent messages.
- Messages are ordered by `sequence_number`, then `created_at`, then `id`.
- Default window: 20 messages, body truncated to 1000 chars.

---

## 6. Suggested Replies API flow

```
Operator UI
  → POST /api/v1/inbox/ai/suggested-replies  (SSE)
    → auth + workspace membership + send_messages capability
    → load workspace AI config (fail closed)
    → rate limit (workspace + member HMAC bucket)
    → load conversation/messages via existing RLS RPCs
    → build context + prompt
    → provider.stream()
    → sanitize text
    → record ai_usage_events
    → SSE delta/done/error events
  → Accept inserts into composer only (never auto-send)
```

Cancellation uses the request `AbortSignal`. Timeouts use `AI_REQUEST_TIMEOUT_MS` (default 30s).

---

## 7. Telemetry

Table `ai_usage_events` records:

`workspace_id`, `member_id`, `feature`, `provider`, `model`, token counts (nullable), `latency_ms`, `status`, `error_code`, `created_at`.

It does **not** store prompts, completions, or conversation content. Estimated cost is intentionally omitted from core logic to avoid fragile hardcoded pricing.

---

## 8. Feature capabilities

Stable keys:

- `ai.enabled`
- `ai.suggestedReplies`
- `ai.summary`
- `ai.rag`
- `ai.agent`

Only Suggested Replies is implemented in product UI/API.

---

## 9. Performance notes

| Concern | Approach |
|---------|----------|
| Provider latency | Stream tokens to UI; timeout bounded |
| Request cancellation | AbortSignal from fetch/route |
| Realtime thread | AI work is request-scoped; does not block Realtime subscriptions |
| Rerenders | Suggestion panel is local state; accept updates composer text only |
| Context size | Hard message/body limits |
| Query shape | One conversation fetch + one message list (existing RPCs), no N+1 |

See also `docs/AI-SECURITY.md` and `docs/AI-ROADMAP.md`.
