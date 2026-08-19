-- LOCAL DEVELOPMENT / VISUAL DEMO ONLY — DO NOT RUN IN PRODUCTION
-- Idempotent enrichment layered on top of seed.sql for local product inspection.
-- Safe for e2e: preserves Acme Support workspace key, Jane Cooper, and pricing preview.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure GoTrue email identities exist for seeded local users.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id, email
    FROM auth.users
    WHERE email IN (
      'owner@local.test',
      'admin@local.test',
      'agent@local.test',
      'viewer@local.test'
    )
  LOOP
    IF to_regclass('auth.identities') IS NULL THEN
      EXIT;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM auth.identities i
      WHERE i.user_id = r.id
        AND i.provider = 'email'
    ) THEN
      INSERT INTO auth.identities (
        id,
        user_id,
        identity_data,
        provider,
        provider_id,
        last_sign_in_at,
        created_at,
        updated_at
      )
      VALUES (
        gen_random_uuid(),
        r.id,
        jsonb_build_object('sub', r.id::text, 'email', r.email),
        'email',
        r.id::text,
        now(),
        now(),
        now()
      );
    END IF;
  END LOOP;
END;
$$;

-- Widget Studio: realistic published + draft appearance (no custom asset IDs here;
-- scripts/seed-demo-media.mjs optionally attaches the Acme logo after supabase start).
DO $$
DECLARE
  v_workspace_id uuid;
  v_appearance jsonb;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM app_private.ensure_widget_config(v_workspace_id);

  v_appearance := jsonb_build_object(
    'schemaVersion', 1,
    'primaryColor', '#0066FF',
    'accentColor', '#0052CC',
    'backgroundColor', '#FFFFFF',
    'textColor', '#0F172A',
    'launcherColor', '#0066FF',
    'launcherIcon', 'message',
    'launcherShape', 'circle',
    'launcherSize', 'lg',
    'launcherPosition', 'bottom-right',
    'launcherOffsetX', 20,
    'launcherOffsetY', 20,
    'launcherIconAssetId', null,
    'borderRadius', 18,
    'shadowLevel', 'md',
    'widgetWidth', 400,
    'widgetHeight', 600,
    'widgetMaxHeight', 760,
    'density', 'comfortable',
    'headerStyle', 'branded',
    'headerTitle', jsonb_build_object(
      'useSystemDefaults', false,
      'overrides', jsonb_build_object(
        'en', 'Acme Support',
        'de', 'Acme Support'
      )
    ),
    'subtitle', jsonb_build_object(
      'useSystemDefaults', false,
      'overrides', jsonb_build_object(
        'en', 'We usually reply in a few minutes',
        'de', 'Wir antworten in wenigen Minuten'
      )
    ),
    'logoAssetId', null,
    'agentAvatarAssetId', null,
    'welcomeMessage', jsonb_build_object(
      'useSystemDefaults', false,
      'overrides', jsonb_build_object(
        'en', 'Hi! Ask us anything about Acme — pricing, setup, or billing.',
        'de', 'Hallo! Fragen Sie uns zu Preisen, Einrichtung oder Abrechnung.'
      )
    ),
    'placeholderText', jsonb_build_object(
      'useSystemDefaults', false,
      'overrides', jsonb_build_object(
        'en', 'Type your message…',
        'de', 'Nachricht schreiben…'
      )
    ),
    'sendButtonStyle', 'icon-text',
    'fontFamily', 'inter',
    'fontSizeScale', 'md',
    'colorMode', 'light',
    'autoOpenDelayMs', null,
    'hideLauncherWhenOpen', true,
    'showGreeting', true,
    'mobileBehavior', 'fullscreen',
    'showAgentAvatars', true,
    'showPoweredBy', true,
    'soundEnabled', false,
    'locale', 'en',
    'reopenWindowHours', 24,
    'businessHours', jsonb_build_object(
      'enabled', false,
      'timezone', 'America/New_York',
      'weekly', '[]'::jsonb
    ),
    'presetId', 'clean'
  );

  -- Validate through the same path Widget Studio uses.
  v_appearance := app_private.validate_widget_appearance(v_appearance);

  UPDATE public.widget_configs
  SET
    draft_json = v_appearance,
    published_json = v_appearance,
    published_version = GREATEST(published_version, 1),
    draft_updated_at = now(),
    published_at = now(),
    updated_at = now()
  WHERE workspace_id = v_workspace_id;
