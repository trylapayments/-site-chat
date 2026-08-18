# Operator Notifications

**Status:** Implemented (v1)  
**Last updated:** 2026-08-18

Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [DATABASE.md](./DATABASE.md), [SECURITY.md](./SECURITY.md), [INTERNAL-NOTES.md](./INTERNAL-NOTES.md), [CONVERSATION-ASSIGNMENT.md](./CONVERSATION-ASSIGNMENT.md)

---

## 1. Purpose

Operators need durable, multi-device alerts for work that requires attention — new conversations, visitor replies, assignments, and @mentions — without polling and without leaking internal-note content to unauthorized roles.

v1 delivers:

- Durable `notifications` rows with **dedupe keys** (at most one row per logical event per recipient)
- O(1) **unread badge** via `notification_unread_counts`
- In-app **notification center** (bell + panel) with keyset pagination
- Realtime INSERT/UPDATE (no polling) + reconnect catch-up
- Optional **browser Notification API** and **sound** (muted by default; tab-elected side effects)
- Per-member **preferences** (in-app / browser / sound / email / DND)
- **Email outbox** with claim-before-send state machine; delivery skips when `RESEND_API_KEY` is unset

---

## 2. Notification taxonomy

| Type | When | Typical recipients |
|------|------|--------------------|
| `conversation_new` | First visitor message on a new conversation | Active owner/admin/agent + viewer |
| `visitor_message` | Subsequent visitor message | Assignee if assigned; else messaging roles |
| `conversation_assigned` | Assigned / taken onto a member by someone else | New assignee (not self-take) |
| `conversation_transferred` | Transfer to another member | New assignee + previous assignee |
| `conversation_unassigned` | Unassigned by someone else | Previous assignee |
| `mention` | New `internal_note_mentions` row | Mentioned member (messaging roles only) |
| `billing_payment_failed` / `trial_ending` | Reserved | Billing later — not emittable from generic client paths |

Self-take does **not** notify the actor. Mentions never target Viewers.

Emit path invariants (all types):

- Recipient `workspace_members` row is active in the same workspace
- Source entity (conversation / message / note) belongs to the same workspace
- Stable `dedupe_key` → retries collapse; no duplicate fan-out
- Viewer capability respected (`viewer_may_receive_notification`)

---

## 3. Delivery channels

| Channel | Mechanism | Notes |
|--------|-----------|-------|
| In-app | `notifications` + Realtime CDC | Gated by `in_app_*` preference only — **not** by DND |
| Browser | `Notification` API | Explicit permission; denial recorded; leader tab; suppressed during quiet hours |
| Sound | Short Web Audio beep | Requires prior user gesture; leader tab; suppressed during quiet hours |
| Email | `notification_email_outbox` | Claim-before-send; suppressed during quiet hours |

There is **no workspace-level override** of personal preferences.

---

## 4. DND / quiet hours

Canonical evaluator: `app_private.notification_in_quiet_hours` (SQL) and `isQuietHoursActive` in `@site-chat/shared` (TypeScript). Keep them in parity.

| Inputs | Result |
|--------|--------|
| `dnd_enabled = false` | Not quiet |
| `dnd_enabled = true` + null/missing window | **Always quiet** (side effects off all day) |
| `dnd_enabled = true` + equal start/end | **Always quiet** |
| `dnd_enabled = true` + daytime window | Quiet only for local time in `[start, end)` |
| Overnight (`start > end`, e.g. 22:00→07:00) | Quiet if local ≥ start **or** local < end |
| Timezone | Member `timezone` string; invalid → UTC |

**Product rule:** DND / quiet hours suppress **side effects only** (browser, sound, email). Durable in-app history and unread counters still update when the matching `in_app_*` preference is enabled. If `in_app_*` for that category is disabled, the durable row may be omitted.

---

## 5. Dedupe semantics

Unique constraint: `(workspace_id, recipient_id, dedupe_key)`.

| Event | Dedupe key |
|-------|------------|
| Mention | `mention:{mention_row_id}` (re-add after remove → new row → new key) |
| New conversation | `conversation_new:{conversation_id}:member:{member_id}` |
| Visitor message (assigned) | `visitor_message:{message_id}` |
| Visitor message (unassigned fan-out) | `visitor_message:{message_id}:member:{member_id}` |
| Assignment | `conversation_assigned:{conversation_id}:v{assignment_version}` |
| Transfer-from | `conversation_transferred_from:{conversation_id}:v{assignment_version}` |
| Unassign | `conversation_unassigned:{conversation_id}:v{assignment_version}` |
| Email outbox | `email:{notification_dedupe_key}` |

Retries, reconnect catch-up, and CDC replay do not create duplicates.

---

## 6. Unread model

Invariant (always):

```
notification_unread_counts.unread_count
  = COUNT(*) FROM notifications
    WHERE recipient_id = member
      AND read_at IS NULL
```

