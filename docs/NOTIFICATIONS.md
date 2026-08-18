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
- **Email outbox foundation** (`notification_email_outbox`) with idempotent keys; delivery skips when `RESEND_API_KEY` is unset

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
| `billing_payment_failed` / `trial_ending` | Reserved | Billing later |

Self-take does **not** notify the actor. Mentions never target Viewers.

---

## 3. Delivery channels

| Channel | Mechanism | Notes |
|--------|-----------|-------|
| In-app | `notifications` + Realtime CDC | Preference + DND gated |
| Browser | `Notification` API | Explicit permission; denial recorded; no nag loop |
| Sound | Short Web Audio beep | Requires prior user gesture; leader tab only |
| Email | `notification_email_outbox` | Idempotent; processor marks `sent` / `skipped` / `failed` |

There is **no workspace-level override** of personal preferences.

---

## 4. Dedupe semantics

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

## 5. Unread model

- Trigger-maintained `notification_unread_counts(workspace_id, member_id, unread_count)`
- Badge reads the counter (O(1)), not `COUNT(*)` over history
- Mark-one / mark-all update `read_at` and decrement via triggers (mark-all also zeros the counter)

---

## 6. Privacy rules

Notification `title` / `body` / `payload_json` may include:

- Actor label, conversation id, note id, mention id, assignment version

Never include:

- Internal note body
- Auth / continuity tokens
- Signed URLs / service-role secrets
- Sensitive custom-field values

Viewers never receive `mention` / assignment types. Note deep-links still enforce notes capability at the destination.

---

## 7. Browser permission behavior

1. Default `browser_enabled = false`
2. User enables browser notifications in Settings → explicit `Notification.requestPermission()`
3. If denied, store `browser_permission_denied_at` and do not re-prompt until the user revisits settings and opts in again
4. Only the elected leader tab shows desktop notifications / plays sound

---

## 8. Retention

- Product target: **90 days** for in-app notification rows (PRD)
- v1 documents the purge job; automated cron is not required to ship the center
- Soft strategy: delete (or archive) rows with `created_at < now() - interval '90 days'` per workspace; counters recomputed or clamped
- Email outbox rows older than 30 days may be purged after `sent` / `skipped`

See also [DATA-RETENTION.md](./DATA-RETENTION.md).

---

## 9. API / RPC

| RPC | Purpose |
|-----|---------|
| `list_notifications` | Keyset page (`before_created_at` + `before_id`), unread_count |
| `get_notification_unread_count` | Counter read |
| `mark_notification_read` | Idempotent mark one |
| `mark_all_notifications_read` | Bulk mark |
| `get_notification_preferences` | Get-or-init prefs |
| `update_notification_preferences` | Patch own prefs |

Writes to `notifications` are SECURITY DEFINER only. Authenticated clients have SELECT (recipient) only.

---

## 10. UI

- Bell in `DashboardTopBar` with unread badge
- Dropdown panel: latest ~20, Load more, Mark all as read
- Click → mark read + navigate (`/inbox/{id}` or `?tab=notes&noteId=`)
- Settings → Notifications for per-member preferences

---

## 11. Known v1 limitations

- Email delivery is foundation-only: outbox + optional Resend send; no React Email templates yet
- No mobile push / VAPID
- Quiet hours use member timezone string; invalid TZ falls back to UTC
- Unassigned `visitor_message` fans out to messaging roles (can be noisy at scale — prefer assignment)
- Concurrent preference edits are last-write-wins
- Billing notification types are reserved, not emitted
