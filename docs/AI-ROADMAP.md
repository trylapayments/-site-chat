# Site Chat — AI Roadmap

**Status:** Planning  
**Last updated:** 2026-08-10

This roadmap explains how the AI foundation in `packages/ai` extends to future products. **Only Suggested Replies is implemented now.**

---

## 1. Suggested Replies (shipped foundation)

- Operator-only draft generation
- Accept / edit / regenerate / dismiss
- Streaming-ready provider + SSE API
- Workspace config + usage metering + rate limits

---

## 2. Conversation Summaries

Reuse:

- Prompt registry id `summary`
- Same context builder with larger/summarization-oriented windows
- Usage feature key `conversation_summary`

Do not auto-post summaries into visitor chat unless explicitly productized later.

---

## 3. Knowledge Base / RAG

Reuse:

- `embeddings()` provider method
- New ingestion pipeline + document ACL tables
- Prompt id `rag`
- Capability `ai.rag`

Must enforce workspace isolation on retrieved chunks before prompt assembly.

---

## 4. AI Chatbot (visitor-facing)

Reuse provider/prompt/telemetry layers, but requires:

- Separate visitor-safe prompt/policy
- Distinct rate limits
- Clear disclosure/UX
- No operator-only context leakage

Not enabled by `ai.suggestedReplies`.

---

## 5. Classification / Tagging

- Prompt id `classification`
- Structured output validation
- Optional write-back to conversation labels via authorized server actions

---

## 6. Translation

- Prompt id `translation`
- Operator and/or visitor surfaces
- Keep source text immutable; store translations explicitly

---

## 7. Routing

- Prompt id `routing`
- Suggest assignee/queue only; human or explicit automation rule executes

---

## 8. Automation

- Rules engine + AI suggestions
- Always gated by workspace automation settings
- Audit log every automatic action

---

## 9. AI Agents

- Capability `ai.agent`
- Tool allowlists, confirmation policies, and sandboxing are mandatory
- Suggested Replies remains tool-less even after agents exist

---

## Sequencing principles

1. Keep provider secrets server-side.
2. Fail closed when a feature flag is off.
3. Meter every billable invocation.
4. Prefer assistive operator UX before autonomous visitor agents.
5. Add ADRs when introducing tools, RAG stores, or visitor-facing AI.
