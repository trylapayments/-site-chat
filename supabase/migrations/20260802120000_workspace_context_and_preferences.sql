-- Phase 2B: workspace context, user preferences, and invitation validation RPCs.
-- Forward-only migration. See docs/PHASE-2B-WORKSPACE-CONTEXT.md

-- ---------------------------------------------------------------------------
-- user_preferences
-- ---------------------------------------------------------------------------

CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_workspace_id uuid NULL REFERENCES public.workspaces (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_preferences_last_workspace_id
  ON public.user_preferences (last_workspace_id)
  WHERE last_workspace_id IS NOT NULL;

CREATE TRIGGER trg_user_preferences_set_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_select_own
  ON public.user_preferences
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.user_preferences FROM PUBLIC;
REVOKE ALL ON TABLE public.user_preferences FROM anon;
GRANT SELECT ON TABLE public.user_preferences TO authenticated;

-- ---------------------------------------------------------------------------
-- Update RLS helpers to canonical Accessible Workspace definition
-- (active member + active workspace + not soft-deleted)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.user_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT wm.workspace_id
  FROM public.workspace_members wm
  INNER JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = auth.uid()
    AND wm.status = 'active'
    AND w.deleted_at IS NULL
    AND w.status = 'active';
$$;

CREATE OR REPLACE FUNCTION app_private.user_workspace_role(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT wm.role
  FROM public.workspace_members wm
  INNER JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = auth.uid()
    AND wm.workspace_id = p_workspace_id
    AND wm.status = 'active'
    AND w.deleted_at IS NULL
    AND w.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_private.workspace_is_accessible(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    INNER JOIN public.workspaces w ON w.id = wm.workspace_id
    WHERE wm.user_id = auth.uid()
      AND wm.workspace_id = p_workspace_id
      AND wm.status = 'active'
      AND w.deleted_at IS NULL
      AND w.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------------
-- Drop and recreate create_workspace (return type uuid -> jsonb)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM authenticated;

DROP FUNCTION IF EXISTS public.create_workspace(text, text);
DROP FUNCTION IF EXISTS app_private.create_workspace(text, text);

CREATE OR REPLACE FUNCTION app_private.create_workspace(p_name text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_workspace_id uuid;
  v_slug text;
  v_name text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  WITH new_workspace AS (
    INSERT INTO public.workspaces (name, slug)
    VALUES (p_name, p_slug)
    RETURNING id, slug, name
  ),
  new_member AS (
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    SELECT nw.id, v_user_id, 'owner', 'active'
    FROM new_workspace nw
    RETURNING workspace_id
  )
  SELECT nw.id, nw.slug, nw.name
  INTO v_workspace_id, v_slug, v_name
  FROM new_workspace nw;

  RETURN jsonb_build_object(
    'workspace_id', v_workspace_id,
    'slug', v_slug,
    'name', v_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN app_private.create_workspace(p_name, p_slug);
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Drop and recreate accept_workspace_invitation (extended return shape)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_workspace_invitation(text) FROM authenticated;

DROP FUNCTION IF EXISTS public.accept_workspace_invitation(text);
DROP FUNCTION IF EXISTS app_private.accept_workspace_invitation(text);

CREATE OR REPLACE FUNCTION app_private.accept_workspace_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_user_email text;
  v_token_hash text;
  v_invitation public.workspace_invitations;
  v_member_id uuid;
  v_existing public.workspace_members;
  v_slug text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'Authenticated user not found';
  END IF;
  v_user_email := lower(trim(v_user_email));

  v_token_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  SELECT *
  INTO v_invitation
  FROM public.workspace_invitations
  WHERE token_hash = v_token_hash
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  IF v_invitation.email_normalized <> v_user_email THEN
    RAISE EXCEPTION 'Invitation email does not match authenticated user';
  END IF;

  SELECT slug
  INTO v_slug
  FROM public.workspaces
  WHERE id = v_invitation.workspace_id;

  SELECT *
  INTO v_existing
  FROM public.workspace_members
  WHERE workspace_id = v_invitation.workspace_id
    AND user_id = v_user_id;

  IF FOUND AND v_existing.status = 'active' THEN
    UPDATE public.workspace_invitations
    SET
      accepted_at = now(),
      updated_at = now()
    WHERE id = v_invitation.id;

    RETURN jsonb_build_object(
      'status', 'already_member',
      'member_id', v_existing.id,
      'workspace_id', v_invitation.workspace_id,
      'slug', v_slug
    );
  END IF;

  IF FOUND AND v_existing.status = 'deactivated' THEN
    UPDATE public.workspace_members
    SET
      role = v_invitation.role,
      status = 'active',
      joined_at = now(),
      updated_at = now()
    WHERE id = v_existing.id
    RETURNING id INTO v_member_id;
  ELSE
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    VALUES (v_invitation.workspace_id, v_user_id, v_invitation.role, 'active')
    RETURNING id INTO v_member_id;
  END IF;

  UPDATE public.workspace_invitations
  SET
    accepted_at = now(),
    updated_at = now()
  WHERE id = v_invitation.id;

  RETURN jsonb_build_object(
    'status', 'accepted',
    'member_id', v_member_id,
    'workspace_id', v_invitation.workspace_id,
    'slug', v_slug
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN app_private.accept_workspace_invitation(p_token);
END;
$$;

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_accessible_workspaces
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_accessible_workspaces()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_total_count bigint;
  v_accessible jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT count(*)
  INTO v_total_count
  FROM public.workspace_members wm
  WHERE wm.user_id = v_user_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'workspace_id', w.id,
        'slug', w.slug,
        'name', w.name,
        'role', wm.role
      )
      ORDER BY wm.joined_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_accessible
  FROM public.workspace_members wm
  INNER JOIN public.workspaces w ON w.id = wm.workspace_id
  WHERE wm.user_id = v_user_id
    AND wm.status = 'active'
    AND w.deleted_at IS NULL
    AND w.status = 'active';

  RETURN jsonb_build_object(
    'total_membership_count', v_total_count,
    'accessible_workspaces', v_accessible
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_accessible_workspaces()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN app_private.list_accessible_workspaces();
END;
$$;

REVOKE ALL ON FUNCTION public.list_accessible_workspaces() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accessible_workspaces() TO authenticated;

-- ---------------------------------------------------------------------------
-- set_last_workspace
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.set_last_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_member public.workspace_members;
  v_workspace public.workspaces;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_member
  FROM public.workspace_members wm
  WHERE wm.user_id = v_user_id
    AND wm.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Workspace membership is not active';
  END IF;

  SELECT *
  INTO v_workspace
  FROM public.workspaces w
  WHERE w.id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this workspace';
  END IF;

  IF v_workspace.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Workspace has been deleted';
  END IF;

  IF v_workspace.status <> 'active' THEN
    RAISE EXCEPTION 'Workspace is not active';
  END IF;

  INSERT INTO public.user_preferences (user_id, last_workspace_id)
  VALUES (v_user_id, p_workspace_id)
  ON CONFLICT (user_id) DO UPDATE
  SET
    last_workspace_id = EXCLUDED.last_workspace_id,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.set_last_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.set_last_workspace(p_workspace_id);
END;
$$;

REVOKE ALL ON FUNCTION public.set_last_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_last_workspace(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- validate_workspace_invitation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.mask_invitation_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_local text;
  v_domain text;
BEGIN
  v_local := split_part(lower(trim(p_email)), '@', 1);
  v_domain := split_part(lower(trim(p_email)), '@', 2);

  IF v_domain = '' OR v_local = '' THEN
    RETURN NULL;
  END IF;

  IF length(v_local) <= 1 THEN
    RETURN v_local || '***@' || v_domain;
  END IF;

  RETURN left(v_local, 1) || '***@' || v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.validate_workspace_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token_hash text;
  v_invitation public.workspace_invitations;
  v_workspace_name text;
BEGIN
  v_token_hash := encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');

  SELECT wi.*
  INTO v_invitation
  FROM public.workspace_invitations wi
  WHERE wi.token_hash = v_token_hash
    AND wi.accepted_at IS NULL
    AND wi.revoked_at IS NULL
    AND wi.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'valid', false,
      'workspace_name', NULL,
      'role', NULL,
      'masked_email', NULL,
      'expires_at', NULL
    );
  END IF;

  SELECT w.name
  INTO v_workspace_name
  FROM public.workspaces w
  WHERE w.id = v_invitation.workspace_id;

  RETURN jsonb_build_object(
    'valid', true,
    'workspace_name', v_workspace_name,
    'role', v_invitation.role,
    'masked_email', app_private.mask_invitation_email(v_invitation.email),
    'expires_at', to_char(v_invitation.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_workspace_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.validate_workspace_invitation(p_token);
END;
$$;

REVOKE ALL ON FUNCTION public.validate_workspace_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_workspace_invitation(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Grants for app_private helpers (unchanged pattern + new functions)
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
