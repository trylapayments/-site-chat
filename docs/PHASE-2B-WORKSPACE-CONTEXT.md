# Phase 2B — Workspace Context and Invitations

**Status:** Approved  
**Branch:** `cursor/phase-2b-workspace-context-365f`  
**Depends on:** Phase 2A (Core Authentication), workspace foundation migration

---

## Goal

Deliver authenticated workspace routing after login: onboarding for new users, workspace selection for multi-workspace users, invitation acceptance, and slug-scoped dashboard entry — all with server-side authorization, a single canonical Accessible Workspace definition, and no service-role use on public product routes.

---

## Canonical Accessible Workspace Definition

A workspace is **accessible** if and only if **all** of the following hold:

1. A `workspace_members` row exists for `(user_id = auth.uid(), workspace_id)`
2. `workspace_members.status = 'active'`
3. `workspaces.status = 'active'`
4. `workspaces.deleted_at IS NULL`

This definition is used everywhere: redirect resolver, `list_accessible_workspaces()`, `set_last_workspace()`, `app_private.workspace_is_accessible()`, RLS helpers, and layout guards.

---

## RPC Contracts

### `list_accessible_workspaces()`

Returns one stable JSON object (always, including when the accessible array is empty):

```json
{
  "total_membership_count": 0,
  "accessible_workspaces": [
    {
      "workspace_id": "uuid",
      "slug": "text",
      "name": "text",
      "role": "owner|admin|agent|viewer"
    }
  ]
}
```

- Single resolver query; distinguishes State A (zero memberships) from State D (memberships exist but none accessible)
- Ordered by `joined_at ASC`
- Granted to `authenticated`

### `set_last_workspace(p_workspace_id uuid)`

- SECURITY DEFINER; only write path for `user_preferences.last_workspace_id`
- Validates full Accessible Workspace definition before upsert

| Condition | Error message |
|-----------|---------------|
| Not a member | `Not a member of this workspace` |
| Deactivated member | `Workspace membership is not active` |
| Suspended workspace | `Workspace is not active` |
| Soft-deleted workspace | `Workspace has been deleted` |

### `validate_workspace_invitation(p_token text)`

Fixed-shape JSON; granted to `anon` and `authenticated`:

```json
{
  "valid": true,
  "workspace_name": "Acme",
  "role": "agent",
  "masked_email": "a***@example.com",
  "expires_at": "2026-08-09T12:00:00.000Z"
}
```

When `valid = false`, all other fields are `null`.

### `create_workspace(p_name, p_slug)`

Creates workspace, owner membership, and upserts `user_preferences.last_workspace_id`
in one transaction. Returns:

```json
{
  "workspace_id": "uuid",
  "slug": "text",
  "name": "text"
}
```

No separate `set_last_workspace` call is required after onboarding creation.

### `accept_workspace_invitation(p_token)`

Returns:

```json
{
  "status": "accepted|already_member",
  "member_id": "uuid",
  "workspace_id": "uuid",
  "slug": "text"
}
```

No follow-up workspace SELECT after acceptance.

---

## Membership State Classification

| State | Condition | Destination |
|-------|-----------|-------------|
| **A — Onboarding** | `total_membership_count = 0` | `/app/onboarding` |
| **B — Single** | `accessible_workspaces.length = 1` | `/app/[slug]` |
| **C — Multi** | `accessible_workspaces.length ≥ 2` | last workspace if accessible, else `/app/select-workspace` |
| **D — Unavailable** | `accessible_workspaces.length = 0` and `total_membership_count ≥ 1` | `/app/unavailable` |

Invitation (State E) is handled in redirect priority step 2, not classification.

---

## Post-Auth Redirect Priority

1. **Recovery** — PR 2A `sc_recovery` behavior → `/reset-password`
2. **Invitation** — valid `sc_invite`: accept if authenticated; preserve cookie if not
3. **Safe next** — sanitized path with workspace authorization
4. **Workspace resolver** — classify membership (A–D) from `list_accessible_workspaces()`
5. **Fallback** — `/app` (resolver re-evaluates)

### Safe next authorization

- Allow: `/app/onboarding`, `/app/unavailable`, `/app/select-workspace`
- Allow `/app/[slug]/*` only when slug exists in `accessible_workspaces`
- Reject foreign or unknown workspace slugs

---

## Routes

| Route | Purpose |
|-------|---------|
| `/app` | Post-auth redirect resolver |
| `/app/onboarding` | Create first workspace |
| `/app/unavailable` | No accessible workspaces |
| `/app/select-workspace` | Multi-workspace picker |
| `/app/[workspaceSlug]` | Workspace-scoped shell |
| `/invite/[token]` | Invitation landing (token captured via Route Handler) |

---

## Onboarding

- Name field (1–100 chars)
- Slug auto-generated from name; user-editable
- Flow: `create_workspace` → `set_last_workspace` → redirect `/app/[slug]`

---

## Invitation Flow

1. `GET /invite/[token]` → Route Handler validates token, sets `sc_invite`, redirects to token-free URL
2. Landing page shows invite details (no cookie mutation in Server Components)
3. Authenticated users accept via `accept_workspace_invitation`
4. Email mismatch: actionable error with masked email
5. `already_member`: treat as success
6. No service-role on invitation routes

---

## `sc_invite` Cookie

| Property | Value |
|----------|-------|
| HttpOnly | Yes |
| Secure | Production only |
| SameSite | Lax |
| Max-Age | 3600 |
| Secret | `AUTH_COOKIE_SECRET` |

Minimal payload: `purpose`, `issued_at`, `expires_at`, `invitation_token`

- Signed bearer token; HMAC provides integrity, not confidentiality
- Never log, never expose to client components, never keep token in URL after capture
- Clear on success, terminal failure, expiration, and sign-out

---

## Database Migration Notes

- PostgreSQL cannot change function return types with `CREATE OR REPLACE`
- For `create_workspace` and `accept_workspace_invitation`: revoke grants, drop public wrapper and private implementation, recreate with new contracts, restore explicit grants
- All SECURITY DEFINER functions: `SET search_path = ''` with fully qualified references
- `user_preferences`: SELECT-only RLS for authenticated; writes via `set_last_workspace()` only

---

## Out of Scope

Billing, conversations, messages, widget, team-management UI, Resend email sending, workspace switcher header widget.

---

## Acceptance Criteria

- Migration applies via `supabase db reset`
- pgTAP and Vitest coverage for RPCs, resolver, slug generation, onboarding, invitation, open redirects
- Phase 2A auth tests unchanged
- Single `list_accessible_workspaces()` call per resolver execution
- No service-role on public product routes
