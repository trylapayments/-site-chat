# ADR-005: Conversation Assignment Concurrency & History

**Status:** Accepted  
**Date:** 2026-08-12  
**Deciders:** Engineering  

## Context

Operators need team-ready conversation ownership (Take / Assign / Transfer / Unassign) with:

- Exactly-one-winner semantics when two agents Take the same conversation
- Efficient Mine / Unassigned inbox filters
- Durable history for Customer Timeline / due diligence
- Room to add departments and routing later without a rewrite

## Decision

1. **Current assignee on `conversations`** (`assigned_to`, `assigned_at`, `assigned_by_member_id`, `assignment_version`). One source of truth for inbox queries.
2. **History via Customer Timeline**, not a parallel `assignment_history` table. Event types: `conversation_assigned`, `conversation_transferred`, `conversation_unassigned`.
3. **Concurrency via row lock + version CAS** inside `app_private.apply_conversation_assignment` (`FOR UPDATE` + conditional `UPDATE`). Take never silently steals.
4. **Typed RPC errors** with stable prefixes mapped in `@site-chat/shared` (`AssignmentError`).
5. **Assignment must not bump `last_message_at`** — ordering stays message-activity driven.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Last-write-wins UPDATE | Ambiguous ownership; duplicate timeline noise |
| Client-only optimistic locking | Unsafe under multi-tab / multi-agent races |
| Separate assignment_history table | Duplicates Timeline; two audit sources for buyers to reconcile |
| Soft “claim token” side table | Extra joins for every inbox list; premature for v1 |

## Consequences

- Inbox filters stay index-friendly on `assigned_to`
- Future routing/departments attach beside `assigned_to` rather than replacing it
- Timeline taxonomy expands by two event types (CHECK constraint updated)
- Callers of `assign_conversation` receive the wrapped `{ conversation, changed, assignment }` result

## References

- `docs/CONVERSATION-ASSIGNMENT.md`
- `docs/CUSTOMER-TIMELINE.md`
- `docs/adr/ADR-004-customer-timeline-events.md`
- Migration `20260812160000_conversation_assignment.sql`
