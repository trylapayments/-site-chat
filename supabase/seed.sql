-- LOCAL DEVELOPMENT ONLY — DO NOT RUN IN PRODUCTION
-- Seed data for workspace foundation local development and smoke tests.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_owner_id uuid;
  v_admin_id uuid;
  v_agent_id uuid;
  v_workspace_id uuid;
  v_token_hash text;
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

  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = 'acme-support') THEN
    INSERT INTO public.workspaces (name, slug)
    VALUES ('Acme Support', 'acme-support');
  END IF;

  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_owner_id, 'owner', 'active')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_admin_id, 'admin', 'active')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_agent_id, 'agent', 'active')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

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
END;
$$;
