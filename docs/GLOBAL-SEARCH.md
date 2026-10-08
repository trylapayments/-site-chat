# Global Search

**Status:** Implemented (v1, hardened) — engineering PR #34 / product PR #32  
**Last updated:** 2026-08-18

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [VISITOR-PROFILE.md](./VISITOR-PROFILE.md), [INTERNAL-NOTES.md](./INTERNAL-NOTES.md), [ATTACHMENTS.md](./ATTACHMENTS.md)

---

## 1. Purpose

Operators need a single workspace-scoped palette (trigger + `⌘/Ctrl+K`) to find contacts, conversations, messages, internal notes, and attachments without scanning the inbox.

v1 delivers:

- `public.global_search(workspace_id, query jsonb)` SECURITY DEFINER RPC
- FTS (`tsvector` / GIN) plus escaped `pg_trgm` ILIKE fallbacks for partial queries of length ≥ 3
- Reuse of `contacts.search_vector` and `internal_notes.search_vector`
- Generated `messages.search_vector`; trigger-maintained `conversations.search_vector`
- Role-aware notes visibility (`can_search_notes`; viewers get empty notes groups)
- Viewer denial of `messages.is_internal` rows (and attachments on those messages)
- Dashboard palette UI with category tabs, keyboard navigation, and stale-request guards
- Deep-link: message/attachment hits open `?message=` and SSR loads a centered `around_message_id` window; note hits open `?tab=notes&note=` and SSR/list hydrate (plus `get_internal_note` fallback). Hit navigation uses full document load so revisiting a conversation cannot serve a stale empty notes RSC payload.

---

## 2. Indexed fields matrix

| Result type | Primary index / source | Fields matched | Notes |
|-------------|------------------------|----------------|-------|
| **contact** | `contacts.search_vector` (GIN) + name/email/phone/job_title/public_id trigram | name, email, phone, job_title, `public_id`, company **name + domain**, tag names, custom field text/select/number/date (+ definition labels/keys) | Exact email / `public_id` / phone digits (≥7) boost to rank 100 |
| **conversation** | `conversations.search_vector` (trigger) + sanitized source_url / preview trigram | conversation id, contact `public_id`/name/email/phone, subject, **`sanitize_page_url(source_url)`**, `last_message_preview` | **Assignee label is not indexed** (avoids auth.users churn). Secrets in legacy `source_url` are re-sanitized on every vector refresh and never matched via raw column ILIKE |
| **message** | `idx_messages_workspace_search_vector` GIN `(workspace_id, search_vector)` + body trigram | message `body` | Viewers never match `is_internal = true`. Fuzzy only when `char_length(q) ≥ 3` |
| **note** | `internal_notes.search_vector` + body trigram (active only) | note `body` | Soft-deleted excluded; viewers never search notes; fuzzy only when `q` length ≥ 3 |
| **attachment** | `(workspace_id, lower(filename))` + filename trigram | `filename`, `mime_type` | Safe metadata only — never `storage_key`. Viewer filter joins parent message `is_internal = false` |

Empty / whitespace-only `q` returns empty groups for every type (palette must not dump unbounded rows).

### Freshness audit (durable sources)

| Source | Refresh path |
|--------|----------------|
| Contact identity / company / tags / custom fields | Existing CRM `search_vector` triggers (also refresh linked conversation vectors on identity change) |
| Conversation subject / preview / contact_id / source_url | `trg_conversations_refresh_search_vector` → `refresh_conversation_search_vector` (always runs `sanitize_page_url` on `source_url`) |
| Assignee / member display/email | **Not indexed** — docs and RPC match; assignment changes do not touch search_vector |
| Message body | Generated `search_vector` STORED |
| Internal / deleted messages | Viewer predicate + soft-delete/exclusion in RPC |
| Notes body / soft-delete | Generated vector; `deleted_at IS NULL` filter |
| Attachments filename/mime / completion | Row filters; never returns storage keys |

---

## 3. Ranking model

Per-type ranked lists (default `limit_per_type` = 5, max 25), ordered by:

1. Heuristic **rank** (higher wins)
2. Recency timestamp (DESC, NULLs last)
3. Stable id