END;
$$;

-- CRM enrichment for Jane + extra realistic contacts.
DO $$
DECLARE
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_agent_member_id uuid;
  v_jane uuid;
  v_marcus uuid;
  v_sara uuid;
  v_tag_vip uuid;
  v_tag_trial uuid;
  v_company_id uuid;
  v_field_id uuid;
  v_contact_priya uuid;
  v_contact_owen uuid;
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

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id
    AND u.email = 'agent@local.test'
    AND wm.status = 'active'
  LIMIT 1;

  SELECT id INTO v_jane FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'jane@example.com' LIMIT 1;
  SELECT id INTO v_marcus FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'marcus@example.com' LIMIT 1;
  SELECT id INTO v_sara FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'sara@example.com' LIMIT 1;

  SELECT id INTO v_tag_vip FROM public.contact_tags
  WHERE workspace_id = v_workspace_id AND lower(name) = 'vip' AND deleted_at IS NULL LIMIT 1;
  IF v_tag_vip IS NULL THEN
    INSERT INTO public.contact_tags (workspace_id, name, color, created_by, updated_by)
    VALUES (v_workspace_id, 'VIP', '#64748B', v_owner_member_id, v_owner_member_id)
    RETURNING id INTO v_tag_vip;
  END IF;

  SELECT id INTO v_tag_trial FROM public.contact_tags
  WHERE workspace_id = v_workspace_id AND lower(name) = 'trial' AND deleted_at IS NULL LIMIT 1;
  IF v_tag_trial IS NULL THEN
    INSERT INTO public.contact_tags (workspace_id, name, color, created_by, updated_by)
    VALUES (v_workspace_id, 'Trial', '#0EA5E9', v_owner_member_id, v_owner_member_id)
    RETURNING id INTO v_tag_trial;
  END IF;

  SELECT id INTO v_company_id FROM public.companies
  WHERE workspace_id = v_workspace_id AND domain = 'acme.example' AND deleted_at IS NULL LIMIT 1;
  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (
      workspace_id, name, domain, website, industry, size, created_by, updated_by
    ) VALUES (
      v_workspace_id, 'Acme Example', 'acme.example', 'https://acme.example',
      'Software', '11-50', v_owner_member_id, v_owner_member_id
    )
    RETURNING id INTO v_company_id;
  END IF;

  SELECT id INTO v_field_id FROM public.custom_field_definitions
  WHERE workspace_id = v_workspace_id AND key = 'plan_tier' AND deleted_at IS NULL LIMIT 1;
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

  IF v_jane IS NOT NULL THEN
    UPDATE public.contacts
    SET
      name = COALESCE(name, 'Jane Cooper'),
      phone = COALESCE(phone, '+1 415-555-0142'),
      phone_e164 = COALESCE(phone_e164, '+14155550142'),
      job_title = COALESCE(job_title, 'Head of Operations'),
      locale = COALESCE(locale, 'en-US'),
      country_code = COALESCE(country_code, 'US'),
      company_id = COALESCE(company_id, v_company_id),
      last_seen_at = greatest(coalesce(last_seen_at, '-infinity'::timestamptz), now() - interval '5 minutes'),
      visit_count = greatest(visit_count, 12),
      updated_at = now()
    WHERE id = v_jane AND workspace_id = v_workspace_id;

    INSERT INTO public.contact_tag_assignments (workspace_id, contact_id, tag_id, assigned_by)
    VALUES (v_workspace_id, v_jane, v_tag_vip, v_owner_member_id)
    ON CONFLICT (workspace_id, contact_id, tag_id) DO NOTHING;

    INSERT INTO public.custom_field_values (
      workspace_id, contact_id, field_id, value_select
    ) VALUES (
      v_workspace_id, v_jane, v_field_id, 'pro'
    )
    ON CONFLICT (workspace_id, contact_id, field_id) DO UPDATE
      SET value_select = EXCLUDED.value_select, updated_at = now();
  END IF;

  IF v_marcus IS NOT NULL THEN
    UPDATE public.contacts
    SET
      phone = COALESCE(phone, '+1 646-555-0199'),
      job_title = COALESCE(job_title, 'Engineering Manager'),
      locale = COALESCE(locale, 'en-US'),
      country_code = COALESCE(country_code, 'US'),
      visit_count = greatest(visit_count, 4),
      updated_at = now()
    WHERE id = v_marcus AND workspace_id = v_workspace_id;

    INSERT INTO public.contact_tag_assignments (workspace_id, contact_id, tag_id, assigned_by)
    VALUES (v_workspace_id, v_marcus, v_tag_trial, v_owner_member_id)
    ON CONFLICT (workspace_id, contact_id, tag_id) DO NOTHING;
  END IF;

  IF v_sara IS NOT NULL THEN
    UPDATE public.contacts
    SET
      job_title = COALESCE(job_title, 'Support Lead'),
      locale = COALESCE(locale, 'en-GB'),
      country_code = COALESCE(country_code, 'GB'),
      visit_count = greatest(visit_count, 7),
      updated_at = now()
    WHERE id = v_sara AND workspace_id = v_workspace_id;
  END IF;

  -- Extra demo contacts (idempotent by email).
  SELECT id INTO v_contact_priya FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'priya@northwind.io' LIMIT 1;
  IF v_contact_priya IS NULL THEN
    INSERT INTO public.contacts (
      workspace_id, public_id, email, name, phone, phone_e164, job_title,
      locale, country_code, company_id, visit_count, last_seen_at
    ) VALUES (
      v_workspace_id,
      'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
      'priya@northwind.io',
      'Priya Shah',
      '+1 312-555-0177',
      '+13125550177',
      'Customer Success',
      'en-US',
      'US',
      v_company_id,
      3,
      now() - interval '25 minutes'
    )
    RETURNING id INTO v_contact_priya;
  END IF;

  SELECT id INTO v_contact_owen FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'owen@brightside.co' LIMIT 1;
  IF v_contact_owen IS NULL THEN
    INSERT INTO public.contacts (
      workspace_id, public_id, email, name, phone, job_title,
      locale, country_code, visit_count, last_seen_at
    ) VALUES (
      v_workspace_id,
      'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
      'owen@brightside.co',
      'Owen Bright',
      '+44 20 7946 0958',
      'Founder',
      'en-GB',
      'GB',
      2,
      now() - interval '2 hours'
    )
    RETURNING id INTO v_contact_owen;

    INSERT INTO public.contact_tag_assignments (workspace_id, contact_id, tag_id, assigned_by)
    VALUES (v_workspace_id, v_contact_owen, v_tag_trial, v_agent_member_id)
    ON CONFLICT (workspace_id, contact_id, tag_id) DO NOTHING;
  END IF;
