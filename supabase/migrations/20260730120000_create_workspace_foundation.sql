-- Site Chat: workspace foundation (workspaces, members, invitations)
-- Forward-only migration. See docs/adr/ADR-001-multi-tenancy.md

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

CREATE SCHEMA app_private;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.app_workspace_status AS ENUM ('active', 'suspended', 'pending_deletion');
CREATE TYPE public.app_member_role AS ENUM ('owner', 'admin', 'agent', 'viewer');
CREATE TYPE public.app_member_status AS ENUM ('active', 'deactivated');

-- ---------------------------------------------------------------------------
-- Utility trigger function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  status public.app_workspace_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_workspaces_name_length CHECK (length(trim(name)) BETWEEN 1 AND 100),
  CONSTRAINT chk_workspaces_slug_format CHECK (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    AND length(slug) BETWEEN 3 AND 63
  ),
  CONSTRAINT chk_workspaces_deleted_consistency CHECK (
    (status = 'pending_deletion') = (deleted_at IS NOT NULL)
  ),
  CONSTRAINT uq_workspaces_slug UNIQUE (slug)
);

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  role public.app_member_role NOT NULL DEFAULT 'agent',
  status public.app_member_status NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_members_workspace_user UNIQUE (workspace_id, user_id)
);

CREATE TABLE public.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(trim(email))) STORED,
  role public.app_member_role NOT NULL DEFAULT 'agent',
  token_hash text NOT NULL,
  invited_by_user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_workspace_invitations_role CHECK (role IN ('admin', 'agent', 'viewer')),
  CONSTRAINT chk_workspace_invitations_email CHECK (length(trim(email)) > 0),
  CONSTRAINT chk_workspace_invitations_resolution_exclusive CHECK (
    NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_workspace_invitations_unresolved_email
  ON public.workspace_invitations (workspace_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_workspaces_set_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TRIGGER trg_workspace_members_set_updated_at
  BEFORE UPDATE ON public.workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TRIGGER trg_workspace_invitations_set_updated_at
  BEFORE UPDATE ON public.workspace_invitations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX idx_workspace_members_user_id ON public.workspace_members (user_id);
CREATE INDEX idx_workspace_members_workspace_id ON public.workspace_members (workspace_id);
CREATE INDEX idx_workspace_members_workspace_role_active
  ON public.workspace_members (workspace_id, role)
  WHERE status = 'active';
CREATE INDEX idx_workspace_members_user_active
  ON public.workspace_members (user_id)
  WHERE status = 'active';
CREATE INDEX idx_workspace_invitations_token_hash
  ON public.workspace_invitations (token_hash)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_workspace_invitations_workspace_email
  ON public.workspace_invitations (workspace_id, email_normalized)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_workspaces_pending_deletion
  ON public.workspaces (deleted_at)
  WHERE status = 'pending_deletion';

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER)
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
    AND w.status <> 'pending_deletion';
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
    AND w.status <> 'pending_deletion'
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
      AND w.status <> 'pending_deletion'
  );
$$;

