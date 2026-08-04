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
      email_confirmed_at,
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
      email_confirmed_at,
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
      email_confirmed_at,
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

-- Inbox demo data (local development only)
DO $$
DECLARE
  v_workspace_id uuid;
  v_viewer_id uuid;
  v_agent_member_id uuid;
  v_contact_open uuid;
  v_contact_pending uuid;
  v_contact_resolved uuid;
  v_session_open uuid;
  v_session_pending uuid;
  v_session_resolved uuid;
  v_session_unassigned uuid;
  v_conv_open uuid;
  v_conv_pending uuid;
  v_conv_resolved uuid;
  v_conv_unassigned uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'viewer@local.test') THEN
    v_viewer_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, recovery_sent_at, last_sign_in_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000', v_viewer_id, 'authenticated', 'authenticated',
      'viewer@local.test', extensions.crypt('local-dev-password', extensions.gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}',
      now(), now(), '', '', '', ''
    );
  ELSE
    SELECT id INTO v_viewer_id FROM auth.users WHERE email = 'viewer@local.test';
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_viewer_id, 'viewer', 'active')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id
    AND u.email = 'agent@local.test'
    AND wm.status = 'active';

  IF v_agent_member_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.conversations WHERE workspace_id = v_workspace_id LIMIT 1
  ) THEN
    RETURN;
  END IF;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_id, 'jane@example.com', 'Jane Cooper')
  RETURNING id INTO v_contact_open;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_id, 'marcus@example.com', 'Marcus Lee')
  RETURNING id INTO v_contact_pending;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_id, 'sara@example.com', 'Sara Nguyen')
  RETURNING id INTO v_contact_resolved;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_id, v_contact_open,
    encode(extensions.digest('seed-session-open', 'sha256'), 'hex'),
    now() + interval '30 days'
  )
  RETURNING id INTO v_session_open;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_id, v_contact_pending,
    encode(extensions.digest('seed-session-pending', 'sha256'), 'hex'),
    now() + interval '30 days'
  )
  RETURNING id INTO v_session_pending;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_id, v_contact_resolved,
    encode(extensions.digest('seed-session-resolved', 'sha256'), 'hex'),
    now() + interval '30 days'
  )
  RETURNING id INTO v_session_resolved;

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_id,
    encode(extensions.digest('seed-session-unassigned', 'sha256'), 'hex'),
    now() + interval '30 days'
  )
  RETURNING id INTO v_session_unassigned;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, assigned_to, status,
    source_url, message_count, last_message_at, last_message_preview, next_message_sequence
  )
  VALUES (
    v_workspace_id, v_session_open, v_contact_open, v_agent_member_id, 'open',
    'https://example.com/pricing', 2, now() - interval '5 minutes', 'Can you help with pricing?', 3
  )
  RETURNING id INTO v_conv_open;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, assigned_to, status,
    message_count, last_message_at, last_message_preview, next_message_sequence
  )
  VALUES (
    v_workspace_id, v_session_pending, v_contact_pending, v_agent_member_id, 'pending',
    2, now() - interval '1 hour', 'Thanks, I will check that.', 3
  )
  RETURNING id INTO v_conv_pending;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, assigned_to, status,
    message_count, last_message_at, last_message_preview, next_message_sequence,
    resolved_at, resolved_by
  )
  VALUES (
    v_workspace_id, v_session_resolved, v_contact_resolved, v_agent_member_id, 'resolved',
    2, now() - interval '1 day', 'All set, thank you!', 3,
    now() - interval '20 hours', v_agent_member_id
  )
  RETURNING id INTO v_conv_resolved;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, status,
    message_count, last_message_at, last_message_preview, next_message_sequence
  )
  VALUES (
    v_workspace_id, v_session_unassigned, 'open',
    1, now() - interval '10 minutes', 'Hello, anyone there?', 2
  )
  RETURNING id INTO v_conv_unassigned;

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
  )
  VALUES
    (v_workspace_id, v_conv_open, 1, 'visitor', v_session_open, 'Can you help with pricing?');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, agent_member_id, body
  )
  VALUES
    (v_workspace_id, v_conv_open, 2, 'agent', v_agent_member_id, 'Happy to help with pricing questions.');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
  )
  VALUES
    (v_workspace_id, v_conv_pending, 1, 'visitor', v_session_pending, 'Do you integrate with Slack?');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, agent_member_id, body
  )
  VALUES
    (v_workspace_id, v_conv_pending, 2, 'agent', v_agent_member_id, 'Thanks, I will check that.');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
  )
  VALUES
    (v_workspace_id, v_conv_resolved, 1, 'visitor', v_session_resolved, 'Need help resetting my widget.');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, agent_member_id, body
  )
  VALUES
    (v_workspace_id, v_conv_resolved, 2, 'agent', v_agent_member_id, 'All set, thank you!');

  INSERT INTO public.messages (
    workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
  )
  VALUES
    (v_workspace_id, v_conv_unassigned, 1, 'visitor', v_session_unassigned, 'Hello, anyone there?');
END;
$$;
