# Canned Responses

**Status:** Implemented (v1) — database, shared schemas, Server Actions, settings UI and composer insertion  
**Last updated:** 2026-08-16

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [INTERNAL-NOTES.md](./INTERNAL-NOTES.md), [adr/ADR-007-canned-responses.md](./adr/ADR-007-canned-responses.md)

---

## 1. Purpose

Agents answer the same questions all day. Canned responses are reusable reply snippets they can insert from the composer by typing a shortcut (`/greeting`) or by searching.

v1 delivers:

- **Shared** snippets curated by owners and admins, and **personal** snippets private to one member
- Folders for grouping, scoped the same way as the snippets inside them
- Per-member favorites that sort to the top of the picker
- Shortcut autocomplete with exact and prefix matching, plus typo-tolerant search (`pg_trgm`) and full-text search
- `{{variable}}` substitution at insertion time (§8)
- `usage_count` telemetry for "most used" ordering
- Soft delete with reconnect catch-up tombstones and realtime publication
- A settings library (create / edit / delete / favorite / folders) and `/shortcut` insertion from the reply composer

Key files:

| Layer            | Location                                                                          |
| ---------------- | --------------------------------------------------------------------------------- |
| Migration        | `supabase/migrations/20260816120000_canned_responses.sql`                          |
| Database tests   | `supabase/tests/017_canned_responses.test.sql`                                     |
| Shared schemas   | `packages/shared/src/schemas/canned-responses.ts`                                  |
| Shared helpers   | `packages/shared/src/canned/` (`variables`, `slash`, `search`, `state`, `errors`)   |
| Queries/actions  | `apps/web/lib/canned/`                                                            |
| Realtime         | `apps/web/lib/realtime/use-canned-responses.ts`                                    |
| Settings UI      | `apps/web/components/settings/CannedResponsesManager.tsx`                          |
| Composer         | `apps/web/components/inbox/CannedSlashMenu.tsx`                                    |
| E2E              | `e2e/tests/inbox/canned-responses.spec.ts`                                         |

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

The dashboard mirrors these gates with three capabilities in `packages/shared/src/permissions/capabilities.ts`:

| Capability                          | Roles                          | Guards                                                    |
| ----------------------------------- | ------------------------------ | --------------------------------------------------------- |
| `view_canned_responses`             | owner, admin, agent, viewer    | Settings route guard, list actions                        |
| `use_canned_responses`              | owner, admin, agent            | Favorite, usage, personal CRUD, composer slash menu       |
| `manage_workspace_canned_responses` | owner, admin                   | Create/update/delete of `visibility = 'workspace'` rows   |

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
3. Trigram **word** similarity over `title || ' ' || shortcut || ' ' || body` (`pg_trgm` `<%` operator, GIN expression index)
4. `search_vector @@ plainto_tsquery('english', q)`

Word similarity (`<%`) is used rather than whole-string similarity (`%`) deliberately. `similarity()` normalizes over the union of both strings' trigrams, so a one-word typo against a three-sentence body scores around `0.08` and never clears the default `0.3` threshold. `word_similarity()` compares the query against the closest run of words in the document instead, so the same typo scores around `0.64` and clears the default `0.6` word threshold regardless of body length.

Ranking, highest first: exact shortcut match (`1.0`), shortcut prefix (`0.5`), `0.6 × word_similarity`, `0.4 × ts_rank`, and `+0.15` when the caller has favorited the snippet. Without `q`, results are favorites first, then title ascending.

The trigram index expression must stay byte-identical to the expression in `list_canned_responses`, or the planner will fall back to a sequential scan.

---

## 7. Realtime

