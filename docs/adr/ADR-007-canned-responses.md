# ADR-007: Canned Responses with Shared and Personal Scopes

**Status:** Accepted  
**Date:** 2026-08-16  
**Deciders:** Engineering

## Context

Agents need reusable reply snippets with shortcut autocomplete in the composer (PRD §4.10). `docs/DATABASE.md` §8.1 sketched a single workspace-scoped `canned_responses` table with a free-text `category` column and admin-only CRUD.

Two things about that sketch do not survive contact with the product:

1. **Admin-only CRUD is too coarse.** Agents accumulate personal phrasing they do not want to push into the shared library, and admins do not want to curate everyone's drafts. A single shared scope forces agents to either pollute the workspace library or keep snippets outside the product.
2. **A `category` text column has no integrity.** It cannot be renamed atomically, ordered deliberately, or scoped (a personal snippet and a shared snippet would share a category string), and it invites typo-forked duplicates.

The composer also needs typo-tolerant search over title, shortcut and body, which a `LIKE` scan cannot serve once a workspace has a few hundred snippets.

## Decision

1. **One table, two scopes.** `canned_responses.visibility` is an `app_canned_visibility` enum (`workspace` | `personal`) with `owner_member_id` NULL for shared rows and NOT NULL for personal rows, enforced by a CHECK. A single table keeps search, shortcuts, folders and favorites uniform; separate tables would duplicate every index and RPC.
2. **Folders replace `category`.** `canned_response_folders` is a real entity with its own visibility/owner scope, `sort_order`, soft delete and composite FK. A snippet may only join a folder in the same workspace **and** the same visibility/owner scope, so a personal snippet can never surface inside a shared folder listing.
3. **Favorites are a join table, not a JSON array.** `canned_response_favorites` is unique on `(member_id, canned_response_id)` and readable only by its owner, which keeps "pinned" per-member without rewriting the snippet row on every pin.
4. **Shortcuts are stored slash-free and lowercase.** Two partial unique indexes apply: workspace-wide for shared shortcuts and per-member for personal ones. A member may therefore shadow a shared `/greeting` with their own — the resolution order is a client concern, not a database conflict.
5. **Search is FTS plus trigram word similarity.** A generated `search_vector` covers title + shortcut + body, and a `pg_trgm` GIN expression index over the same concatenation makes misspellings match. Matching uses `<%` (word similarity), not `%`: whole-string `similarity()` normalizes over both strings, so a one-word typo against a multi-sentence body scores far below the default threshold and would silently never match. Ranking boosts an exact shortcut hit above a prefix hit above word similarity, with a small nudge for the caller's favorites.
6. **`usage_count` does not bump `updated_at`.** The `set_updated_at` trigger carries a `WHEN` clause listing the content columns. A popular snippet would otherwise re-enter every reconnect catch-up window and broadcast a realtime UPDATE on each insertion.
7. **Member removal splits by scope.** `owner_member_id` uses `ON DELETE CASCADE` so personal snippets and folders leave with the member; `created_by` / `updated_by` use column-scoped `ON DELETE SET NULL` (PG15+) so shared library history survives with a `Former member` label and an intact `workspace_id`.
8. **Folder soft delete unfiles explicitly.** Soft delete does not fire the folder FK, so `soft_delete_canned_response_folder` clears `folder_id` on the folder's active snippets before tombstoning the folder. Deleting a folder must never delete its contents.
9. **RPC-only writes.** Same shape as ADR-006: `SECURITY DEFINER` implementations in `app_private`, thin `public` wrappers, `EXECUTE` granted to `authenticated` only, and RLS that grants `SELECT` alone.

## Alternatives considered

| Alternative                                              | Why rejected                                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Separate `personal_canned_responses` table               | Duplicates every index, RPC and search path; the composer would have to merge and rank two result sets                             |
| Keep the `category` text column from DATABASE.md §8.1    | No rename integrity, no ordering, no per-scope grouping, and duplicates fork on typos                                              |
| `favorited_by uuid[]` on the snippet row                 | Violates "no JSON/array blobs for structured data"; every pin rewrites a shared row and races with concurrent edits                |
| `ILIKE '%q%'` search only                                | Cannot use an index for leading wildcards and gives no typo tolerance or ranking                                                   |
| Whole-string trigram `%` for fuzzy matching              | Similarity is normalized over both strings, so realistic snippet bodies push every score under the threshold                       |
| One global unique shortcut per workspace                 | A personal snippet could permanently block a shared shortcut (and vice versa); shadowing is the behaviour operators expect         |
| Hard delete for snippets                                 | Loses recovery for a shared library that admins curate; retention policy already prescribes soft delete for canned responses       |
| Reuse `client_*_id` idempotency from notes               | Snippet creation is a deliberate settings action, not a reconnect-prone composer submit; shortcut uniqueness already blocks doubles |
| Version/CAS on update                                    | Concurrent edits of the same snippet are rare and low-stakes; last-write-wins matches internal notes v1                            |

## Consequences

- Viewers may **read** shared snippets (a snippet is reference text) but cannot use, favorite, or record usage of one, because using a snippet implies sending a reply.
- Owners and admins manage the shared library; every member with a non-viewer role manages their own personal snippets and folders. There is no path for one member to read or edit another member's personal scope, at the RPC layer or through RLS.
- Visibility is immutable after create. Promoting a personal snippet to the shared library means creating a shared copy, which keeps shortcut uniqueness and the manage-permission model unambiguous.
- `usage_count` converges rather than streams: a counter bump is visible to the caller immediately and to everyone else on their next full list.
- Reconnect catch-up mirrors internal notes — `catch_up_since` yields bounded tombstones and a database-computed `server_watermark`, never a browser clock. Snippet and folder tombstones are tracked by their own RPCs, so a client keeps two watermarks.
- `pg_trgm` is now a required extension (created in the `extensions` schema, which is already on Supabase's search path).
- `docs/DATABASE.md` §8.1 is updated to the shipped schema; the `category` column described there was never created.

## References

- `docs/CANNED-RESPONSES.md`
- `docs/adr/ADR-006-internal-notes.md`
- `docs/DATABASE.md` §8.1
- `docs/PRD.md` §4.10
- Migration `20260816120000_canned_responses.sql`
