-- Read-only team directory for the operator Team workspace.
-- Surfaces existing workspace_members + pending invitations with emails
-- (auth.users) and cheap assigned-conversation counts. Mutations remain on
-- the existing invitation/member RPCs.

CREATE OR REPLACE FUNCTION app_private.list_workspace_team(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
  v_members jsonb;
  v_invitations jsonb;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);

  SELECT COALESCE(
    jsonb_agg(member_row ORDER BY role_rank, display_label),
    '[]'::jsonb
  )
  INTO v_members
  FROM (
    SELECT
      jsonb_build_object(
        'member_id', wm.id,
        'user_id', wm.user_id,
        'email', COALESCE(u.email, ''),
        'display_label', COALESCE(u.email, 'Unknown member'),
        'role', wm.role,
        'status', wm.status,
        'joined_at', wm.joined_at,
        'assigned_conversation_count', COALESCE(ac.assigned_count, 0)
      ) AS member_row,
      CASE wm.role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'agent' THEN 2
        ELSE 3
      END AS role_rank,
      COALESCE(u.email, 'Unknown member') AS display_label
    FROM public.workspace_members wm
    LEFT JOIN auth.users u ON u.id = wm.user_id
    LEFT JOIN (
      SELECT
        c.assigned_to,
        count(*)::integer AS assigned_count
      FROM public.conversations c
      WHERE c.workspace_id = p_workspace_id
        AND c.assigned_to IS NOT NULL
      GROUP BY c.assigned_to
    ) ac ON ac.assigned_to = wm.id
    WHERE wm.workspace_id = p_workspace_id
  ) listed;

  IF v_role IN ('owner', 'admin') THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'invitation_id', wi.id,
          'email', wi.email,
          'role', wi.role,
          'created_at', wi.created_at,
          'expires_at', wi.expires_at
        )
        ORDER BY wi.created_at DESC, wi.email
      ),
      '[]'::jsonb
    )
    INTO v_invitations
    FROM public.workspace_invitations wi
    WHERE wi.workspace_id = p_workspace_id
      AND wi.accepted_at IS NULL
      AND wi.revoked_at IS NULL
      AND wi.expires_at > now();
  ELSE
    v_invitations := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'members', v_members,
    'invitations', v_invitations
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_workspace_team(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_workspace_team(p_workspace_id);
END;
$$;

REVOKE ALL ON FUNCTION public.list_workspace_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_workspace_team(uuid) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
