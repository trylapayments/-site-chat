# Site Chat — AI Security Review

**Status:** Reviewed for Suggested Replies foundation  
**Last updated:** 2026-08-10

---

## 1. Scope

Security review for:

- `packages/ai` provider/prompt/context foundation
- `POST /api/v1/inbox/ai/suggested-replies`
- Operator Suggested Replies UI
- `ai_usage_events` / `ai_rate_limit_buckets` schema

Out of scope (not implemented): visitor chatbot, tools/agents, RAG ingestion, autonomous actions.

---

## 2. Threat model (AI-specific)

| Threat | Mitigation |
|--------|------------|
| Cross-workspace conversation leakage | Membership check on `workspaceId`; conversation/messages loaded via existing workspace-scoped RPCs + RLS |
| Visitor calling operator AI | Endpoint requires authenticated dashboard session + `send_messages`; no widget auth path |
| Provider API key exposure | Keys only in server env; browser imports `@site-chat/ai/client` only |
| Prompt injection → system capabilities | No tools; model can only return text; system prompt treats conversation as untrusted data |
| Auto-send / unwanted actions | Accept inserts into composer only; send remains explicit operator action |
| HTML/script execution | Plain-text sanitize; React text nodes; escape helper available |
| Secret / prompt logging | Usage telemetry excludes prompt/body content; provider error bodies discarded |
| Abuse / cost explosion | Per workspace+member rate limit via HMAC bucket keys |
| RLS weakening | No broad policy changes to messages/conversations; new tables deny client writes |

---

## 3. Authorization checklist

- [x] Authenticated operator required
- [x] Active workspace membership required
- [x] `send_messages` capability required (viewers cannot generate)
- [x] Conversation must belong to the authorized workspace (enforced by RPC/RLS)
- [x] AI disabled/not configured fails closed (`AI_DISABLED` / `AI_NOT_CONFIGURED`)
- [x] No service-role client in browser code paths

---

## 4. Data handling

**Sent to providers (when enabled):**

- Workspace display name
- Optional operator/visitor display labels
- Recent plain-text messages
- System/product instructions for suggested replies

**Never sent to providers:**

- API keys of other systems
- Service-role credentials
- Billing secrets
- Unrelated tenant records / full contact graphs

**Telemetry stores:** metadata + token counts only.

---

## 5. Error disclosure

Stable public codes:

`AI_DISABLED`, `AI_NOT_CONFIGURED`, `AI_RATE_LIMITED`, `AI_PROVIDER_ERROR`, `AI_TIMEOUT`, `AI_INVALID_RESPONSE`, `AI_UNAVAILABLE`

Clients receive sanitized messages only. Upstream provider payloads are not forwarded.

---

## 6. Residual risks / follow-ups

1. Operators can still paste model output into messages — expected; keep plain-text rendering.
2. Future RAG must add document ACL checks before retrieval.
3. Future agents/tools require a separate capability + allowlist design; Suggested Replies must remain tool-less.
4. Dedicated AI settings audit log events can be added when settings UI ships.

---

## 7. Verification

Automated coverage includes provider mapping, timeout/error handling, rate-limit helpers, context ordering, accept/composer preservation, malicious HTML escaping, DB defaults/rate-limit RPC, and Playwright flows for accept/regenerate/dismiss/disabled/unauthorized.
