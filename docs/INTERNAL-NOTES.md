# Internal Notes + @mentions

**Status:** Implemented (v1)  
**Last updated:** 2026-08-14

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [CUSTOMER-TIMELINE.md](./CUSTOMER-TIMELINE.md), [adr/ADR-006-internal-notes.md](./adr/ADR-006-internal-notes.md)

---

## 1. Purpose

Operators need a **private** place to leave context on a conversation (handoffs, risk flags, billing notes) without ever exposing that text to visitors.

v1 delivers:

- Durable `internal_notes` per conversation (soft delete)
- `@mentions` resolved against workspace members (ID-backed tokens)
- Durable in-app `notifications` for mentions (re-add notifies again)
- Customer Timeline events (hidden from Viewer)
- Operator realtime (create / edit / delete + authoritative reconnect catch-up with tombstones)
- Search indexing (`search_vector` + inbox `q` match for messaging roles)

---

## 2. Why not `messages.is_internal`?

The inbox foundation already has `messages.is_internal` for visitor/widget isolation. Notes are a **separate product entity** because they require:

| Need | Messages | Notes |
|------|----------|-------|
| Soft delete | No | Yes (`deleted_at`) |
| Edit in place | Append-only | `update_internal_note` |
| Mentions table | No | `internal_note_mentions` |
| Timeline created/updated/deleted | Message-sent only | Four event types |
| Never bump inbox preview | Would need special-case | Native |

`messages.is_internal` remains as defense-in-depth for any future internal-as-message use and continues to filter widget broadcasts / visitor lists / viewer RLS.

---

## 3. Data model

### `internal_notes`

| Column | Notes |
|--------|--------|
| `id` | UUID PK |
| `workspace_id` | Tenant scope (NOT NULL; never cleared on member removal) |
| `conversation_id` | Composite FK with workspace |
| `author_member_id` | Set on create; composite FK `ON DELETE SET NULL (author_member_id)` so history survives member removal |
| `body` | 1–4000 chars |
| `client_note_id` | Optional create idempotency (partial unique per conversation) |
| `search_vector` | Generated `tsvector` (GIN) for global search |
| `deleted_at` | Soft delete |

### `internal_note_mentions`

Unique `(note_id, mentioned_member_id)`. Mention targets must be active owner/admin/agent in the same workspace (viewers cannot be mentioned). On edit, the submitted mention set **replaces** persisted rows (no sticky union with old IDs).

### `notifications`

Durable notification store. Mention rows use `type = 'mention'`, `resource_type = 'internal_note'`, `resource_id = note_id`, and `dedupe_key = mention:{mention_row_id}`. Re-adding a mention after removal inserts a new mention row → new dedupe key → notifies again. Notification `body` is a short label (who mentioned you), never the note body. Full center UI, preferences, DND side-effect suppression (durable history still persists), and additional types: `docs/NOTIFICATIONS.md`.

---

## 4. Permissions

| Actor | Notes CRUD | Note/mention timeline events |
|-------|------------|------------------------------|
| owner / admin / agent | Yes (`manage_internal_notes`) | Yes |
| viewer | No | **No** (RLS + `list_customer_timeline` filter) |
| visitor / widget | No path | No path |

Enforcement: Server Action capability + `app_private.require_notes_access` / `require_messaging_role` + RLS SELECT for messaging roles only. No direct INSERT/UPDATE/DELETE for `authenticated`.

`app_private` mutation helpers (`sync_internal_note_mentions`, create/update/list/soft_delete/get internals, etc.) have EXECUTE revoked from `PUBLIC` / `anon` / `authenticated`. Only intentional RLS helpers (`user_workspace_ids`, `user_workspace_role`, `workspace_is_accessible`, `get_caller_member_id`) are re-granted to `authenticated`.

---

## 5. API / RPC

| RPC | Purpose |
|-----|---------|
| `list_internal_notes` | Newest page, chronological ASC; optional `authoritative` + `catch_up_since` returns `tombstones` for reconnect |
| `create_internal_note` | Body + optional `client_note_id` + `mentioned_member_ids` |
| `update_internal_note` | Replace body + mention set (no-op when both unchanged) |
| `soft_delete_internal_note` | Sets `deleted_at` (idempotent) |
| `get_internal_note` | Single active note |

### Create idempotency

- Client generates one `clientNoteId` when a draft begins; reuses it across submit / transport retry / ambiguous retry; resets only after authoritative success or explicit draft reset (`retry as new`).
- Server uses atomic `INSERT … ON CONFLICT (conversation_id, client_note_id) … DO NOTHING`. Concurrent identical keys on an **active** row produce exactly one durable note, one created timeline event, and mention/notification side effects only for the winner.
- `client_note_id` is lifetime-unique (partial unique index includes soft-deleted rows). If a retry conflicts with a soft-deleted row, the server raises **`NOTE_DELETED`** and does **not** return success, resurrect content, or emit new timeline/mention/notification side effects. The client keeps the draft and offers **Save as new note** (fresh `clientNoteId`).

### Concurrent edits (v1)

Last-write-wins on `update_internal_note`. There is **no CAS / version check** in v1; callers must not assume optimistic concurrency control.

Typed errors (stable prefixes → `NoteError` in `@site-chat/shared`):