Ranking CASE branches use **equality / `position()`** for exact/prefix checks. Substring ILIKE always uses `app_private.escape_like_pattern(q)` with `ESCAPE '\'` so user `%` / `_` / `\` cannot act as wildcards.

Approximate boosts (from `app_private.global_search`):

| Match quality | Typical rank |
|---------------|--------------|
| Exact email / public_id / normalized phone (≥7 digits) | 100 |
| Exact conversation UUID / exact attachment filename | 95–100 |
| Exact contact name | 90 |
| Exact / prefix message or note body | 70–90 |
| Email/name/public_id prefix | 70–80 |
| FTS `ts_rank_cd` hit | ~50 + weighted rank |
| Substring / trigram fallback | ~25–45 |

Snippets: `app_private.safe_search_snippet` (angle brackets stripped; bounded length). Conversation hit subtitle/snippet use **sanitized** source_url only.

---

## 4. Authorization

| Actor | Can call RPC? | Notes group | Other groups |
|-------|---------------|-------------|--------------|
| owner / admin / agent | Yes | Yes (`can_search_notes = true`) | Yes (including internal messages) |
| viewer | Yes | Always empty; `can_search_notes = false` | Contacts / conversations / **non-internal** messages / attachments on non-internal messages only |
| anon / visitor / widget | No | — | — |

Enforcement:

- `app_private.require_workspace_access(p_workspace_id)`
- `public.global_search` SECURITY DEFINER, `search_path = ''`; EXECUTE granted to `authenticated` only
- Server Action also filters note hits via `manage_internal_notes`

Cross-tenant probes return no foreign-workspace rows.

### Viewer / internal message policy

- Message candidates: `(NOT v_is_viewer OR m.is_internal = false)`
- Attachment candidates join parent message with the same predicate
- Regression: pgTAP proves agent sees internal body/filename; viewer gets zero hits, no id, no snippet leak

---

## 5. RPC contract

```text
public.global_search(p_workspace_id uuid, p_query jsonb DEFAULT '{}') → jsonb
```

| Key | Type | Default | Constraints |
|-----|------|---------|-------------|
| `q` | string | `""` | Trimmed; max 200 chars; empty → empty groups |
| `category` | string | `"all"` | `all` \| `contacts` \| `conversations` \| `messages` \| `notes` \| `attachments` |
| `limit_per_type` | int | `5` | Clamped to 1–25 |

Shared Zod: `packages/shared/src/schemas/global-search.ts`  
Constants: `GLOBAL_SEARCH_MIN_FUZZY_LENGTH = 3`, `GLOBAL_SEARCH_CANDIDATE_CAP_MAX = 200`.

Navigation: contact → profile; conversation → inbox; message/attachment → `?message=`; note → `?tab=notes&note=`.

### Deep-link (`list_messages` / notes)

Optional `around_message_id` loads a bounded centered window (mutually exclusive with before/after sequence). Conversation page SSR uses it when `?message=` is present so hits older than the newest 50 still render and focus. Viewers cannot center on an internal message (`Message not found` → page falls back to newest window).

Note hits open `?tab=notes&note=`. SSR loads the notes page and, if the focused id is missing from the list, fetches `get_internal_note` and merges it. The palette uses **full document navigation** (`location.assign`) so revisiting a conversation does not reuse a stale empty notes RSC payload from an earlier visit. The notes panel also has a one-shot client fetch for the focused id as a fallback.

---

## 6. Query architecture (scale)

### Short queries (`char_length(q) < 3`)

- Contacts / conversations: **exact + prefix identity only** (email, public_id, name, phone, conversation UUID)
- Messages / notes / attachments: **skipped** (no FTS, no `%q%` body/filename scans)

### Long queries (`char_length(q) ≥ 3`)

Staged selection for messages / notes / attachments:

1. Workspace-scoped indexed candidate probe (`workspace_id` + GIN/trigram predicates)
2. `ORDER BY created_at DESC LIMIT candidate_cap` where `candidate_cap = least(greatest(limit_per_type * 20, 50), 200)`
3. Rank **only** that bounded candidate set (equality / `position` / `ts_rank_cd` / escaped ILIKE)
4. Final `LIMIT limit_per_type`

Conversations / contacts still apply `workspace_id` first, then FTS/trigram predicates, then `LIMIT limit_per_type`. Conversation matching never calls `member_display_label` per row.

### What LIMIT does **not** mean

**`limit_per_type` bounds returned rows, not scan cost.** Intermediate work can examine up to ~200 candidates per heavy type before final rank. Empty `q` short-circuits with no table scans. Do not claim “per-request work is bounded by limit_per_type alone.”

### Indexes (hardening migration)

| Index | Purpose |
|-------|---------|
| `idx_messages_workspace_search_vector` GIN `(workspace_id, search_vector)` | Workspace-scoped FTS |
| `idx_messages_body_trgm` | Body substring |
| `idx_messages_workspace_created` | Candidate ordering |
| `idx_message_attachments_workspace_filename` btree `(workspace_id, lower(filename))` | Exact/prefix filename |
| `idx_message_attachments_filename_trgm` | Filename substring |
| `idx_conversations_search_vector` | Conversation FTS |
| Existing contact / note trigram + CRM vectors | Identity / CRM search |

### Query-plan evidence

Representative validation approach (local or CI with seeded volume):

```sql
-- After seeding tens of thousands of workspace-scoped messages:
EXPLAIN (ANALYZE, BUFFERS)
SELECT m.id
FROM public.messages m
WHERE m.workspace_id = :ws
  AND m.search_vector @@ plainto_tsquery('english', 'pricing refund')