- All three tables are in `supabase_realtime` with `REPLICA IDENTITY FULL`
- Soft delete arrives as an UPDATE with `deleted_at` set
- `usage_count` bumps deliberately **do not** broadcast: the `set_updated_at` trigger has a `WHEN` clause covering only content columns, so a hot snippet does not emit an UPDATE (and does not re-enter every catch-up window) on each insertion. Counters converge on the next full list
- Catch-up: call the list RPC with `authoritative: true` plus a `catch_up_since` watermark when the client has one. Tombstones are limited to soft deletes with `updated_at >= catch_up_since`; without the watermark there is no unbounded deleted-row scan
- `server_watermark` is computed in Postgres from `catch_up_since` and the returned rows — never `now()` or a browser clock, which could skip a concurrent soft delete forever

Visitors never subscribe to these tables (RLS plus no widget wiring). Snippet bodies never appear in widget APIs or visitor realtime; only the message an agent actually sends does.

The dashboard subscribes through `subscribeOperatorCannedResponses` (one channel, three `postgres_changes` bindings: snippets and folders filtered by `workspace_id`, favorites filtered by the caller's `member_id`). CDC rows are not merged directly: they carry no display labels and no per-caller `is_favorited`, so a non-delete change schedules a coalesced authoritative catch-up (250 ms) instead of a lossy partial merge. Soft deletes apply immediately from the CDC row, and a session-local tombstone set prevents an in-flight list from resurrecting a row the operator just deleted.

---

## 8. Variables

Bodies store `{{token}}` verbatim. Substitution happens in the browser at insertion time, so editing a snippet immediately changes what every later insertion renders, and a snippet in the library never contains one conversation's data.

| Token                 | Source                                              |
| --------------------- | --------------------------------------------------- |
| `{{visitor.name}}`    | `conversation.contact.name`                          |
| `{{visitor.email}}`   | `conversation.contact.email`                         |
| `{{operator.name}}`   | Display label of the member inserting the snippet     |
| `{{workspace.name}}`  | Current workspace name                                |
| `{{conversation.id}}` | Open conversation's id                                |

`{{agent.name}}` is accepted as an alias of `{{operator.name}}` because PRD §4.10 documents that spelling; the dashboard calls members "operators", so `operator.name` is canonical and is the token the variable chips insert.

Resolution rules (`packages/shared/src/canned/variables.ts`):

- Inner whitespace is tolerated (`{{ visitor.name }}`), and token names are matched case-insensitively.
- An **unknown** token is left untouched, so a typo stays visible to the operator instead of silently vanishing.
- A **known** token with no value resolves to the empty string. Sending literal `{{visitor.name}}` to a customer is worse than an empty slot the operator can see and fix before pressing send. `interpolateCannedBody(body, ctx, { missing: "token" })` keeps the placeholder when a caller wants preview semantics instead.

Substitution is plain text replacement into a `<textarea>`; there is no HTML rendering, so no injection surface. The operator always sees the interpolated text and must press Send.

---

## 9. Application layer

### Shared package

`packages/shared/src/schemas/canned-responses.ts` mirrors `build_canned_response_item` / `build_canned_folder_item` as strict Zod objects, plus the query and mutation inputs. Shortcut inputs accept what an operator types (`/Refund `) and normalize to storage form (`refund`) before validation, so the client and `normalize_canned_shortcut` agree.

`packages/shared/src/canned/` holds the framework-free logic:

| Module         | Responsibility                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `errors.ts`    | `CannedError` plus `parseCannedErrorMessage` for every typed prefix in §5                            |
| `variables.ts` | Token list, extraction, interpolation (§8)                                                          |
| `slash.ts`     | `detectSlashTrigger` / `replaceSlashTrigger` / shortcut display and normalization                    |
| `search.ts`    | Client-side ranking of an already-loaded list for the slash menu and settings search                 |
| `state.ts`     | Realtime merge, catch-up reconcile and watermark seed/advance for snippets **and** folders            |
| `messages.ts`  | English operator copy                                                                              |

`search.ts` never replaces the SQL search — it only keeps an in-memory list responsive while typing. Its weights follow the RPC's intent (exact shortcut, then prefix, then title, then body, with a favorite nudge), and ties prefer a personal snippet over a shared one, matching the personal-first shadowing rule.

### Server Actions

`apps/web/lib/canned/queries.ts` wraps the RPCs and validates every payload; `actions.ts` exposes them as Server Actions returning `{ success: true, data } | { success: false, message, code? }`. Every action resolves the workspace from the URL slug through the caller's membership (`requireCannedWorkspace`) — never from a client-supplied workspace id — and then asserts the capability for the operation:

| Action                                                       | Capability                                        |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `listCannedResponsesAction`, `listCannedResponseFoldersAction`| `view_canned_responses`                           |
| `setCannedResponseFavoriteAction`, `recordCannedResponseUsageAction` | `use_canned_responses`                     |
| create / update / soft delete of a **shared** row or folder   | `manage_workspace_canned_responses`               |
| create / update / soft delete of a **personal** row or folder  | `use_canned_responses`                            |

Because visibility is immutable, update and delete read the stored row's visibility first and gate on that, rather than trusting the submitted scope. Ownership itself is re-checked in the RPC. Mutations revalidate the settings route (and the inbox layout when the composer's library changed); `recordCannedResponseUsageAction` deliberately revalidates nothing, since `usage_count` does not bump `updated_at`.

