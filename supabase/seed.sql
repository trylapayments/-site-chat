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
    INSERT INTO public.workspaces (name, slug, widget_public_key, settings_json)
    VALUES (
      'Acme Support',
      'acme-support',
      'wk_e2e00000000000000000000000000001',
      jsonb_build_object(
        'widget', jsonb_build_object(
          'locale', 'en',
          'greetingMessage', 'Hi! How can we help?',
          'reopenWindowHours', 24,
          'position', 'bottom-right',
          'branding', jsonb_build_object(
            'displayName', 'Acme Support',
            'primaryColor', '#0066FF',
            'showPoweredBy', true
          )
        ),
        'ai', jsonb_build_object(
          'enabled', true,
          'provider', 'mock',
          'model', 'mock-suggested-reply',
          'features', jsonb_build_object(
            'suggestedReplies', true,
            'summary', false,
            'rag', false,
            'agent', false
          )
        )
      )
    );
  END IF;

  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';

  UPDATE public.workspaces
  SET
    widget_public_key = 'wk_e2e00000000000000000000000000001',
    settings_json = jsonb_build_object(
    'widget', jsonb_build_object(
      'locale', 'en',
      'greetingMessage', 'Hi! How can we help?',
      'reopenWindowHours', 24,
      'position', 'bottom-right',
      'branding', jsonb_build_object(
        'displayName', 'Acme Support',
        'primaryColor', '#0066FF',
        'showPoweredBy', true
      )
    ),
    'ai', jsonb_build_object(
      'enabled', true,
      'provider', 'mock',
      'model', 'mock-suggested-reply',
      'features', jsonb_build_object(
        'suggestedReplies', true,
        'summary', false,
        'rag', false,
        'agent', false
      )
    )
  )
  WHERE id = v_workspace_id;

  INSERT INTO public.allowed_domains (workspace_id, domain, verified)
  VALUES
    (v_workspace_id, 'localhost', true),
    (v_workspace_id, '127.0.0.1', true),
    (v_workspace_id, 'example.com', true)
  ON CONFLICT (workspace_id, domain) DO NOTHING;

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

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_id,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'jane@example.com',
    'Jane Cooper'
  )
  RETURNING id INTO v_contact_open;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_id,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'marcus@example.com',
    'Marcus Lee'
  )
  RETURNING id INTO v_contact_pending;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_id,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'sara@example.com',
    'Sara Nguyen'
  )
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
    source_url, message_count, last_message_at, last_message_preview, next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace_id, v_session_open, v_contact_open, v_agent_member_id, 'open',
    'https://example.com/pricing', 2, now() - interval '5 minutes', 'Can you help with pricing?', 3,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id INTO v_conv_open;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, assigned_to, status,
    message_count, last_message_at, last_message_preview, next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace_id, v_session_pending, v_contact_pending, v_agent_member_id, 'pending',
    2, now() - interval '1 hour', 'Thanks, I will check that.', 3,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id INTO v_conv_pending;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, assigned_to, status,
    message_count, last_message_at, last_message_preview, next_message_sequence,
    resolved_at, resolved_by, visitor_realtime_topic_key
  )
  VALUES (
    v_workspace_id, v_session_resolved, v_contact_resolved, v_agent_member_id, 'resolved',
    2, now() - interval '1 day', 'All set, thank you!', 3,
    now() - interval '20 hours', v_agent_member_id,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id INTO v_conv_resolved;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, status,
    message_count, last_message_at, last_message_preview, next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace_id, v_session_unassigned, 'open',
    1, now() - interval '10 minutes', 'Hello, anyone there?', 2,
    encode(extensions.gen_random_bytes(32), 'hex')
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

-- Local/E2E CRM-lite fixtures (idempotent; safe when inbox seed already ran).
DO $$
DECLARE
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_contact_id uuid;
  v_tag_id uuid;
  v_company_id uuid;
  v_field_id uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_owner_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id
    AND u.email = 'owner@local.test'
    AND wm.status = 'active'
  LIMIT 1;

  SELECT id INTO v_contact_id
  FROM public.contacts
  WHERE workspace_id = v_workspace_id
    AND email = 'jane@example.com'
  LIMIT 1;

  IF v_contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_tag_id
  FROM public.contact_tags
  WHERE workspace_id = v_workspace_id
    AND lower(name) = 'vip'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_tag_id IS NULL THEN
    INSERT INTO public.contact_tags (workspace_id, name, color, created_by, updated_by)
    VALUES (v_workspace_id, 'VIP', '#64748B', v_owner_member_id, v_owner_member_id)
    RETURNING id INTO v_tag_id;
  END IF;

  SELECT id INTO v_company_id
  FROM public.companies
  WHERE workspace_id = v_workspace_id
    AND domain = 'acme.example'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      workspace_id, name, domain, website, industry, size, created_by, updated_by
    ) VALUES (
      v_workspace_id, 'Acme Example', 'acme.example', 'https://acme.example',
      'Software', '11-50', v_owner_member_id, v_owner_member_id
    )
    RETURNING id INTO v_company_id;
  END IF;

  SELECT id INTO v_field_id
  FROM public.custom_field_definitions
  WHERE workspace_id = v_workspace_id
    AND key = 'plan_tier'
    AND deleted_at IS NULL
  LIMIT 1;

  IF v_field_id IS NULL THEN
    INSERT INTO public.custom_field_definitions (
      workspace_id, key, label, field_type, options_json, sort_order, is_required,
      created_by, updated_by
    ) VALUES (
      v_workspace_id, 'plan_tier', 'Plan tier', 'select',
      '["free","pro","enterprise"]'::jsonb, 0, false,
      v_owner_member_id, v_owner_member_id
    )
    RETURNING id INTO v_field_id;
  END IF;

  -- Keep Jane near the top of unfiltered contact lists and searchable by email.
  UPDATE public.contacts
  SET name = COALESCE(name, 'Jane Cooper'),
      last_seen_at = greatest(coalesce(last_seen_at, '-infinity'::timestamptz), now()),
      updated_at = now()
  WHERE id = v_contact_id
    AND workspace_id = v_workspace_id;
