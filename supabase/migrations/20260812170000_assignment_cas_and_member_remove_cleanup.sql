-- Assignment CAS for assign/transfer + durable cleanup on member remove.
-- Follow-up to 20260812160000_conversation_assignment.sql review findings.

-- ---------------------------------------------------------------------------
-- assign_conversation: optional p_expected_version (same CAS model as take/unassign)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.assign_conversation(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS app_private.assign_conversation(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION app_private.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_assignee_member_id IS NULL THEN
    v_result := app_private.apply_conversation_assignment(
      p_workspace_id,
      p_conversation_id,
      NULL,
      'unassign',
      p_expected_version
    );
  ELSE
    v_result := app_private.apply_conversation_assignment(
      p_workspace_id,
      p_conversation_id,
      p_assignee_member_id,
      'assign',
      p_expected_version
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.assign_conversation(
    p_workspace_id,
    p_conversation_id,
    p_assignee_member_id,
    p_expected_version
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_conversation(uuid, uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid, uuid, uuid, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- remove_workspace_member: clear assignment metadata before DELETE
-- (Do not rely on FK ON DELETE SET NULL alone — that leaves assigned_at /
-- assigned_by / assignment_version inconsistent and can suppress timeline
-- unassign via version-keyed dedupe.)
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

  v_member := app_private.get_member_for_management(p_member_id);
  v_caller_role := app_private.user_workspace_role(v_member.workspace_id);

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can remove members';
  END IF;

  IF v_member.role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can remove owners';
  END IF;

  -- Match deactivate: return conversations to the unassigned queue with a
  -- version bump so trg_conversations_timeline emits conversation_unassigned.
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
