# Internal Notes + @mentions

**Status:** Implemented (v1)  
**Last updated:** 2026-08-13

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [CUSTOMER-TIMELINE.md](./CUSTOMER-TIMELINE.md), [adr/ADR-006-internal-notes.md](./adr/ADR-006-internal-notes.md)

---

## 1. Purpose

Operators need a **private** place to leave context on a conversation (handoffs, risk flags, billing notes) without ever exposing that text to visitors.

v1 delivers:

- Durable `internal_notes` per conversation (soft delete)
- `@mentions` resolved against workspace members
- Durable in-app `notifications` for mentions
- Customer Timeline events
- Operator realtime (create / edit / delete + reconnect catch-up)
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
| `workspace_id` | Tenant scope |
| `conversation_id` | Composite FK with workspace |
| `author_member_id` | Set on create; `ON DELETE SET NULL` so history survives member removal |
| `body` | 1–4000 chars |
| `client_note_id` | Optional create idempotency (partial unique per conversation) |
| `search_vector` | Generated `tsvector` (GIN) for PR #32 global search |
| `deleted_at` | Soft delete |

### `internal_note_mentions`

Unique `(note_id, mentioned_member_id)`. Mention targets must be active owner/admin/agent in the same workspace (viewers cannot be mentioned).

### `notifications`

Minimal durable notification store (Phase 3 foundation). Mention rows use `type = 'mention'`, `resource_type = 'internal_note'`, `resource_id = note_id`, with a partial unique index to prevent duplicate mention notifications per recipient/note.

---

## 4. Permissions

| Actor | Read | Write |
|-------|------|-------|
| owner / admin / agent | Yes | Yes (`manage_internal_notes`) |
| viewer | No | No |
| visitor / widget | No path | No path |

Enforcement: Server Action capability + `app_private.require_notes_access` / `require_messaging_role` + RLS SELECT for messaging roles only. No direct INSERT/UPDATE/DELETE for `authenticated`.

---

## 5. API / RPC

| RPC | Purpose |
|-----|---------|
| `list_internal_notes` | Newest page, chronological ASC response, keyset `before` / `after` |
| `create_internal_note` | Body + optional `client_note_id` + `mentioned_member_ids` |
| `update_internal_note` | Replace body + mention set |
| `soft_delete_internal_note` | Sets `deleted_at` (idempotent) |
| `get_internal_note` | Single active note |

Typed errors (stable prefixes → `NoteError` in `@site-chat/shared`):

- `FORBIDDEN`
- `NOTE_NOT_FOUND` / `NOTE_DELETED`
- `CONVERSATION_NOT_FOUND`
- `MEMBER_NOT_FOUND` / `MEMBER_NOT_MENTIONABLE`
- `INVALID_BODY`

---

## 6. Mentions

1. Composer `@` autocomplete over `list_assignable_members` (messaging roles)
2. Client sends explicit `mentionedMemberIds` plus body text
3. Shared helpers also resolve unambiguous `@token` matches (email local-part or full label)
4. Server validates each id with `assert_mentionable_member`
5. Sync replaces mention rows; new mentions emit `mention_created` + notification once (dedupe)

---

## 7. Realtime

- `internal_notes` and `notifications` in `supabase_realtime` with `REPLICA IDENTITY FULL`
- Operator thread notes channel: INSERT/UPDATE filtered by `conversation_id`
- Soft delete arrives as UPDATE with `deleted_at`
- On connect / CDC: catch-up via `list_internal_notes` + `mergeInternalNotes` (id + `updated_at`, no duplicates)
- Mentioned operators also receive notification INSERT on `recipient_id`

Visitors never subscribe to these tables (RLS + no widget wiring).

---

## 8. Timeline

| Event | Dedupe key |
|-------|------------|
| `internal_note_created` | `internal_note:{id}:created` |
| `internal_note_updated` | `internal_note:{id}:updated:{epoch}` |
| `internal_note_deleted` | `internal_note:{id}:deleted` |
| `mention_created` | `internal_note:{id}:mention:{member_id}` |

Metadata includes member ids/labels and `note_id` — **never note body** (emit helper already strips `body`).

---

## 9. Search

- GIN on `search_vector` where `deleted_at IS NULL`
- `list_conversations` `q` matches note bodies / FTS for owner/admin/agent only
- Viewers never match note content through inbox search

Preparation for PR #32 global search: durable indexed text already exists under RLS.

---

## 10. UI

Conversation main panel tabs: **Messages** | **Internal Notes**.

Notes use amber-tinted surfaces, author avatar initials, timestamps, mention highlighting, and a composer with keyboard-navigable `@` autocomplete.

---

## 11. Known v1 limitations

- No email delivery for mentions (Phase 3 notification preferences / Resend)
- No full notification center UI (durable rows + realtime flash only)
- Author display label is email-based until `display_name` lands
- Notes are not mixed into the message transcript (separate tab by design)