-- ---------------------------------------------------------------------------
-- app_private mutation implementations (SECURITY DEFINER)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.create_workspace(p_name text, p_slug text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_workspace_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.workspaces (name, slug)
  VALUES (p_name, p_slug)
  RETURNING id INTO v_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_user_id, 'owner', 'active');

  RETURN v_workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_role := app_private.user_workspace_role(p_workspace_id);
  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Only owners can soft delete a workspace';
  END IF;

  UPDATE public.workspaces
  SET
    status = 'pending_deletion',
    deleted_at = now(),
    updated_at = now()
  WHERE id = p_workspace_id
    AND deleted_at IS NULL
    AND status <> 'pending_deletion';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found or already deleted';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.app_member_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
  v_token text;
  v_token_hash text;
  v_invitation_id uuid;
  v_email_normalized text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_role := app_private.user_workspace_role(p_workspace_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can create invitations';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot invite with owner role';
  END IF;

  IF p_role NOT IN ('admin', 'agent', 'viewer') THEN
    RAISE EXCEPTION 'Invalid invitation role';
  END IF;

  v_email_normalized := lower(trim(p_email));

  UPDATE public.workspace_invitations
  SET
    revoked_at = now(),
    updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND email_normalized = v_email_normalized
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at <= now();

  IF EXISTS (
    SELECT 1
    FROM public.workspace_invitations
    WHERE workspace_id = p_workspace_id
      AND email_normalized = v_email_normalized
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'An active invitation already exists for this email';
  END IF;

  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  v_token := replace(replace(replace(v_token, '+', '-'), '/', '_'), '=', '');
  v_token_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.workspace_invitations (
    workspace_id,
    email,
    role,
    token_hash,
    invited_by_user_id,
    expires_at
  )
  VALUES (
    p_workspace_id,
    p_email,
    p_role,
    v_token_hash,
    auth.uid(),
    now() + interval '7 days'
  )
  RETURNING id INTO v_invitation_id;

  RETURN jsonb_build_object('invitation_id', v_invitation_id, 'token', v_token);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.revoke_workspace_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_role public.app_member_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT workspace_id
  INTO v_workspace_id
  FROM public.workspace_invitations
  WHERE id = p_invitation_id
    AND accepted_at IS NULL
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or already resolved';
  END IF;

  v_role := app_private.user_workspace_role(v_workspace_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can revoke invitations';
  END IF;

  UPDATE public.workspace_invitations
  SET
    revoked_at = now(),
    updated_at = now()
  WHERE id = p_invitation_id;
END;
$$;

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

    RETURN jsonb_build_object('status', 'already_member', 'member_id', v_existing.id);
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

  RETURN jsonb_build_object('status', 'accepted', 'member_id', v_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_member_for_management(p_member_id uuid)
RETURNS public.workspace_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.workspace_members;
  v_caller_role public.app_member_role;
BEGIN
  SELECT *
  INTO v_member
  FROM public.workspace_members
  WHERE id = p_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;

  v_caller_role := app_private.user_workspace_role(v_member.workspace_id);
  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_workspace_member_role(
  p_member_id uuid,
  p_new_role public.app_member_role
)
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
    RAISE EXCEPTION 'Only owners and admins can change member roles';
  END IF;

  IF v_member.role = 'owner' OR p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use owner promotion or demotion functions to change owner role';
  END IF;

  IF v_caller_role = 'admin' AND v_member.role = 'owner' THEN
    RAISE EXCEPTION 'Admins cannot modify owners';
  END IF;

  IF p_new_role NOT IN ('admin', 'agent', 'viewer') THEN
    RAISE EXCEPTION 'Invalid target role';
  END IF;

  UPDATE public.workspace_members
  SET
    role = p_new_role,
    updated_at = now()
  WHERE id = p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.deactivate_workspace_member(p_member_id uuid)
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
    RAISE EXCEPTION 'Only owners and admins can deactivate members';
  END IF;

  IF v_member.role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can deactivate owners';
  END IF;

  UPDATE public.workspace_members
  SET
    status = 'deactivated',
    updated_at = now()
  WHERE id = p_member_id;
END;
$$;

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

  DELETE FROM public.workspace_members
  WHERE id = p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.promote_workspace_member_to_owner(p_member_id uuid)
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

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can promote members to owner';
  END IF;

  IF v_member.status <> 'active' THEN
    RAISE EXCEPTION 'Only active members can be promoted to owner';
  END IF;

  UPDATE public.workspace_members
  SET
    role = 'owner',
    updated_at = now()
  WHERE id = p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.demote_workspace_owner(
  p_member_id uuid,
  p_new_role public.app_member_role
)
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

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can demote owners';
  END IF;

  IF v_member.role <> 'owner' THEN
    RAISE EXCEPTION 'Target member is not an owner';
  END IF;

  IF p_new_role NOT IN ('admin', 'agent', 'viewer') THEN
    RAISE EXCEPTION 'Invalid target role for demotion';
  END IF;

  UPDATE public.workspace_members
  SET
    role = p_new_role,
    updated_at = now()
  WHERE id = p_member_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Ownership invariant triggers (deferrable)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.enforce_workspace_has_active_owner()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v_owner_count integer;
  v_exempt boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_workspace_id := OLD.id;
  ELSE
    v_workspace_id := NEW.id;
  END IF;

  SELECT
    w.deleted_at IS NOT NULL OR w.status = 'pending_deletion'
  INTO v_exempt
  FROM public.workspaces w
  WHERE w.id = v_workspace_id;

  IF v_exempt THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO v_owner_count
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace_id
    AND wm.role = 'owner'
    AND wm.status = 'active';

  IF v_owner_count < 1 THEN
    RAISE EXCEPTION 'Workspace must have at least one active owner';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.enforce_workspace_owner_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_workspace_ids uuid[];
  v_workspace_id uuid;
  v_owner_count integer;
  v_exempt boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_workspace_ids := ARRAY[OLD.workspace_id];
  ELSIF TG_OP = 'INSERT' THEN
    v_workspace_ids := ARRAY[NEW.workspace_id];
  ELSE
    IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
      v_workspace_ids := ARRAY[OLD.workspace_id, NEW.workspace_id];
    ELSE
      v_workspace_ids := ARRAY[NEW.workspace_id];
    END IF;
  END IF;

  FOREACH v_workspace_id IN ARRAY v_workspace_ids
  LOOP
    SELECT
      w.deleted_at IS NOT NULL OR w.status = 'pending_deletion'
    INTO v_exempt
    FROM public.workspaces w
    WHERE w.id = v_workspace_id;

    IF v_exempt THEN
      CONTINUE;
    END IF;

    SELECT count(*)
    INTO v_owner_count
    FROM public.workspace_members wm
    WHERE wm.workspace_id = v_workspace_id
      AND wm.role = 'owner'
      AND wm.status = 'active';

    IF v_owner_count < 1 THEN
      RAISE EXCEPTION 'Workspace must have at least one active owner';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_workspaces_enforce_active_owner
  AFTER INSERT OR UPDATE OF status, deleted_at ON public.workspaces
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION app_private.enforce_workspace_has_active_owner();

CREATE CONSTRAINT TRIGGER trg_workspace_members_enforce_active_owner
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION app_private.enforce_workspace_owner_invariant();

-- ---------------------------------------------------------------------------
-- public SECURITY DEFINER RPC wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_slug text)
RETURNS uuid
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

CREATE OR REPLACE FUNCTION public.soft_delete_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.soft_delete_workspace(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role public.app_member_role
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN app_private.create_workspace_invitation(p_workspace_id, p_email, p_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(p_invitation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.revoke_workspace_invitation(p_invitation_id);
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

CREATE OR REPLACE FUNCTION public.update_workspace_member_role(
  p_member_id uuid,
  p_new_role public.app_member_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.update_workspace_member_role(p_member_id, p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_workspace_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.deactivate_workspace_member(p_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.remove_workspace_member(p_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_workspace_member_to_owner(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.promote_workspace_member_to_owner(p_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.demote_workspace_owner(
  p_member_id uuid,
  p_new_role public.app_member_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM app_private.demote_workspace_owner(p_member_id, p_new_role);
END;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_select_authenticated
  ON public.workspaces
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(id));

CREATE POLICY workspace_members_select_authenticated
  ON public.workspace_members
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY workspace_invitations_select_authenticated
  ON public.workspace_invitations
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND app_private.user_workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA app_private TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;

GRANT SELECT ON TABLE public.workspaces TO authenticated;
GRANT SELECT ON TABLE public.workspace_members TO authenticated;
GRANT SELECT ON TABLE public.workspace_invitations TO authenticated;

REVOKE ALL ON TABLE public.workspaces FROM anon;
REVOKE ALL ON TABLE public.workspace_members FROM anon;
REVOKE ALL ON TABLE public.workspace_invitations FROM anon;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_workspace(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_workspace_invitation(uuid, text, public.app_member_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(uuid, text, public.app_member_role) TO authenticated;

REVOKE ALL ON FUNCTION public.revoke_workspace_invitation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invitation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.accept_workspace_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_workspace_member_role(uuid, public.app_member_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_workspace_member_role(uuid, public.app_member_role) TO authenticated;

REVOKE ALL ON FUNCTION public.deactivate_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deactivate_workspace_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_workspace_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_workspace_member_to_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promote_workspace_member_to_owner(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.demote_workspace_owner(uuid, public.app_member_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.demote_workspace_owner(uuid, public.app_member_role) TO authenticated;
