# Canned Responses

**Status:** Database layer implemented (v1); dashboard UI and Server Actions not yet built  
**Last updated:** 2026-08-16

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [INTERNAL-NOTES.md](./INTERNAL-NOTES.md), [adr/ADR-007-canned-responses.md](./adr/ADR-007-canned-responses.md)

---

## 1. Purpose

Agents answer the same questions all day. Canned responses are reusable reply snippets they can insert from the composer by typing a shortcut (`/greeting`) or by searching.

v1 delivers, at the database layer:

- **Shared** snippets curated by owners and admins, and **personal** snippets private to one member
- Folders for grouping, scoped the same way as the snippets inside them
- Per-member favorites that sort to the top of the picker
- Shortcut autocomplete with exact and prefix matching, plus typo-tolerant search (`pg_trgm`) and full-text search
- `usage_count` telemetry for "most used" ordering
- Soft delete with reconnect catch-up tombstones and realtime publication

Migration: `supabase/migrations/20260816120000_canned_responses.sql`.

---

## 2. Why two visibility scopes?

A single shared library forces agents to either publish every draft phrasing to the whole workspace or keep snippets outside the product. A single personal library gives admins no way to standardise the answers customers actually receive. Both scopes live in one table so search, shortcuts, folders and favorites behave identically:

| Concern            | `visibility = 'workspace'`      | `visibility = 'personal'`               |
| ------------------ | ------------------------------- | --------------------------------------- |
| Who can read       | Every active member             | `owner_member_id` only                  |
| Who can manage     | Owner / admin                   | The owner (must not be a viewer)        |
| `owner_member_id`  | NULL (CHECK-enforced)           | NOT NULL (CHECK-enforced)               |
| Shortcut unique on | `(workspace_id, shortcut)`      | `(workspace_id, owner_member_id, shortcut)` |
| Member removal     | Survives (`created_by` → NULL)  | Cascades away with the membership row   |

Visibility is immutable after create. Promoting a personal snippet means creating a shared copy.

---

## 3. Data model

### `canned_responses`

| Column                          | Notes                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `id`                            | UUID PK                                                                                       |
| `workspace_id`                  | Tenant scope (NOT NULL; never cleared on member removal)                                      |
| `visibility`                    | `app_canned_visibility` enum: `workspace` \| `personal`                                       |
| `owner_member_id`               | NULL iff shared, NOT NULL iff personal; composite FK `ON DELETE CASCADE`                      |
| `folder_id`                     | Optional; composite FK to a folder in the same workspace, `ON DELETE SET NULL (folder_id)`    |
| `title`                         | 1–200 chars                                                                                   |
| `body`                          | 1–4000 chars, plain text with `{{variable}}` placeholders                                     |
| `shortcut`                      | Optional, stored **without** the leading slash and lowercased: `^[a-z0-9][a-z0-9_-]{0,63}$`   |
| `usage_count`                   | `>= 0`; incremented by `record_canned_response_usage`                                         |
| `search_vector`                 | Generated `tsvector` over title + shortcut + body (GIN)                                       |
| `created_by` / `updated_by`     | Composite FKs with column-scoped `ON DELETE SET NULL` so shared history survives              |
| `deleted_at`                    | Soft delete                                                                                   |

Uniqueness is enforced by two partial indexes so a member can shadow a shared shortcut with their own:

- `uq_canned_responses_workspace_shortcut` on `(workspace_id, shortcut)` WHERE `deleted_at IS NULL AND visibility = 'workspace' AND shortcut IS NOT NULL`
- `uq_canned_responses_personal_shortcut` on `(workspace_id, owner_member_id, shortcut)` WHERE `deleted_at IS NULL AND visibility = 'personal' AND shortcut IS NOT NULL`

Because both are partial on `deleted_at IS NULL`, deleting a snippet frees its shortcut immediately.

### `canned_response_folders`

Same visibility/owner rules as snippets, plus `name` (1–100 chars) and `sort_order`. A snippet may only reference a folder with the **same** visibility and owner — `assert_canned_folder_scope` raises `FOLDER_SCOPE_MISMATCH` otherwise, so a personal snippet can never appear inside a shared folder.

Soft-deleting a folder does not fire the foreign key, so `soft_delete_canned_response_folder` first clears `folder_id` on that folder's active snippets. Deleting a folder never deletes its contents.