ORDER BY m.created_at DESC
LIMIT 200;
```

**Expected shape (messages FTS branch):** Bitmap/Index Scan on `idx_messages_workspace_search_vector` (or equivalent workspace+GIN plan) with a **workspace filter applied early**; not a sequential scan of all messages followed by a late workspace filter. Candidate stage then feeds a small rank sort (`≤ candidate_cap` rows).

**Attachments:** Index/bitmap on filename trigram or `(workspace_id, lower(filename))` with workspace predicate; join to `messages` for `is_internal` should not explode to cross-workspace rows.

**Short query (`q = 'ab'`, category messages):** Planner never enters the messages candidate CTE (RPC short-circuits `v_include_messages = false`).

Script sketch for fixtures: insert N conversations/messages/attachments in one workspace, run `EXPLAIN` for contact FTS, conversation FTS, message staged probe, attachment filename ILIKE, and capture plans into CI artifacts. Plans will vary by Postgres version and statistics; the invariant is **workspace-scoped index use + bounded candidate rank**, not a fixed cost number.

Commercial scale assumption: tens of thousands of contacts/conversations and hundreds of thousands of messages per workspace. Multi-million-row global corpora are out of scope for v1 keyword search.

---

## 7. Known v1 limitations

- No semantic / embedding search; no saved searches / history
- No cross-workspace admin search
- Assignee not searchable via conversation vector
- Attachment search is filename/mime only (no OCR)
- Conversation vector omits full message history (messages are a separate group)
- Candidate cap prefers recent messages; very old high-rank hits can be missed if outside the recent candidate window
- Client debounce ~200ms; generation guard drops stale responses (Server Actions are not abortable)

---

## 8. Client races

`GlobalSearch` uses `createGlobalSearchRequestGuard`:

- Workspace slug change → invalidate + clear results immediately
- Close palette → invalidate pending generation; reopen starts empty
- Only the latest `(requestId, workspaceSlug)` may call `setResult`

---

## 9. Why vector / AI search is out of scope

v1 prioritizes deterministic, tenant-isolated, explainable keyword retrieval. Embeddings add cost, PII surface, and ranking opacity without replacing exact-identity matches.

---

## 10. Tests

- pgTAP: `supabase/tests/database/019_global_search.test.sql` (plan 128) — Viewer internal msg/attach denial, source_url secrets, LIKE escaping, short queries, `around_message_id`, assignee exclusion, isolation
- Playwright: `e2e/tests/inbox/global-search.spec.ts` — keyboard, contact/message/note/attachment, viewer notes, stale close, deep-link beyond newest 50
- Vitest: shared search helpers + `listMessagesQuerySchema` + `request-guard`
