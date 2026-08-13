# Conversation Assignment & Queues

**Status:** Implemented (v1)  
**Last updated:** 2026-08-12

---

## 1. Purpose

Team-ready conversation ownership for the operator inbox:

- Take / Assign / Transfer / Unassign
- Mine / Unassigned / All filters
- Realtime assignee updates
- Assignment history on the Customer Timeline

v1 does **not** include departments, skills-based routing, SLAs, round-robin, or AI routing. Schema and RPCs leave extension points for those later.

---

## 2. Assignment model

**Single source of truth:** current assignee lives on `conversations`:

| Column | Meaning |
|--------|---------|
| `assigned_to` | Current `workspace_members.id`, or `NULL` (unassigned queue) |
| `assigned_at` | When the current assignee was set |
| `assigned_by_member_id` | Member who performed the current assignment |
| `assignment_version` | Monotonic revision bumped on every successful change |

There is **no** separate `assignment_history` table. Immutable history is emitted into `customer_timeline_events` (see `docs/CUSTOMER-TIMELINE.md`).

Inbox ordering remains driven by `last_message_at` / message activity. Assignment mutations **do not** bump `last_message_at`.

---

## 3. Semantics

| Operation | Behavior |
|-----------|----------|
| **Take** | If unassigned → assign to caller. If already caller → no-op. If someone else → `ASSIGNMENT_CONFLICT` (no silent steal). |
| **Assign** | Authorized member sets assignee to another active messaging-role member in the same workspace. |
| **Transfer** | Same durable assign path when previous assignee was non-null; timeline emits `conversation_transferred` with from → to. |
| **Unassign** | Clears assignee (`NULL`). Already unassigned → no-op. |

No-ops do **not** emit timeline events and do **not** increment `assignment_version`.

---

## 4. Concurrency

`app_private.apply_conversation_assignment`:

1. `SELECT … FOR UPDATE` on the conversation row (serialized)
2. Compare-and-set `UPDATE … WHERE assignment_version = <locked version>` (and `assigned_to IS NULL` for Take)
3. On CAS miss → `ASSIGNMENT_CONFLICT`

Exactly one concurrent Take wins. Loser receives a typed conflict; UI refreshes to the authoritative assignee.

Optional `p_expected_version` enables client CAS for multi-tab / stale UI protection on **Take, Assign/Transfer, and Unassign**.

---

## 5. Permissions

| Gate | Rule |
|------|------|
| Auth | Authenticated operator JWT |
| Membership | Caller must belong to the workspace |
| Capability | `assign_conversations` → owner / admin / agent |
| Assignee | Active member in same workspace with role owner/admin/agent |
| Viewer | Cannot Take/Assign/Unassign (RPC + Server Action + UI) |
| Visitors | No EXECUTE on assignment RPCs; widget never calls them |
| Cross-tenant | Conversation must match `workspace_id`; foreign members rejected |

RLS on `conversations` remains SELECT-only for members; mutations go through `SECURITY DEFINER` RPCs with `search_path = ''`.

Deactivating or removing a member clears their assignments back to the unassigned queue (PRD): assignee, `assigned_at`, and `assigned_by` are cleared, `assignment_version` is incremented, and exactly one `conversation_unassigned` timeline event is emitted per conversation. Removal does **not** rely on FK `ON DELETE SET NULL` alone.

`remove_workspace_member` is concurrency-safe: it `SELECT … FOR UPDATE`s the member row, marks `status = deactivated` (so `assert_assignable_member` fails), clears assignments, then `DELETE`s. Assign locks the assignee `FOR SHARE`, so a concurrent assign either blocks then fails or fails immediately — it never succeeds against a member mid-removal.

---

## 6. Queue model (v1)

| Filter | SQL meaning |
|--------|-------------|
| Mine (`assigned_to_me`) | `assigned_to = caller member_id` |
| Unassigned | `assigned_to IS NULL` |
| All | no assignment predicate |

Indexes:

- `idx_conversations_unassigned_queue` — unassigned inbox
- `idx_conversations_assignee_activity` / `idx_conversations_assigned` — mine / assignee lookups

Future departments / skills / routing rules should add **adjacent** tables (e.g. `queues`, `routing_rules`) rather than overloading `assigned_to`.

---

## 7. API / RPC

| RPC | Purpose |
|-----|---------|
| `take_conversation(workspace_id, conversation_id, expected_version?)` | Claim unassigned |
| `assign_conversation(workspace_id, conversation_id, assignee_member_id, expected_version?)` | Assign / transfer (`NULL` assignee → unassign for backward compat) |
| `unassign_conversation(workspace_id, conversation_id, expected_version?)` | Clear assignee |
| `list_assignable_members(workspace_id)` | Active messaging-role members |

Return shape (`assignmentMutationResultSchema`):

```json
{
  "conversation": { /* conversation detail incl. assigned_to, assignment_version */ },
  "changed": true,
  "assignment": {
    "assignee_member_id": "…",
    "assigned_at": "…",
    "assigned_by_member_id": "…",
    "assignment_version": 2
  }
}
```

Typed errors (message prefix → shared `AssignmentError`):

- `ASSIGNMENT_CONFLICT`
- `MEMBER_NOT_FOUND`
- `MEMBER_NOT_ASSIGNABLE`
- `FORBIDDEN`
- `CONVERSATION_NOT_FOUND`

---

## 8. Realtime

- Operator inbox CDC on `conversations` UPDATE (includes `assigned_to`)
- Filter helpers drop rows that no longer match Mine / Unassigned
- Assignee display labels are enriched via debounced `list_conversations` refresh when the UUID changes
- Open thread `AssignmentPanel` refreshes on conversation CDC
- Reconnect triggers list refresh (no polling; durable DB is source of truth)

---

## 9. Timeline integration

| Event | When |
|-------|------|
| `conversation_assigned` | `NULL → member` |
| `conversation_transferred` | `member → other member` |
| `conversation_unassigned` | `member → NULL` |

Metadata includes safe display labels (`from_member_label` / `to_member_label`), never emails or auth secrets. Dedupe key: `conversation:{id}:assignment:{version}`.

---

## 10. Optimistic UI

- **Take / Assign / Transfer:** may show optimistic assignee; conflict rolls back and refreshes to authoritative state.
- **Unassign:** wait for server result to avoid flicker; failures refresh to server state.

---

## 11. Known v1 limitations

- No departments, skills, SLAs, round-robin, or AI routing
- No assignment notes / transfer comments
- No “assigned to you” email/push notifications (roadmap)
- No optional counts on Mine/Unassigned tabs (cheap counts can be added later)
- Dashboard locale packs still backlog; strings live in `assignmentMessagesEn` / timeline catalogs

---

## 12. Extension path

1. Keep `conversations.assigned_to` as **current owner**
2. Add `queues` / `department_id` as optional routing metadata (nullable FKs)
3. Add automation workers that call the same `apply_conversation_assignment` core (never bypass CAS)
4. Emit richer timeline metadata without changing the three event types