### `canned_response_favorites`

Unique on `(member_id, canned_response_id)`, composite FKs cascade on both sides, readable only by the owning member. Favorites are kept when a snippet is soft-deleted so an undelete would restore pins.

---

## 4. Permissions

| Actor                 | Read shared | Read own personal | Use / favorite | Manage shared | Manage own personal |
| --------------------- | ----------- | ----------------- | -------------- | ------------- | ------------------- |
| owner / admin         | Yes         | Yes               | Yes            | Yes           | Yes                 |
| agent                 | Yes         | Yes               | Yes            | **No**        | Yes                 |
| viewer                | Yes         | Yes               | **No**         | **No**        | **No**              |
| visitor / widget      | No path     | No path           | No path        | No path       | No path             |

Reading a snippet is reference material, so viewers may list it. *Using* one implies sending a reply, which viewers cannot do — `require_canned_use_access` rejects them for favorites and usage recording, and `require_canned_view_access` is the weaker gate used by the list and get RPCs.

Enforcement layers:

- `app_private.require_canned_view_access` / `require_canned_use_access` / `require_workspace_canned_manage` on every RPC
- `assert_can_manage_canned_response` / `assert_can_manage_canned_folder` for row-level ownership
- RLS `SELECT` policies that re-check `workspace_is_accessible` and the personal-owner predicate
- No `INSERT` / `UPDATE` / `DELETE` grants for `authenticated` on any of the three tables

`app_private` mutation helpers have `EXECUTE` revoked from `PUBLIC` / `anon` / `authenticated`. Only the intentional RLS helpers (`user_workspace_ids`, `user_workspace_role`, `workspace_is_accessible`, `get_caller_member_id`) are re-granted.

---

## 5. API / RPC

All RPCs take `p_workspace_id` first and return `jsonb`.

| RPC                                  | Purpose                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `list_canned_responses`              | Filtered/searched page plus folders, tombstones and a watermark             |
| `get_canned_response`                | One active snippet the caller may see                                       |
| `create_canned_response`             | Shared requires manage; personal forces `owner_member_id` to the caller     |
| `update_canned_response`             | Replaces title, body, shortcut and folder (no-op when nothing changed)      |
| `soft_delete_canned_response`        | Sets `deleted_at` (idempotent)                                              |
| `list_canned_response_folders`       | Folders with their own tombstones and watermark                             |
| `create_canned_response_folder`      | Shared requires manage; personal is owned by the caller                     |
| `update_canned_response_folder`      | Renames and reorders                                                        |
| `soft_delete_canned_response_folder` | Unfiles active snippets, then tombstones the folder (idempotent)            |
| `set_canned_response_favorite`       | Pins/unpins for the calling member                                          |
| `record_canned_response_usage`       | Increments `usage_count` and returns the snippet                            |

### `list_canned_responses(p_workspace_id, p_query jsonb)`

| Query key         | Type            | Default | Behaviour                                                                     |
| ----------------- | --------------- | ------- | ----------------------------------------------------------------------------- |
| `q`               | text (≤200)     | —       | Fuzzy search; see §6                                                          |
| `folder_id`       | uuid \| `"none"`| —       | Absent or JSON `null` = no filter; `"none"` = unfiled only                    |
| `visibility`      | text            | `all`   | `workspace` \| `personal` \| `all`                                            |
| `favorites_only`  | boolean         | `false` | Restricts to the caller's pins                                                |
| `include_folders` | boolean         | `true`  | When false, the `folders` key is omitted entirely                             |
| `limit`           | integer         | `100`   | Clamped to 1–200                                                              |
| `catch_up_since`  | timestamptz     | —       | Returns tombstones in the window; also narrows items unless `authoritative`   |
| `authoritative`   | boolean         | `false` | Returns the full top page regardless of `catch_up_since`                      |

Response: `{ items, folders?, tombstones, has_more, authoritative, server_watermark }`.

There is no cursor: `has_more` means the page was truncated at `limit` and the caller should narrow with `q`, `folder_id` or `visibility`. `folders` lists only **active** folders; folder deletions reconcile through `list_canned_response_folders`, which returns its own tombstones and watermark, so a client tracks two watermarks.

Each item carries `is_favorited` for the calling member, `folder_id`, `usage_count`, and display labels for owner/creator/last editor (`Former member` once the member row is gone).