END;
$$;

-- Bulk contacts for keyset pagination e2e (Load more past default page size).
DO $$
DECLARE
  v_workspace_id uuid;
  i integer;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  IF (
    SELECT count(*)::int
    FROM public.contacts
    WHERE workspace_id = v_workspace_id
      AND email LIKE 'pagination-contact-%@example.com'
  ) >= 55 THEN
    RETURN;
  END IF;

  FOR i IN 1..55 LOOP
    INSERT INTO public.contacts (
      workspace_id,
      public_id,
      email,
      name,
      last_seen_at,
      first_seen_at,
      visit_count
    )
    VALUES (
      v_workspace_id,
      'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
      format('pagination-contact-%s@example.com', lpad(i::text, 3, '0')),
      format('Pagination Contact %s', lpad(i::text, 3, '0')),
      timestamptz '2026-01-01 00:00:00+00' - (i || ' minutes')::interval,
      timestamptz '2025-12-01 00:00:00+00' - (i || ' minutes')::interval,
      1
    );
  END LOOP;
END;
$$;

-- Bulk companies so searchable picker can find past the first page of 100.
DO $$
DECLARE
  v_workspace_id uuid;
  v_owner_member_id uuid;
  i integer;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_owner_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id
    AND u.email = 'owner@local.test'
    AND wm.status = 'active'
  LIMIT 1;

  IF (
    SELECT count(*)::int
    FROM public.companies
    WHERE workspace_id = v_workspace_id
      AND domain LIKE 'bulk-co-%.example'
      AND deleted_at IS NULL
  ) >= 101 THEN
    RETURN;
  END IF;

  FOR i IN 1..101 LOOP
    INSERT INTO public.companies (
      workspace_id, name, domain, website, industry, size, created_by, updated_by
    ) VALUES (
      v_workspace_id,
      format('Bulk Co %s', lpad(i::text, 3, '0')),
      format('bulk-co-%s.example', lpad(i::text, 3, '0')),
      format('https://bulk-co-%s.example', lpad(i::text, 3, '0')),
      'Software',
      '1-10',
      v_owner_member_id,
      v_owner_member_id
    );
  END LOOP;
END;
$$;
