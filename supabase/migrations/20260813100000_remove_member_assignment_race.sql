-- Close the remove_workspace_member vs assign_conversation race.
-- Under READ COMMITTED, deactivating in an open transaction is invisible to
-- peers unless they take a conflicting row lock. assert_assignable_member
-- therefore locks the assignee FOR SHARE; remove locks FOR UPDATE, marks the
-- member non-assignable, clears assignments, then DELETEs.

-- ---------------------------------------------------------------------------
-- assert_assignable_member: lock assignee so concurrent remove blocks us
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.assert_assignable_member(
  p_workspace_id uuid,
  p_assignee_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.app_member_status;
  v_role public.app_member_role;
BEGIN
  -- FOR SHARE conflicts with remove_workspace_member's FOR UPDATE so a
  -- concurrent assign waits, then observes deactivated/missing and fails.
  SELECT wm.status, wm.role
  INTO v_status, v_role
  FROM public.workspace_members wm
  WHERE wm.id = p_assignee_member_id
    AND wm.workspace_id = p_workspace_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: Assignee is not a member of this workspace';
  END IF;

  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'MEMBER_NOT_ASSIGNABLE: Assignee is not an active workspace member';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'MEMBER_NOT_ASSIGNABLE: Assignees must have a messaging role';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- remove_workspace_member: lock → non-assignable → clear → DELETE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.remove_workspace_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.workspace_members;
  v_caller_role public.app_member_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Serialize with concurrent assign (assert_assignable_member FOR SHARE).
  SELECT *
  INTO v_member
  FROM public.workspace_members wm
  WHERE wm.id = p_member_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  v_caller_role := app_private.user_workspace_role(v_member.workspace_id);

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can remove members';
  END IF;

  IF v_member.role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can remove owners';
  END IF;

  -- Mark non-assignable before clearing or deleting so concurrent
  -- assert_assignable_member fails once it obtains the row lock.
  UPDATE public.workspace_members
  SET
    status = 'deactivated',
    updated_at = now()
  WHERE id = p_member_id;

  -- Same durable cleanup as deactivate — do not rely on FK ON DELETE SET NULL.
  UPDATE public.conversations c
  SET
    assigned_to = NULL,
    assigned_at = NULL,
    assigned_by_member_id = NULL,
    assignment_version = c.assignment_version + 1,
    updated_at = now()
  WHERE c.workspace_id = v_member.workspace_id
    AND c.assigned_to = p_member_id;

  DELETE FROM public.workspace_members
  WHERE id = p_member_id;
END;
$$;

-- Keep app_private locked down after CREATE OR REPLACE.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
