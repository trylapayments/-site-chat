# Global Search

**Status:** Implemented (v1) — engineering PR #34 / product PR #32  
**Last updated:** 2026-08-18

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [VISITOR-PROFILE.md](./VISITOR-PROFILE.md), [INTERNAL-NOTES.md](./INTERNAL-NOTES.md), [ATTACHMENTS.md](./ATTACHMENTS.md)

---

## 1. Purpose

Operators need a single workspace-scoped palette (trigger + `⌘/Ctrl+K`) to find contacts, conversations, messages, internal notes, and attachments without scanning the inbox.

v1 delivers:

- `public.global_search(workspace_id, query jsonb)` SECURITY DEFINER RPC
- FTS (`tsvector` / GIN) plus `pg_trgm` ILIKE fallbacks for short/partial queries
- Reuse of `contacts.search_vector` and `internal_notes.search_vector`
- Generated `messages.search_vector`; trigger-maintained `conversations.search_vector`
- Role-aware notes visibility (`can_search_notes`; viewers get empty notes groups)
- Dashboard palette UI with category tabs and keyboard navigation

---

## 2. Indexed fields matrix

| Result type | Primary index / source | Fields matched | Notes |
|-------------|------------------------|----------------|-------|
| **contact** | `contacts.search_vector` (GIN) + name/email/phone/job_title/public_id trigram | name, email, phone, job_title, `public_id`, company **name + domain**, tag names, custom field text/select/number/date (+ definition labels/keys) | Exact email / `public_id` / phone digits (≥7) boost to rank 100 |
| **conversation** | `conversations.search_vector` (trigger) + source_url / preview trigram | conversation id, contact `public_id`/name/email/phone, subject, `source_url`, `last_message_preview`, assignee display label | No secrets; refreshed when contact identity changes |
| **message** | generated `messages.search_vector` + body trigram | message `body` | Viewers never match `is_internal = true` rows |
| **note** | `internal_notes.search_vector` + body trigram (active only) | note `body` | Soft-deleted (`deleted_at IS NOT NULL`) excluded; viewers never search notes |
| **attachment** | filename (+ mime) trigram | `filename`, `mime_type` | Safe metadata only — never `storage_key` or signed URLs |

Empty / whitespace-only `q` returns empty groups for every type (palette must not dump unbounded rows).

---

## 3. Ranking model

Per-type ranked lists (default `limit_per_type` = 5, max 25), ordered by:

1. Heuristic **rank** (higher wins)
2. Recency timestamp (DESC, NULLs last)
3. Stable id

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

Client helpers in `packages/shared/src/search` may re-sort already-fetched hits deterministically; they do not invent tokens or bypass server authz.

Snippets are produced by `app_private.safe_search_snippet` (angle brackets stripped; bounded length).

---

## 4. Authorization

| Actor | Can call RPC? | Notes group | Other groups |
|-------|---------------|-------------|--------------|
| owner / admin / agent | Yes (`authenticated` + workspace membership) | Yes (`can_search_notes = true`) | Yes |
| viewer | Yes | Always empty; `can_search_notes = false` (no error leak when `category=notes`) | Contacts / conversations / non-internal messages / attachments |
| anon / visitor / widget | No (`EXECUTE` revoked) | — | — |

Enforcement:

- `app_private.require_workspace_access(p_workspace_id)` — foreign workspace id → `Workspace not accessible`
- `app_private.global_search` is not executable by `authenticated` / `anon`
- `public.global_search` is `SECURITY DEFINER` with `search_path = ''`; `REVOKE ALL FROM PUBLIC/anon`; `GRANT EXECUTE TO authenticated`
- Server Action also filters note hits via `manage_internal_notes` capability (`filterHitsForPermissions`)

Cross-tenant probes (searching another workspace’s contact email inside your workspace) return no that contact — results are always filtered by `workspace_id`.

---

## 5. RPC contract

```text
public.global_search(p_workspace_id uuid, p_query jsonb DEFAULT '{}') → jsonb
```

### Request (`p_query`)

| Key | Type | Default | Constraints |
|-----|------|---------|-------------|
| `q` | string | `""` | Trimmed; max 200 chars; empty → empty groups |
| `category` | string | `"all"` | `all` \| `contacts` \| `conversations` \| `messages` \| `notes` \| `attachments` |
| `limit_per_type` | int | `5` | Clamped to 1–25 |

Invalid object / overlong `q` / bad category → `INVALID_QUERY:…`

### Response

```json
{
  "q": "jane",
  "category": "all",
  "limit_per_type": 5,
  "can_search_notes": true,
  "groups": {
    "contacts": [ /* GlobalSearchHit */ ],
    "conversations": [],
    "messages": [],
    "notes": [],
    "attachments": []
  }
}
```

### Hit shape (`GlobalSearchHit`)

| Field | Notes |
|-------|-------|
| `type` | `contact` \| `conversation` \| `message` \| `note` \| `attachment` |
| `id` | Entity UUID |
| `title` / `subtitle` / `snippet` | Plain text; HTML angle brackets stripped |
| `timestamp` | ISO timestamptz or null |
| `conversation_id` | Set for conversation/message/note/attachment hits |
| `contact_id` | When known |
| `message_id` | Message and attachment hits |
| `rank` | Numeric, rounded to 4 decimal places |

Shared Zod: `packages/shared/src/schemas/global-search.ts`.

Navigation targets (dashboard): contact → contact profile; conversation → inbox thread; message/attachment → thread `?message=`; note → thread `?tab=notes&note=`.

---

## 6. Scale assumptions

- Tuned for operator workspaces with tens of thousands of contacts/conversations and hundreds of thousands of messages — not multi-million-row global corpora.
- Per-request work is bounded by `limit_per_type` (≤25) × five groups.
- GIN + trigram indexes support prefix/substring without sequential scans on typical inbox volumes.
- Empty query short-circuits (no table scans).
- Conversation vector refresh on contact rename walks that contact’s conversations only (not whole-workspace).

---

## 7. Known v1 limitations

- No semantic / embedding / vector similarity search
- No cross-workspace or admin “search everything” mode
- No saved searches, search history, or analytics
- Notes are binary (messaging roles vs viewers) — no per-note ACL
- Attachment search is filename/mime only (not OCR / file contents)
- Conversation vector omits full message history (messages are a separate group)
- Client debounce (~200ms); no streaming partial results
- Rank heuristics are keyword-oriented; not personalized

---

## 8. Why vector / AI search is out of scope

v1 prioritizes **deterministic, tenant-isolated, explainable** keyword retrieval with RLS-aligned authz and predictable rank boosts for identity fields (email, phone, UUID). Embedding indexes would add provider cost, retention/PII surface area, and ranking opacity without replacing the need for exact-identity matches operators rely on daily. Semantic search can layer later atop the same RPC shape once keyword coverage and authz are proven in production.

---

## 9. Tests

- pgTAP: `supabase/tests/database/019_global_search.test.sql`
- Playwright: `e2e/tests/inbox/global-search.spec.ts`
- Shared unit helpers: `packages/shared/src/search/index.test.ts`