`list_canned_response_folders` accepts `visibility`, `limit` (default 200, max 500), `catch_up_since` and `authoritative`, and returns `{ items, tombstones, has_more, authoritative, server_watermark }`. Each folder item includes `response_count` (active snippets filed in it).

### Typed errors

Stable prefixes, matching the internal-notes convention:

- `FORBIDDEN`
- `CANNED_NOT_FOUND` / `CANNED_DELETED`
- `FOLDER_NOT_FOUND` / `FOLDER_DELETED` / `FOLDER_SCOPE_MISMATCH`
- `SHORTCUT_TAKEN`
- `INVALID_TITLE` / `INVALID_BODY` / `INVALID_NAME` / `INVALID_SHORTCUT` / `INVALID_VISIBILITY` / `INVALID_SORT_ORDER` / `INVALID_QUERY`

A workspace the caller does not belong to raises the shared `Workspace not accessible` error from `app_private.require_workspace_access` before any canned-response check runs.

### Concurrent edits (v1)

Last-write-wins. There is no CAS or version check, matching internal notes v1. An identical update (same title, body, shortcut and folder) is detected and skipped, so it neither writes nor bumps `updated_at`.

---

## 6. Search and shortcuts

Shortcuts are normalized on write by `app_private.normalize_canned_shortcut`: trim, strip leading slashes, lowercase, then validate `^[a-z0-9][a-z0-9_-]{0,63}$`. An empty result stores `NULL`; anything else that fails the pattern raises `INVALID_SHORTCUT`. Operators type `/greeting`, the database stores `greeting`.

A search matches when any of these hold:

1. `title`, `shortcut` or `body` contains the query (`ILIKE`, with `%`, `_` and `\` escaped so a literal `%` cannot match everything)
2. The slash-stripped query is a **prefix** of a shortcut — this is what makes `/gre` autocomplete work
3. Trigram similarity over `title || ' ' || shortcut || ' ' || body` (`pg_trgm` `%` operator, GIN expression index)
4. `search_vector @@ plainto_tsquery('english', q)`

Ranking, highest first: exact shortcut match (`1.0`), shortcut prefix (`0.5`), `0.6 × similarity`, `0.4 × ts_rank`, and `+0.15` when the caller has favorited the snippet. Without `q`, results are favorites first, then title ascending.

The trigram index expression must stay byte-identical to the expression in `list_canned_responses`, or the planner will fall back to a sequential scan.

---

## 7. Realtime

- All three tables are in `supabase_realtime` with `REPLICA IDENTITY FULL`
- Soft delete arrives as an UPDATE with `deleted_at` set
- `usage_count` bumps deliberately **do not** broadcast: the `set_updated_at` trigger has a `WHEN` clause covering only content columns, so a hot snippet does not emit an UPDATE (and does not re-enter every catch-up window) on each insertion. Counters converge on the next full list
- Catch-up: call the list RPC with `authoritative: true` plus a `catch_up_since` watermark when the client has one. Tombstones are limited to soft deletes with `updated_at >= catch_up_since`; without the watermark there is no unbounded deleted-row scan
- `server_watermark` is computed in Postgres from `catch_up_since` and the returned rows — never `now()` or a browser clock, which could skip a concurrent soft delete forever

Visitors never subscribe to these tables (RLS plus no widget wiring). Snippet bodies never appear in widget APIs or visitor realtime; only the message an agent actually sends does.

---

## 8. Retention

Soft-deleted snippets and folders are retained indefinitely until the workspace is purged, matching `docs/DATA-RETENTION.md`. Workspace deletion cascades all three tables.

---

## 9. Known v1 limitations

- No dashboard UI, Server Actions, or `@site-chat/shared` schemas yet — this migration is the database contract those will build on
- Variable substitution (`{{visitor.name}}`, `{{agent.name}}`, `{{workspace.name}}`) is stored verbatim in `body`; rendering is a client concern and is not implemented
- Visibility cannot be changed after create (copy instead)
- Concurrent edits are last-write-wins (no CAS)
- No shortcut resolution order is defined for a personal snippet shadowing a shared one; the composer decides (personal-first is the intended behaviour)
- `usage_count` is eventually consistent for other members
- No usage analytics beyond the raw counter, and no "most used" ordering in the list RPC yet
- Snippets are not surfaced in inbox search (`list_conversations` `q`)