- Trigger-maintained counter for O(1) badge reads
- `mark_notification_read` is idempotent (repeat mark does not go negative)
- `mark_all_notifications_read` locks the counter row (`FOR UPDATE`), marks unread rows, then sets `unread_count` to the authoritative remaining `COUNT(*)` in the same transaction so a concurrent insert cannot leave unread rows with a zeroed counter
- Member delete cascades notifications + counter rows

---

## 7. Privacy rules

Notification `title` / `body` / `payload_json` may include:

- Actor label, conversation id, note id, mention id, assignment version

Never include:

- Internal note body / snippet
- Auth / continuity tokens
- Signed URLs / service-role secrets
- Sensitive custom-field values

Viewers never receive `mention` / assignment types. Note deep-links still enforce notes capability at the destination. Browser and email copy reuse the same safe title/body fields.

---

## 8. Browser permission + leader election

1. Default `browser_enabled = false`
2. User enables browser notifications in Settings → explicit `Notification.requestPermission()`
3. If denied, store `browser_permission_denied_at` and do not re-prompt until the user revisits settings and opts in again
4. Only the elected leader tab shows desktop notifications / plays sound

### Leader election

Storage key `sitechat:notif-leader:{workspaceId}` holds `{ tabId, at }`.

1. Read lease
2. If free/stale → write own `{tabId, at}`
3. Read back — **leader only if stored `tabId` matches**
4. Heartbeat renews only while ownership still verified
5. Ownership lost → `leader=false` immediately
6. Stale after 5s → another tab may claim

Reconnect / catch-up refreshes the list and badge but **does not** replay browser/sound for historical rows (session watermark + per-id side-effect set).

---

## 9. Email outbox state machine

| Status | Meaning |
|--------|---------|
| `pending` | Claimable |
| `sending` | Atomically claimed by a worker (`FOR UPDATE SKIP LOCKED`) |
| `sent` | Provider accepted; `provider_message_id` stored when available |
| `failed` | Retryable; `next_attempt_at` + `attempts` / `last_error` |
| `skipped` | Intentionally not sent (e.g. missing `RESEND_API_KEY`) — **not** marked sent |

Flow:

1. `claim_notification_email_outbox` → `pending|failed` → `sending` (increments `attempts`, sets `claimed_at`)
2. Provider call **only after** claim
3. `finalize_notification_email_outbox` → `sent` / `skipped` / `failed`

Stale recovery: rows stuck in `sending` longer than 15 minutes return to `pending` (documented residual risk: provider accepted but DB finalize never ran → possible duplicate email unless the provider supports idempotency keys).

---

## 10. Retention

- Product target: **90 days** for in-app notification rows (PRD)
- v1 documents the purge job; automated cron is not required to ship the center
- Soft strategy: delete (or archive) **read / old** rows with `created_at < now() - interval '90 days'`; after purge, counters must be recomputed or clamped so unread deletes cannot silently desync the counter
- Prefer purging **read** rows first; unread purge must adjust `notification_unread_counts`
- Email outbox rows older than 30 days may be purged after terminal `sent` / `skipped` / exhausted `failed`

See also [DATA-RETENTION.md](./DATA-RETENTION.md).

---

## 11. API / RPC

| RPC | Purpose | Who |
|-----|---------|-----|
| `list_notifications` | Keyset page, unread_count | authenticated |
| `get_notification_unread_count` | Counter read | authenticated |
| `mark_notification_read` | Idempotent mark one | authenticated |
| `mark_all_notifications_read` | Bulk mark + reconcile | authenticated |
| `get_notification_preferences` | Get-or-init prefs | authenticated |
| `update_notification_preferences` | Patch own prefs | authenticated |
| `claim_notification_email_outbox` | Atomic claim | **service_role only** |
| `finalize_notification_email_outbox` | Finalize claim | **service_role only** |

`app_private` helpers (`emit_notification`, fan-out, preference helpers, claim internals, etc.) are **not** executable by `authenticated` / `anon` / `PUBLIC`. After notification migrations, `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private` runs, then only intentional RLS helpers are re-granted (`user_workspace_ids`, `user_workspace_role`, `workspace_is_accessible`, `get_caller_member_id`).

SECURITY DEFINER functions use `SET search_path = ''`.

---

## 12. UI

- Bell in `DashboardTopBar` with unread badge
- Dropdown panel: latest ~20, Load more, Mark all as read
- Click → mark read + navigate (`/inbox/{id}` or `?tab=notes&noteId=`)
- Settings → Notifications for per-member preferences

---

## 13. Known v1 limitations

- Email delivery is foundation-only: outbox + optional Resend send; no React Email templates yet
- No mobile push / VAPID
- Quiet hours use member timezone string; invalid TZ falls back to UTC
- Unassigned `visitor_message` fans out to messaging roles (can be noisy at scale — prefer assignment)
- Concurrent preference edits are last-write-wins
- Billing notification types are reserved, not emitted
- Crash after provider accept but before DB `sent` may duplicate email without provider idempotency