END;
$$;

-- Extra conversations: unread visitor follow-up, attachment thread, billing question.
DO $$
DECLARE
  v_workspace_id uuid;
  v_agent_member_id uuid;
  v_priya uuid;
  v_owen uuid;
  v_session_priya uuid;
  v_session_owen uuid;
  v_conv_unread uuid;
  v_conv_attach uuid;
  v_conv_billing uuid;
  v_msg_attach uuid;
  v_attachment_id uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1'::uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  -- Marker: skip if demo enrichment already applied.
  IF EXISTS (
    SELECT 1 FROM public.conversations
    WHERE workspace_id = v_workspace_id
      AND last_message_preview = 'Here is the signed order form.'
  ) THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'agent@local.test' AND wm.status = 'active'
  LIMIT 1;

  SELECT id INTO v_priya FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'priya@northwind.io' LIMIT 1;
  SELECT id INTO v_owen FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'owen@brightside.co' LIMIT 1;

  -- Priya: assigned open conversation with attachment metadata (bytes uploaded by seed-demo-media).
  IF v_priya IS NOT NULL THEN
    INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
    VALUES (
      v_workspace_id, v_priya,
      encode(extensions.digest('seed-session-priya', 'sha256'), 'hex'),
      now() + interval '30 days'
    )
    RETURNING id INTO v_session_priya;

    INSERT INTO public.conversations (
      workspace_id, visitor_session_id, contact_id, assigned_to, status,
      source_url, message_count, last_message_at, last_message_preview, next_message_sequence,
      visitor_realtime_topic_key
    ) VALUES (
      v_workspace_id, v_session_priya, v_priya, v_agent_member_id, 'open',
      'https://example.com/docs/onboarding', 2, now() - interval '40 minutes',
      'Here is the signed order form.', 3,
      encode(extensions.gen_random_bytes(32), 'hex')
    )
    RETURNING id INTO v_conv_attach;

    INSERT INTO public.messages (
      workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
    ) VALUES (
      v_workspace_id, v_conv_attach, 1, 'visitor', v_session_priya,
      'Sharing our signed order form for onboarding.'
    );

    INSERT INTO public.messages (
      workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
    ) VALUES (
      v_workspace_id, v_conv_attach, 2, 'visitor', v_session_priya,
      'Here is the signed order form.'
    )
    RETURNING id INTO v_msg_attach;

    INSERT INTO public.message_attachments (
      id, workspace_id, message_id, conversation_id, storage_key,
      mime_type, filename, size_bytes, kind, width, height, scan_status, sort_order
    ) VALUES (
      v_attachment_id,
      v_workspace_id,
      v_msg_attach,
      v_conv_attach,
      v_workspace_id::text || '/' || v_conv_attach::text || '/' || v_attachment_id::text || '/receipt.png',
      'image/png',
      'receipt.png',
      229,
      'image',
      64,
      64,
      'skipped',
      0
    );
  END IF;

  -- Owen: unassigned billing question (unread).
  IF v_owen IS NOT NULL THEN
    INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
    VALUES (
      v_workspace_id, v_owen,
      encode(extensions.digest('seed-session-owen', 'sha256'), 'hex'),
      now() + interval '30 days'
    )
    RETURNING id INTO v_session_owen;

    INSERT INTO public.conversations (
      workspace_id, visitor_session_id, contact_id, status,
      source_url, message_count, last_message_at, last_message_preview, next_message_sequence,
      visitor_realtime_topic_key
    ) VALUES (
      v_workspace_id, v_session_owen, v_owen, 'open',
      'https://example.com/billing', 1, now() - interval '8 minutes',
      'My invoice looks wrong for March.', 2,
      encode(extensions.gen_random_bytes(32), 'hex')
    )
    RETURNING id INTO v_conv_billing;

    INSERT INTO public.messages (
      workspace_id, conversation_id, sequence_number, sender_type, visitor_session_id, body
    ) VALUES (
      v_workspace_id, v_conv_billing, 1, 'visitor', v_session_owen,
      'My invoice looks wrong for March.'
    );
  END IF;

  -- Mark Marcus pending conversation as fully read by agent (contrast with unread Jane/Owen).
  SELECT id INTO v_conv_unread FROM public.conversations
  WHERE workspace_id = v_workspace_id
    AND last_message_preview = 'Thanks, I will check that.'
  LIMIT 1;

  IF v_conv_unread IS NOT NULL AND v_agent_member_id IS NOT NULL THEN
    INSERT INTO public.conversation_member_reads (
      workspace_id, conversation_id, member_id,
      last_read_sequence, last_delivered_sequence, unread_count, last_read_at
    ) VALUES (
      v_workspace_id, v_conv_unread, v_agent_member_id,
      2, 2, 0, now() - interval '50 minutes'
    )
    ON CONFLICT (conversation_id, member_id) DO NOTHING;
  END IF;