- `FORBIDDEN`
- `NOTE_NOT_FOUND` / `NOTE_DELETED`
- `CONVERSATION_NOT_FOUND`
- `MEMBER_NOT_FOUND` / `MEMBER_NOT_MENTIONABLE`
- `INVALID_BODY`

---

## 6. Mentions

1. Composer `@` autocomplete over `list_assignable_members` (active messaging roles only; deactivated members excluded)
2. Identity is **member id**. Composer inserts ID-backed tokens: `@[Display Label](member:<uuid>)` (labels may contain spaces; duplicate display names remain distinct)
3. Submit sends `mentionedMemberIds` derived **only** from ID-backed tokens still present in the current body (never unions with previously persisted mention rows)
4. Plain `@text` that does not resolve to an ID-backed token does not create a mention
5. Duplicate occurrences of the same member collapse to one mention row
6. Server validates each id with `assert_mentionable_member` and syncs by DELETE missing + INSERT new
7. Newly inserted mention rows emit `mention_created` + notification; re-add after remove notifies again
8. Escape closes autocomplete even when the filtered list is empty; arrow keys navigate results

---

## 7. Realtime

- `internal_notes` and `notifications` in `supabase_realtime` with `REPLICA IDENTITY FULL`
- Operator thread notes channel: INSERT/UPDATE filtered by `conversation_id`
- Soft delete arrives as UPDATE with `deleted_at`
- **CDC:** apply lightweight local merge when the row parses (including soft-delete removal). Do **not** fire a full DB catch-up on every CDC/mention flash.
- **Catch-up** (connect, notes-tab focus/visibility, Retry): `list_internal_notes` with `authoritative: true` **and** a client watermark `catch_up_since` when one exists. Returns the newest active page (bounded) plus soft-delete **tombstones with `updated_at >= catch_up_since` only** — never an unbounded deleted-row scan. Index: `idx_internal_notes_conversation_tombstones` on `(workspace_id, conversation_id, updated_at DESC, id DESC) WHERE deleted_at IS NOT NULL`.
- The watermark is a **database cursor**, never a browser clock. Client seeds from `max(updated_at)` of SSR/local notes (or omits `catch_up_since` when empty). After a successful apply it advances to `MAX(previous, returned items/tombstones updated_at, RPC server_watermark)`. `server_watermark` is computed in Postgres the same way — never `now()` / client `Date.now()`, which could skip concurrent soft-deletes forever.
- Stale catch-up responses after a conversation switch are ignored and must not advance the current conversation’s watermark.
- Soft-delete also records a **session-local tombstone** and invalidates in-flight catch-up so a response that still lists the note cannot resurrect it after the operator deleted it
- Conversation switches bump a generation counter so stale catch-up responses never merge into the wrong thread (latest request-id wins; in-flight list calls are not AbortController-cancelled)
- Mentioned operators also receive notification INSERT on `recipient_id` (flash only; body comes from note CDC / focus catch-up)

Visitors never subscribe to these tables (RLS + no widget wiring). Note bodies never appear in widget APIs, visitor Realtime, or visitor-facing timeline.

---

## 8. Timeline

| Event | Dedupe key |
|-------|------------|
| `internal_note_created` | `internal_note:{id}:created` |
| `internal_note_updated` | `internal_note:{id}:updated:{epoch}` |
| `internal_note_deleted` | `internal_note:{id}:deleted` |
| `mention_created` | `internal_note:{id}:mention_row:{mention_row_id}` |

Metadata includes member ids/labels and `note_id` — **never note body** (emit helper already strips `body`).

**Viewer isolation:** Viewers cannot see `internal_note_*` or `mention_created` through direct SELECT / Realtime RLS **or** `list_customer_timeline`. Owner/admin/agent retain access per the capability model.

---

## 9. Search

- GIN on `search_vector` where `deleted_at IS NULL`
- Body trigram GIN (`idx_internal_notes_body_trgm`) for partial matches
- `list_conversations` `q` matches note bodies / FTS for owner/admin/agent only
- Viewers never match note content through inbox search
- **Global search** (`public.global_search`) reuses the same vector; messaging roles search notes; viewers always receive an empty notes group with `can_search_notes = false` (see `docs/GLOBAL-SEARCH.md`)

---

## 10. UI

Conversation main panel tabs: **Messages** | **Internal Notes**.

Notes use amber-tinted surfaces, author avatar initials, timestamps, mention highlighting, and a composer with keyboard-navigable `@` autocomplete. After author member removal, `author_display_label` is **Former member** and the historical note remains readable.

---

## 11. Known v1 limitations

- Concurrent edits are last-write-wins (no CAS)
- No full notification center UI beyond durable rows + realtime flash (superseded by PR #35 — see `docs/NOTIFICATIONS.md`)
- Author display label is email-based until `display_name` lands
- Notes are not mixed into the message transcript (separate tab by design)
- Authoritative catch-up sends a `catch_up_since` watermark when the client has a server-originated cursor; tombstones are limited to soft-deletes with `updated_at >= watermark` (supported by `idx_internal_notes_conversation_tombstones`). The RPC also returns `server_watermark` (GREATEST of `catch_up_since` and returned row `updated_at` values). Missed deletes in-window still reconcile; full-history tombstone scans and client-clock cursor jumps are not used.
