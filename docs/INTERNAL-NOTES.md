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
| `search_vector` | Generated `tsvector` (GIN) for PR #32 global search |
| `deleted_at` | Soft delete |

### `internal_note_mentions`

Unique `(note_id, mentioned_member_id)`. Mention targets must be active owner/admin/agent in the same workspace (viewers cannot be mentioned). On edit, the submitted mention set **replaces** persisted rows (no sticky union with old IDs).

### `notifications`

Minimal durable notification store (Phase 3 foundation). Mention rows use `type = 'mention'`, `resource_type = 'internal_note'`, `resource_id = note_id`. There is **no lifetime unique constraint** suppressing future notifications: remove → re-add intentionally notifies again. Notification `body` is a short label (who mentioned you), never the note body.

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

- Client generates one `clientNoteId` when a draft begins; reuses it across submit / transport retry / ambiguous retry; resets only after authoritative success or explicit draft reset.
- Server uses atomic `INSERT … ON CONFLICT (conversation_id, client_note_id) … DO NOTHING`. Concurrent identical keys produce exactly one durable note, one created timeline event, and mention/notification side effects only for the winner.

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
- On connect / CDC: **authoritative** catch-up via `list_internal_notes` with `authoritative: true`, returning active items + soft-delete **tombstones**. Client `reconcileNotesCatchUp` applies tombstones so a delete missed while disconnected is removed; CDC creates that arrive during an in-flight catch-up are retained (not wiped by a stale empty page)
- Soft-delete also records a **session-local tombstone** and aborts in-flight catch-up so a response that still lists the note cannot resurrect it after the operator deleted it
- Selecting the Internal Notes tab triggers catch-up so peers load creates even if CDC was delayed
- Conversation switches bump a generation counter and abort in-flight catch-up (`AbortController`) so stale responses never merge into the wrong thread
- Mentioned operators also receive notification INSERT on `recipient_id`

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
- `list_conversations` `q` matches note bodies / FTS for owner/admin/agent only
- Viewers never match note content through inbox search

Preparation for PR #32 global search: durable indexed text already exists under RLS.

---

## 10. UI

Conversation main panel tabs: **Messages** | **Internal Notes**.

Notes use amber-tinted surfaces, author avatar initials, timestamps, mention highlighting, and a composer with keyboard-navigable `@` autocomplete. After author member removal, `author_display_label` is **Former member** and the historical note remains readable.

---

## 11. Known v1 limitations

- Concurrent edits are last-write-wins (no CAS)
- No email delivery for mentions (Phase 3 notification preferences / Resend)
- No full notification center UI (durable rows + realtime flash only)
- Author display label is email-based until `display_name` lands
- Notes are not mixed into the message transcript (separate tab by design)
- Authoritative catch-up tombstones cover soft-deletes updated/deleted in the catch-up window; clients should prefer authoritative reconnect over inferring deletes from a truncated active page alone