---

## 10. Dashboard UI

`/app/[workspaceSlug]/settings/canned-responses` renders the library from an SSR prefetch and keeps it live through `useLiveCannedResponses`:

- Scope tabs: All / Shared / Personal / Favorites
- Folder sidebar with create, inline rename and delete (deleting a folder unfiles its snippets, it never deletes them)
- Search over the loaded list; when the page was truncated (`has_more`) the query is sent to the RPC instead, so a large library still searches everything
- Create/edit form with title, body, shortcut, visibility (locked after create) and folder, plus variable chips that insert tokens at the caret and a warning listing unrecognized `{{tokens}}`
- Favorite toggle and two-step soft delete, both applied optimistically and rolled back if the action fails

Role behaviour: a viewer gets a read-only list, an agent can manage only their own personal snippets and folders while shared rows stay read-only apart from favoriting, and owners/admins manage everything.

In the reply composer (`LiveConversationThread`), typing `/` at a word boundary opens `CannedSlashMenu`, using the same keyboard model as `@mention` autocomplete (Arrow keys, Enter/Tab to insert, Escape to dismiss). A slash inside a URL or mid-word does not trigger it. Selecting an entry replaces the `/query` with the interpolated body, then calls `recordCannedResponseUsageAction` fire-and-forget. The menu appears only for roles that may both send messages and use snippets.

---

## 11. Retention

Soft-deleted snippets and folders are retained indefinitely until the workspace is purged, matching `docs/DATA-RETENTION.md`. Workspace deletion cascades all three tables.

---

## 12. Tests

| Layer      | Location                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| pgTAP      | `supabase/tests/017_canned_responses.test.sql` — RLS, scopes, typed errors, catch-up    |
| Vitest     | `packages/shared/src/canned/canned.test.ts` — variables, slash, ranking, merge, errors  |
| Vitest     | `apps/web/lib/permissions/can.test.ts` — the three capabilities per role                |
| Playwright | `e2e/tests/inbox/canned-responses.spec.ts` — publish, insert with variables, personal isolation, viewer read-only, favorite + soft delete |

---

## 13. Known v1 limitations

- Visibility cannot be changed after create (copy instead)
- Concurrent edits are last-write-wins (no CAS)
- `usage_count` is eventually consistent for other members
- No usage analytics beyond the raw counter, and no "most used" ordering in the list RPC yet
- Snippets are not surfaced in inbox search (`list_conversations` `q`)
- The settings library and the composer both load at most 200 snippets per page; beyond that, search reaches the RPC rather than paginating
- Snippet bodies are plain text: no rich text, attachments or per-snippet locales
- Folder ordering is stored (`sort_order`) but the UI has no drag-and-drop reorder yet