END;
$$;

-- Canned responses for slash-menu demo.
DO $$
DECLARE
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_agent_member_id uuid;
  v_folder_id uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.canned_responses
    WHERE workspace_id = v_workspace_id
      AND shortcut = 'pricing'
      AND deleted_at IS NULL
  ) THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_owner_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'owner@local.test' AND wm.status = 'active'
  LIMIT 1;

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'agent@local.test' AND wm.status = 'active'
  LIMIT 1;

  INSERT INTO public.canned_response_folders (
    workspace_id, visibility, name, created_by, updated_by
  ) VALUES (
    v_workspace_id, 'workspace', 'Sales', v_owner_member_id, v_owner_member_id
  )
  RETURNING id INTO v_folder_id;

  INSERT INTO public.canned_responses (
    workspace_id, visibility, owner_member_id, folder_id, title, body, shortcut,
    created_by, updated_by
  ) VALUES
    (
      v_workspace_id, 'workspace', NULL, v_folder_id,
      'Pricing overview',
      'Happy to help with pricing. Our Pro plan is $49/seat/month and includes the live inbox, Widget Studio, and canned responses. Want a walkthrough?',
      'pricing',
      v_owner_member_id, v_owner_member_id
    ),
    (
      v_workspace_id, 'workspace', NULL, v_folder_id,
      'Greeting',
      'Hi {{visitor.name}} — thanks for reaching out to {{workspace.name}}. How can we help today?',
      'hi',
      v_owner_member_id, v_owner_member_id
    ),
    (
      v_workspace_id, 'personal', v_agent_member_id, NULL,
      'Need more detail',
      'Thanks — could you share a screenshot or the account email so I can dig in?',
      'detail',
      v_agent_member_id, v_agent_member_id
    );
