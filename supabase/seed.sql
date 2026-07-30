-- LOCAL DEVELOPMENT ONLY — DO NOT RUN IN PRODUCTION
-- Seed data for workspace foundation local development and smoke tests.
--
-- Diagnostic instrumentation: each logical section runs as its own top-level
-- statement so CI reports the exact failing section, SQLSTATE, and message.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TEMP TABLE IF NOT EXISTS _seed_state (
  key text PRIMARY KEY,
  val uuid NOT NULL
);

-- SEED_DIAG: auth.users owner@local.test
DO $seed_owner_user$
DECLARE
  v_owner_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'owner@local.test') THEN
    v_owner_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      confirmed_at,
      recovery_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_owner_id,
      'authenticated',
      'authenticated',
      'owner@local.test',
      extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  ELSE
    SELECT id INTO v_owner_id FROM auth.users WHERE email = 'owner@local.test';
  END IF;

  INSERT INTO _seed_state (key, val) VALUES ('owner_id', v_owner_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=auth.users:owner@local.test sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_owner_user$;

-- SEED_DIAG: auth.users admin@local.test
DO $seed_admin_user$
DECLARE
  v_admin_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@local.test') THEN
    v_admin_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      confirmed_at,
      recovery_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_admin_id,
      'authenticated',
      'authenticated',
      'admin@local.test',
      extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  ELSE
    SELECT id INTO v_admin_id FROM auth.users WHERE email = 'admin@local.test';
  END IF;

  INSERT INTO _seed_state (key, val) VALUES ('admin_id', v_admin_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=auth.users:admin@local.test sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_admin_user$;

-- SEED_DIAG: auth.users agent@local.test
DO $seed_agent_user$
DECLARE
  v_agent_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'agent@local.test') THEN
    v_agent_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      confirmed_at,
      recovery_sent_at,
      last_sign_in_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_agent_id,
      'authenticated',
      'authenticated',
      'agent@local.test',
      extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{}',
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  ELSE
    SELECT id INTO v_agent_id FROM auth.users WHERE email = 'agent@local.test';
  END IF;

  INSERT INTO _seed_state (key, val) VALUES ('agent_id', v_agent_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=auth.users:agent@local.test sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_agent_user$;

-- SEED_DIAG: public.workspaces acme-support
DO $seed_workspace$
DECLARE
  v_workspace_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = 'acme-support') THEN
    INSERT INTO public.workspaces (name, slug)
    VALUES ('Acme Support', 'acme-support');
  END IF;

  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';

  INSERT INTO _seed_state (key, val) VALUES ('workspace_id', v_workspace_id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=public.workspaces:acme-support sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_workspace$;

-- SEED_DIAG: public.workspace_members owner
DO $seed_member_owner$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  SELECT workspace.val, owner.val, 'owner', 'active'
  FROM _seed_state workspace
  JOIN _seed_state owner ON workspace.key = 'workspace_id' AND owner.key = 'owner_id'
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=public.workspace_members:owner sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_member_owner$;

-- SEED_DIAG: public.workspace_members admin
DO $seed_member_admin$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  SELECT workspace.val, admin.val, 'admin', 'active'
  FROM _seed_state workspace
  JOIN _seed_state admin ON workspace.key = 'workspace_id' AND admin.key = 'admin_id'
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=public.workspace_members:admin sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_member_admin$;

-- SEED_DIAG: public.workspace_members agent
DO $seed_member_agent$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  SELECT workspace.val, agent.val, 'agent', 'active'
  FROM _seed_state workspace
  JOIN _seed_state agent ON workspace.key = 'workspace_id' AND agent.key = 'agent_id'
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=public.workspace_members:agent sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_member_agent$;

-- SEED_DIAG: public.workspace_invitations invitee@local.test
DO $seed_invitation$
DECLARE
  v_workspace_id uuid;
  v_owner_id uuid;
  v_token_hash text;
BEGIN
  SELECT val INTO v_workspace_id FROM _seed_state WHERE key = 'workspace_id';
  SELECT val INTO v_owner_id FROM _seed_state WHERE key = 'owner_id';

  -- Plaintext token for manual testing: local-dev-invite-token
  v_token_hash := encode(extensions.digest(convert_to('local-dev-invite-token', 'UTF8'), 'sha256'), 'hex');

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_invitations
    WHERE workspace_id = v_workspace_id
      AND email_normalized = 'invitee@local.test'
      AND accepted_at IS NULL
      AND revoked_at IS NULL
  ) THEN
    INSERT INTO public.workspace_invitations (
      workspace_id,
      email,
      role,
      token_hash,
      invited_by_user_id,
      expires_at
    )
    VALUES (
      v_workspace_id,
      'invitee@local.test',
      'viewer',
      v_token_hash,
      v_owner_id,
      now() + interval '7 days'
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION
      '[SEED_DIAG] section=public.workspace_invitations:invitee@local.test sqlstate=% message=% detail=% hint=%',
      SQLSTATE, SQLERRM, PG_EXCEPTION_DETAIL, PG_EXCEPTION_HINT;
END;
$seed_invitation$;