END;
$$;

-- Internal notes + @mentions on Jane's open conversation.
DO $$
DECLARE
  v_workspace_id uuid;
  v_owner_member_id uuid;
  v_agent_member_id uuid;
  v_conv_open uuid;
  v_note_id uuid;
  v_body text;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_conv_open FROM public.conversations
  WHERE workspace_id = v_workspace_id
    AND last_message_preview = 'Can you help with pricing?'
  LIMIT 1;

  IF v_conv_open IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.internal_notes
    WHERE workspace_id = v_workspace_id
      AND conversation_id = v_conv_open
      AND deleted_at IS NULL
      AND body LIKE '%VIP account%'
  ) THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_owner_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'owner@local.test' AND wm.status = 'active'
  LIMIT 1;

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'agent@local.test' AND wm.status = 'active'
  LIMIT 1;

  v_body := format(
    'VIP account — please prioritize. @[agent@local.test](member:%s) can you take the enterprise quote?',
    v_agent_member_id::text
  );

  INSERT INTO public.internal_notes (
    workspace_id, conversation_id, author_member_id, body
  ) VALUES (
    v_workspace_id, v_conv_open, v_owner_member_id, v_body
  )
  RETURNING id INTO v_note_id;

  INSERT INTO public.internal_note_mentions (
    workspace_id, note_id, mentioned_member_id
  ) VALUES (
    v_workspace_id, v_note_id, v_agent_member_id
  );

  INSERT INTO public.internal_notes (
    workspace_id, conversation_id, author_member_id, body
  ) VALUES (
    v_workspace_id, v_conv_open, v_agent_member_id,
    'Acknowledged — drafting the quote and will reply in-thread.'
  );
END;
$$;

-- Customer timeline events for Jane (durable history for Timeline tab / contact page).
DO $$
DECLARE
  v_workspace_id uuid;
  v_agent_member_id uuid;
  v_owner_member_id uuid;
  v_jane uuid;
  v_session uuid;
  v_conv uuid;
BEGIN
  SELECT id INTO v_workspace_id FROM public.workspaces WHERE slug = 'acme-support';
  IF v_workspace_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_jane FROM public.contacts
  WHERE workspace_id = v_workspace_id AND email = 'jane@example.com' LIMIT 1;
  IF v_jane IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = v_workspace_id
      AND contact_id = v_jane
      AND dedupe_key = 'demo:jane:page_viewed:pricing'
  ) THEN
    RETURN;
  END IF;

  SELECT wm.id INTO v_agent_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'agent@local.test' AND wm.status = 'active'
  LIMIT 1;

  SELECT wm.id INTO v_owner_member_id
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.workspace_id = v_workspace_id AND u.email = 'owner@local.test' AND wm.status = 'active'
  LIMIT 1;

  SELECT c.id, c.visitor_session_id INTO v_conv, v_session
  FROM public.conversations c
  WHERE c.workspace_id = v_workspace_id
    AND c.contact_id = v_jane
  ORDER BY c.last_message_at DESC NULLS LAST
  LIMIT 1;

  INSERT INTO public.customer_timeline_events (
    workspace_id, contact_id, visitor_session_id, conversation_id,
    event_type, actor_type, actor_member_id, metadata_json, occurred_at, dedupe_key
  ) VALUES
    (
      v_workspace_id, v_jane, v_session, NULL,
      'page_viewed', 'visitor', NULL,
      '{"v":1,"path":"/pricing","title":"Pricing"}'::jsonb,
      now() - interval '35 minutes',
      'demo:jane:page_viewed:pricing'
    ),
    (
      v_workspace_id, v_jane, v_session, v_conv,
      'conversation_started', 'visitor', NULL,
      '{"v":1,"source_url":"https://example.com/pricing"}'::jsonb,
      now() - interval '30 minutes',
      'demo:jane:conversation_started'
    ),
    (
      v_workspace_id, v_jane, v_session, v_conv,
      'visitor_message_sent', 'visitor', NULL,
      '{"v":1}'::jsonb,
      now() - interval '28 minutes',
      'demo:jane:visitor_message_1'
    ),
    (
      v_workspace_id, v_jane, v_session, v_conv,
      'conversation_assigned', 'operator', v_agent_member_id,
      jsonb_build_object('v', 1, 'assignee_member_id', v_agent_member_id),
      now() - interval '27 minutes',
      'demo:jane:assigned'
    ),
    (
      v_workspace_id, v_jane, v_session, v_conv,
      'operator_message_sent', 'operator', v_agent_member_id,
      '{"v":1}'::jsonb,
      now() - interval '26 minutes',
      'demo:jane:operator_message_1'
    ),
    (
      v_workspace_id, v_jane, NULL, NULL,
      'visitor_identified', 'system', NULL,
      '{"v":1,"email":"jane@example.com"}'::jsonb,
      now() - interval '25 minutes',
      'demo:jane:identified'
    ),
    (
      v_workspace_id, v_jane, NULL, NULL,
      'company_linked', 'operator', v_owner_member_id,
      '{"v":1,"company_name":"Acme Example"}'::jsonb,
      now() - interval '20 minutes',
      'demo:jane:company_linked'
    ),
    (
      v_workspace_id, v_jane, NULL, NULL,
      'tag_added', 'operator', v_owner_member_id,
      '{"v":1,"tag_name":"VIP"}'::jsonb,
      now() - interval '19 minutes',
      'demo:jane:tag_vip'
    ),
    (
      v_workspace_id, v_jane, NULL, NULL,
      'custom_field_updated', 'operator', v_owner_member_id,
      '{"v":1,"field_key":"plan_tier","value":"pro"}'::jsonb,
      now() - interval '18 minutes',
      'demo:jane:plan_tier'
    ),
    (
      v_workspace_id, v_jane, v_session, v_conv,
      'visitor_message_sent', 'visitor', NULL,
      '{"v":1}'::jsonb,
      now() - interval '2 minutes',
      'demo:jane:visitor_message_followup'
    );
END;
$$;
