\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- legacy insert public_id(2) + ensure_visitor_contact format(1)
-- + unsigned identify cannot merge(4) + public_id/continuity token binding(3)
-- + schema(13) + page_views privileges(3) + RLS select/cross-tenant(3)
-- + public wrapper RPC privileges(12) + SECURITY DEFINER prosecdef(2)
-- + app_private helper privileges, 13 helpers x 3 roles(39)
-- + page-view dedupe/record/count(3) + tab_id/no-conversation-touch(2) + cascade(1)
-- + sanitize_page_url redaction(3)
-- + operator: viewer deny(1) + foreign workspace deny(1) + agent allow(1)
--   + profile shape(2) + no last_seen bump(1)
-- + send links conversation.contact_id from session(2)
-- + send/attachment URL privacy regression(16)
-- = 115
SELECT plan(115);

TRUNCATE tests.fixtures;

-- ---------------------------------------------------------------------------
-- Base fixtures: workspaces, members, cross-tenant contact, session, conversation
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_owner_a uuid;
  v_owner_b uuid;
  v_viewer_a uuid;
  v_agent_a uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_contact_b uuid;
  v_session_a uuid;
  v_conversation_a uuid;
  v_token text := 'visitor-identity-session-token';
  v_token_hash text;
BEGIN
  v_owner_a := tests.create_auth_user('visitor-id-owner-a@test.local');
  v_owner_b := tests.create_auth_user('visitor-id-owner-b@test.local');
  v_viewer_a := tests.create_auth_user('visitor-id-viewer-a@test.local');
  v_agent_a := tests.create_auth_user('visitor-id-agent-a@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'visitor-id-owner-a@test.local');
  v_workspace_a := (
    public.create_workspace('Visitor Identity A', 'visitor-identity-a')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'visitor-id-owner-b@test.local');
  v_workspace_b := (
    public.create_workspace('Visitor Identity B', 'visitor-identity-b')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_viewer_a, 'viewer', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active');

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_b,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'secret-b@test.local',
    'Workspace B Visitor'
  )
  RETURNING id INTO v_contact_b;

  v_token_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.visitor_sessions (
    workspace_id,
    session_token_hash,
    expires_at,
    locale
  )
  VALUES (
    v_workspace_a,
    v_token_hash,
    now() + interval '1 day',
    'en'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    next_message_sequence
  )
  VALUES (
    v_workspace_a,
    v_session_a,
    'open',
    1
  )
  RETURNING id INTO v_conversation_a;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('owner_a', v_owner_a::text),
    ('owner_b', v_owner_b::text),
    ('viewer_a', v_viewer_a::text),
    ('agent_a', v_agent_a::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('contact_b', v_contact_b::text),
    ('session_a', v_session_a::text),
    ('conversation_a', v_conversation_a::text),
    ('session_token', v_token);
END;
$$;

-- ---------------------------------------------------------------------------
-- Legacy contact insert without public_id (durable DEFAULT format)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_contact public.contacts;
BEGIN
  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (
    tests.fixture('workspace_a')::uuid,
    'legacy-insert@test.local',
    'Legacy Insert'
  )
  RETURNING * INTO v_contact;

  INSERT INTO tests.fixtures (key, value)
  VALUES ('legacy_public_id', v_contact.public_id);
END;
$$;

SELECT isnt(
  tests.fixture('legacy_public_id'),
  NULL,
  'legacy contact insert without public_id succeeds'
);

SELECT matches(
  tests.fixture('legacy_public_id'),
  '^vis_[a-f0-9]{32}$',
  'legacy contact insert gets durable vis_ + 32 hex public_id default'
);

-- ---------------------------------------------------------------------------
-- ensure_visitor_contact (2-arg): always creates, never binds by public_id
-- ---------------------------------------------------------------------------

SELECT matches(
  (
    app_private.ensure_visitor_contact(
      tests.fixture('workspace_a')::uuid,
      false
    )
  ).public_id,
  '^vis_[a-f0-9]{32}$',
  'ensure_visitor_contact creates vis_ + 32 hex public_id'
);

-- ---------------------------------------------------------------------------
-- Unsigned identify cannot merge contacts by email
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_victim_contact uuid;
  v_victim_session uuid;
  v_victim_conversation uuid;
  v_victim_session_hash text;
  v_attacker_result jsonb;
  v_attacker_session_token text;
  v_attacker_session uuid;
  v_attacker_contact uuid;
  v_victim_conversation_updated_before timestamptz;
  v_victim_conversation_updated_after timestamptz;
  v_error text := NULL;
BEGIN
  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace, 'victim@test.local', 'Victim')
  RETURNING id INTO v_victim_contact;

  v_victim_session_hash := encode(
    extensions.digest(convert_to('victim-session-token', 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.visitor_sessions (
    workspace_id, contact_id, session_token_hash, expires_at, locale
  )
  VALUES (v_workspace, v_victim_contact, v_victim_session_hash, now() + interval '1 day', 'en')
  RETURNING id INTO v_victim_session;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, status, next_message_sequence
  )
  VALUES (v_workspace, v_victim_session, v_victim_contact, 'open', 1)
  RETURNING id INTO v_victim_conversation;

  v_attacker_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL
  );
  v_attacker_session_token := v_attacker_result ->> 'session_token';

  SELECT id, contact_id
  INTO v_attacker_session, v_attacker_contact
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_attacker_session_token);

  SELECT updated_at
  INTO v_victim_conversation_updated_before
  FROM public.conversations
  WHERE id = v_victim_conversation;

  PERFORM pg_sleep(0.05);

  BEGIN
    PERFORM public.widget_identify_visitor(
      v_workspace,
      v_attacker_session_token,
      'Attacker',
      'victim@test.local',
      NULL,
      NULL,
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  SELECT updated_at
  INTO v_victim_conversation_updated_after
  FROM public.conversations
  WHERE id = v_victim_conversation;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('identify_conflict_error', COALESCE(v_error, '')),
    (
      'attacker_stays_on_own_contact',
      (
        SELECT (contact_id = v_attacker_contact)::text
        FROM public.visitor_sessions
        WHERE id = v_attacker_session
      )
    ),
    (
      'victim_session_unchanged',
      (
        SELECT (contact_id = v_victim_contact)::text
        FROM public.visitor_sessions
        WHERE id = v_victim_session
      )
    ),
    (
      'victim_conversation_untouched',
      (v_victim_conversation_updated_before = v_victim_conversation_updated_after)::text
    );
END;
$$;

SELECT is(
  tests.fixture('identify_conflict_error'),
  'Email already belongs to another visitor in this workspace',
  'unsigned identify with another visitor''s email raises a clear conflict (no merge)'
);

SELECT is(
  tests.fixture('attacker_stays_on_own_contact'),
  'true',
  'attacker session stays on its own contact after failed identify'
);

SELECT is(
  tests.fixture('victim_session_unchanged'),
  'true',
  'victim session is unaffected by attacker''s identify attempt'
);

SELECT is(
  tests.fixture('victim_conversation_untouched'),
  'true',
  'victim conversation.updated_at is unaffected by attacker''s identify attempt'
);

-- ---------------------------------------------------------------------------
-- public_id is NOT authorization; continuity_token is the binder
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_session1 jsonb;
  v_session_no_token jsonb;
  v_session_bad_token jsonb;
  v_session_valid_token jsonb;
  v_public_id_1 text;
  v_continuity_1 text;
BEGIN
  v_session1 := public.widget_create_or_resume_visitor_session(v_workspace, NULL, 'en', NULL, NULL);
  v_public_id_1 := v_session1 ->> 'visitor_public_id';
  v_continuity_1 := v_session1 ->> 'continuity_token';

  -- New session, no continuity token: must create a fresh contact (never bind by public_id).
  v_session_no_token := public.widget_create_or_resume_visitor_session(v_workspace, NULL, 'en', NULL, NULL);

  -- New session, passing the known public_id as the continuity token: must be ignored.
  v_session_bad_token := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL, v_public_id_1
  );

  -- New session, passing the real continuity token: must bind to the same contact.
  v_session_valid_token := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL, v_continuity_1
  );

  INSERT INTO tests.fixtures (key, value) VALUES
    (
      'no_token_creates_new_contact',
      (v_public_id_1 IS DISTINCT FROM (v_session_no_token ->> 'visitor_public_id'))::text
    ),
    (
      'public_id_as_token_ignored',
      (v_public_id_1 IS DISTINCT FROM (v_session_bad_token ->> 'visitor_public_id'))::text
    ),
    (
      'continuity_token_binds_same_contact',
      (v_public_id_1 = (v_session_valid_token ->> 'visitor_public_id'))::text
    );
END;
$$;

SELECT is(
  tests.fixture('no_token_creates_new_contact'),
  'true',
  'new session without continuity token creates a distinct contact (not bound to any existing public_id)'
);

SELECT is(
  tests.fixture('public_id_as_token_ignored'),
  'true',
  'supplying a public_id as p_continuity_token is ignored (public_id is not an authorization secret)'
);

SELECT is(
  tests.fixture('continuity_token_binds_same_contact'),
  'true',
  'valid continuity_token binds a new session to the same visitor contact'
);

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

SELECT has_column('public', 'contacts', 'public_id', 'contacts.public_id exists');
SELECT has_column('public', 'contacts', 'visit_count', 'contacts.visit_count exists');
SELECT has_column('public', 'contacts', 'phone_e164', 'contacts.phone_e164 exists');
SELECT has_column(
  'public',
  'contacts',
  'continuity_token_hash',
  'contacts.continuity_token_hash exists'
);
SELECT has_table('public', 'visitor_page_views', 'visitor_page_views table exists');
SELECT has_column(
  'public',
  'visitor_page_views',
  'tab_id',
  'visitor_page_views.tab_id exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'device_type',
  'visitor_sessions.device_type exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'landing_url',
  'visitor_sessions.landing_url exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'browser_family',
  'visitor_sessions.browser_family exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'last_seen_at',
  'visitor_sessions.last_seen_at exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'country_code',
  'visitor_sessions.country_code exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'active_tab_id',
  'visitor_sessions.active_tab_id exists'
);
SELECT has_column(
  'public',
  'visitor_sessions',
  'active_tab_seen_at',
  'visitor_sessions.active_tab_seen_at exists'
);

-- ---------------------------------------------------------------------------
-- visitor_page_views privileges + RLS
-- ---------------------------------------------------------------------------

SELECT ok(
  has_table_privilege('authenticated', 'public.visitor_page_views', 'SELECT'),
  'authenticated can SELECT visitor_page_views'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.visitor_page_views', 'INSERT'),
  'authenticated cannot INSERT visitor_page_views'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.visitor_page_views', 'SELECT'),
  'anon cannot SELECT visitor_page_views'
);

INSERT INTO public.visitor_page_views (
  workspace_id,
  visitor_session_id,
  url,
  title
)
VALUES (
  tests.fixture('workspace_a')::uuid,
  tests.fixture('session_a')::uuid,
  'https://example.com/rls-seed',
  'RLS seed'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'visitor-id-owner-a@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  1,
  'workspace A member can select own visitor_page_views'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.contacts
    WHERE workspace_id = tests.fixture('workspace_b')::uuid
  ),
  0,
  'member of A cannot select contacts of B'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE workspace_id = tests.fixture('workspace_b')::uuid
  ),
  0,
  'member of A cannot select visitor_page_views of B'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Public wrapper RPC privileges (service_role only, except update_visitor_profile)
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.widget_identify_visitor(uuid, text, text, text, text, text, jsonb)',
    'execute'
  ),
  'service_role can execute widget_identify_visitor'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.widget_identify_visitor(uuid, text, text, text, text, text, jsonb)',
    'execute'
  ),
  'authenticated cannot execute widget_identify_visitor'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.widget_identify_visitor(uuid, text, text, text, text, text, jsonb)',
    'execute'
  ),
  'anon cannot execute widget_identify_visitor'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_record_page_view'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'service_role can execute widget_record_page_view'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_record_page_view'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'authenticated cannot execute widget_record_page_view'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_record_page_view'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'anon cannot execute widget_record_page_view'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_create_or_resume_visitor_session'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'service_role can execute widget_create_or_resume_visitor_session'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_create_or_resume_visitor_session'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'authenticated cannot execute widget_create_or_resume_visitor_session'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (
      SELECT p.oid
      FROM pg_proc p
      INNER JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'widget_create_or_resume_visitor_session'
      ORDER BY p.oid DESC
      LIMIT 1
    ),
    'EXECUTE'
  ),
  'anon cannot execute widget_create_or_resume_visitor_session'
);

-- update_visitor_profile: operator-facing only (authenticated); neither
-- service_role nor anon are granted EXECUTE (migration 20260810170000 grants
-- EXECUTE to authenticated only, after revoking the PUBLIC default).
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.update_visitor_profile(uuid, uuid, jsonb)',
    'execute'
  ),
  'authenticated can execute update_visitor_profile'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.update_visitor_profile(uuid, uuid, jsonb)',
    'execute'
  ),
  'service_role cannot execute update_visitor_profile (operator-only RPC)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.update_visitor_profile(uuid, uuid, jsonb)',
    'execute'
  ),
  'anon cannot execute update_visitor_profile'
);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: prosecdef
-- ---------------------------------------------------------------------------

SELECT ok(
  (
    SELECT bool_and(p.prosecdef)
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'widget_create_or_resume_visitor_session',
        'widget_identify_visitor',
        'widget_record_page_view',
        'update_visitor_profile'
      )
  ),
  'public visitor identity RPCs are SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT bool_and(p.prosecdef)
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN (
        'ensure_visitor_contact',
        'widget_create_or_resume_visitor_session',
        'widget_identify_visitor',
        'widget_record_page_view',
        'update_visitor_profile',
        'mint_contact_continuity_token'
      )
  ),
  'app_private visitor identity RPCs are SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- app_private helper privileges: anon/authenticated/service_role all denied.
-- These are internal helpers invoked only from other SECURITY DEFINER
-- functions (owned by postgres); no client role — including service_role —
-- has been granted direct EXECUTE. OID-by-proname lookup avoids signature
-- drift when defaults/params change.
-- ---------------------------------------------------------------------------

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'ensure_visitor_contact'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.ensure_visitor_contact'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'ensure_visitor_contact'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.ensure_visitor_contact'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'ensure_visitor_contact'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.ensure_visitor_contact directly (only via SECURITY DEFINER wrappers)'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_create_or_resume_visitor_session'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.widget_create_or_resume_visitor_session'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_create_or_resume_visitor_session'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.widget_create_or_resume_visitor_session'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_create_or_resume_visitor_session'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.widget_create_or_resume_visitor_session directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_identify_visitor'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.widget_identify_visitor'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_identify_visitor'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.widget_identify_visitor'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_identify_visitor'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.widget_identify_visitor directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_record_page_view'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.widget_record_page_view'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_record_page_view'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.widget_record_page_view'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'widget_record_page_view'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.widget_record_page_view directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'update_visitor_profile'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.update_visitor_profile'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'update_visitor_profile'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.update_visitor_profile'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'update_visitor_profile'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.update_visitor_profile directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'touch_session_open_conversations'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.touch_session_open_conversations'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'touch_session_open_conversations'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.touch_session_open_conversations'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'touch_session_open_conversations'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.touch_session_open_conversations directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'build_conversation_detail'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.build_conversation_detail'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'build_conversation_detail'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.build_conversation_detail'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'build_conversation_detail'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.build_conversation_detail directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'merge_visitor_attributes'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.merge_visitor_attributes'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'merge_visitor_attributes'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.merge_visitor_attributes'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'merge_visitor_attributes'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.merge_visitor_attributes directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'sanitize_page_url'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.sanitize_page_url'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'sanitize_page_url'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.sanitize_page_url'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'sanitize_page_url'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.sanitize_page_url directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'generate_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.generate_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'generate_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.generate_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'generate_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.generate_continuity_token directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'hash_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.hash_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'hash_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.hash_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'hash_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.hash_continuity_token directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'mint_contact_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.mint_contact_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'mint_contact_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.mint_contact_continuity_token'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'mint_contact_continuity_token'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.mint_contact_continuity_token directly'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'visitor_profile_json'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'anon cannot execute app_private.visitor_profile_json'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'visitor_profile_json'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.visitor_profile_json'
);
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app_private' AND p.proname = 'visitor_profile_json'
     ORDER BY p.oid DESC LIMIT 1),
    'EXECUTE'
  ),
  'service_role cannot execute app_private.visitor_profile_json directly'
);

-- ---------------------------------------------------------------------------
-- Page-view dedupe (30s same URL) using the current 11-arg signature
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.widget_record_page_view(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('session_token'),
    'https://example.com/pricing',
    'Pricing',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  );

  v_second := public.widget_record_page_view(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('session_token'),
    'https://example.com/pricing',
    'Pricing again',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  );

  INSERT INTO tests.fixtures (key, value) VALUES
    ('page_view_recorded', v_first ->> 'recorded'),
    ('page_view_deduped', v_second ->> 'deduped');
END;
$$;

SELECT is(
  tests.fixture('page_view_recorded'),
  'true',
  'first page view is recorded'
);

SELECT is(
  tests.fixture('page_view_deduped'),
  'true',
  'second page view within 30s reports deduped=true'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE visitor_session_id = tests.fixture('session_a')::uuid
      AND url = 'https://example.com/pricing'
  ),
  1,
  'page view dedupe keeps a single row for the same URL within 30s'
);

-- ---------------------------------------------------------------------------
-- Page-view tab_id sets active_tab_id; does NOT bump conversation.updated_at
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_session uuid;
  v_conversation uuid;
  v_token text := 'tab-id-session-token';
  v_token_hash text;
  v_updated_before timestamptz;
  v_updated_after timestamptz;
BEGIN
  v_token_hash := encode(extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at, locale)
  VALUES (v_workspace, v_token_hash, now() + interval '1 day', 'en')
  RETURNING id INTO v_session;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, status, next_message_sequence
  )
  VALUES (v_workspace, v_session, 'open', 1)
  RETURNING id INTO v_conversation;

  SELECT updated_at INTO v_updated_before FROM public.conversations WHERE id = v_conversation;

  PERFORM pg_sleep(0.05);

  PERFORM public.widget_record_page_view(
    v_workspace, v_token, 'https://example.com/multi-tab',
    'Multi Tab', NULL, NULL, NULL, NULL, NULL, NULL, 'tab-42'
  );

  SELECT updated_at INTO v_updated_after FROM public.conversations WHERE id = v_conversation;

  INSERT INTO tests.fixtures (key, value) VALUES
    (
      'page_view_active_tab_id',
      (SELECT active_tab_id FROM public.visitor_sessions WHERE id = v_session)
    ),
    (
      'page_view_conversation_untouched',
      (v_updated_before = v_updated_after)::text
    );
END;
$$;

SELECT is(
  tests.fixture('page_view_active_tab_id'),
  'tab-42',
  'page-view with tab_id sets visitor_sessions.active_tab_id'
);

SELECT is(
  tests.fixture('page_view_conversation_untouched'),
  'true',
  'page-view does not bump conversation.updated_at (write amplification fix)'
);

-- ---------------------------------------------------------------------------
-- Cascade: deleting visitor_session deletes page_views
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_session uuid;
  v_pv_count integer;
BEGIN
  INSERT INTO public.visitor_sessions (
    workspace_id,
    session_token_hash,
    expires_at,
    locale
  )
  VALUES (
    v_workspace,
    encode(extensions.digest(convert_to('cascade-session-token', 'UTF8'), 'sha256'), 'hex'),
    now() + interval '1 day',
    'en'
  )
  RETURNING id INTO v_session;

  INSERT INTO public.visitor_page_views (workspace_id, visitor_session_id, url)
  VALUES
    (v_workspace, v_session, 'https://example.com/cascade-1'),
    (v_workspace, v_session, 'https://example.com/cascade-2');

  DELETE FROM public.visitor_sessions WHERE id = v_session;

  SELECT count(*) INTO v_pv_count
  FROM public.visitor_page_views
  WHERE visitor_session_id = v_session;

  INSERT INTO tests.fixtures (key, value)
  VALUES ('cascade_page_view_count', v_pv_count::text);
END;
$$;

SELECT is(
  tests.fixture('cascade_page_view_count'),
  '0',
  'deleting visitor_session cascades to visitor_page_views'
);

-- ---------------------------------------------------------------------------
-- URL privacy redaction (sanitize_page_url)
-- ---------------------------------------------------------------------------

SELECT is(
  app_private.sanitize_page_url(
    'https://example.com/oauth/callback?client_secret=SUPERSECRET&code=abc123'
    || '&utm_source=newsletter&utm_medium=email&session=drop-me#access_token=leaked'
  ),
  'https://example.com/oauth/callback?utm_source=newsletter&utm_medium=email',
  'sanitize_page_url strips OAuth secrets and fragment, keeps allowlisted UTM params'
);

SELECT is(
  app_private.sanitize_page_url('javascript:alert(document.cookie)'),
  NULL,
  'sanitize_page_url rejects javascript: scheme'
);

SELECT is(
  app_private.sanitize_page_url('https://attacker:password@example.com/path?utm_campaign=spring'),
  'https://example.com/path?utm_campaign=spring',
  'sanitize_page_url strips userinfo credentials from the authority'
);

-- ---------------------------------------------------------------------------
-- Operator: update_visitor_profile return shape, no last_seen bump,
-- foreign workspace denial, viewer denial, agent allow
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'visitor-id-viewer-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.update_visitor_profile(%L::uuid, %L::uuid, '{"name":"Nope"}'::jsonb)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'Insufficient permissions',
  'viewer cannot update_visitor_profile'
);

SELECT tests.clear_auth();

SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'visitor-id-owner-b@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.update_visitor_profile(%L::uuid, %L::uuid, '{"name":"Hacked"}'::jsonb)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'Workspace not accessible',
  'foreign workspace operator (not a member) cannot update_visitor_profile'
);

SELECT tests.clear_auth();

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'visitor-id-agent-a@test.local'
);

SELECT is(
  public.update_visitor_profile(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('conversation_a')::uuid,
    '{"name":"Ada Agent"}'::jsonb
  ) ->> 'name',
  'Ada Agent',
  'agent can update_visitor_profile'
);

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_conversation uuid := tests.fixture('conversation_a')::uuid;
  v_contact_id uuid;
  v_last_seen_before timestamptz;
  v_last_seen_after timestamptz;
  v_result jsonb;
BEGIN
  SELECT contact_id INTO v_contact_id FROM public.conversations WHERE id = v_conversation;
  SELECT last_seen_at INTO v_last_seen_before FROM public.contacts WHERE id = v_contact_id;

  PERFORM pg_sleep(0.05);

  v_result := public.update_visitor_profile(
    v_workspace,
    v_conversation,
    '{"email":"ada-agent-edit@test.local","phone":"+15551234567"}'::jsonb
  );

  SELECT last_seen_at INTO v_last_seen_after FROM public.contacts WHERE id = v_contact_id;

  PERFORM tests.clear_auth();

  INSERT INTO tests.fixtures (key, value) VALUES
    ('operator_profile_result', v_result::text),
    ('operator_profile_last_seen_unchanged', (v_last_seen_before = v_last_seen_after)::text);
END;
$$;

SELECT ok(
  (
    SELECT tests.fixture('operator_profile_result')::jsonb ?& ARRAY[
      'public_id', 'name', 'email', 'phone', 'attributes',
      'first_seen_at', 'last_seen_at', 'visit_count'
    ]
  ),
  'update_visitor_profile returns all visitorProfileSchema keys'
);

SELECT ok(
  NOT (tests.fixture('operator_profile_result')::jsonb ? 'phone_e164'),
  'update_visitor_profile return shape omits phone_e164'
);

SELECT is(
  tests.fixture('operator_profile_last_seen_unchanged'),
  'true',
  'operator edit via update_visitor_profile does not bump contact.last_seen_at'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- First visitor send copies session.contact_id onto the conversation
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_session_result jsonb;
  v_session_token text;
  v_session_id uuid;
  v_session_contact uuid;
  v_conversation_contact uuid;
  v_public_id text;
BEGIN
  v_session_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL
  );
  v_session_token := v_session_result ->> 'session_token';

  SELECT id, contact_id
  INTO v_session_id, v_session_contact
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_session_token);

  PERFORM public.widget_send_visitor_message(
    v_workspace,
    v_session_token,
    'link-contact-on-send',
    gen_random_uuid(),
    'https://example.com/send-link',
    NULL
  );

  SELECT contact_id
  INTO v_conversation_contact
  FROM public.conversations
  WHERE visitor_session_id = v_session_id
    AND status IN ('open', 'pending')
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT public_id INTO v_public_id FROM public.contacts WHERE id = v_conversation_contact;

  INSERT INTO tests.fixtures (key, value) VALUES
    (
      'send_links_contact',
      (v_conversation_contact IS NOT NULL AND v_conversation_contact = v_session_contact)::text
    ),
    (
      'send_conversation_public_id',
      COALESCE(v_public_id, '')
    );
END;
$$;

SELECT is(
  tests.fixture('send_links_contact'),
  'true',
  'widget_send_visitor_message copies session.contact_id onto the conversation'
);

SELECT ok(
  tests.fixture('send_conversation_public_id') ~ '^vis_[a-f0-9]{32}$',
  'conversation linked contact exposes durable vis_ public_id for operator detail'
);

-- ---------------------------------------------------------------------------
-- URL privacy: message send + attachment initiate/complete must not persist
-- raw client pageUrl/referrer secrets (access_token, code, hash tokens).
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_a')::uuid;
  v_session_result jsonb;
  v_session_token text;
  v_session_id uuid;
  v_current_url text;
  v_referrer text;
  v_source_url text;
  v_conv_referrer text;
  v_page_view_url text;
  v_ensure jsonb;
  v_conversation_id uuid;
  v_batch_id uuid := gen_random_uuid();
  v_upload_id uuid := gen_random_uuid();
  v_attachment_id uuid := gen_random_uuid();
  v_finalize jsonb;
BEGIN
  -- Fresh session with no prior page context, then send with dirty URLs.
  v_session_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL
  );
  v_session_token := v_session_result ->> 'session_token';

  PERFORM public.widget_send_visitor_message(
    v_workspace,
    v_session_token,
    'url-privacy-send-reset',
    gen_random_uuid(),
    'https://example.com/reset-password?access_token=SECRET&utm_source=test',
    'https://evil.example/login?token=SECRET&utm_medium=email#token=SECRET'
  );

  SELECT id, current_url, referrer
  INTO v_session_id, v_current_url, v_referrer
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_session_token);

  SELECT source_url, referrer
  INTO v_source_url, v_conv_referrer
  FROM public.conversations
  WHERE visitor_session_id = v_session_id
    AND status IN ('open', 'pending')
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('send_reset_current_url', COALESCE(v_current_url, '')),
    ('send_reset_source_url', COALESCE(v_source_url, '')),
    ('send_reset_session_referrer', COALESCE(v_referrer, '')),
    ('send_reset_conv_referrer', COALESCE(v_conv_referrer, ''));

  -- OAuth callback + hash fragment on a second fresh send conversation.
  v_session_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL
  );
  v_session_token := v_session_result ->> 'session_token';

  PERFORM public.widget_send_visitor_message(
    v_workspace,
    v_session_token,
    'url-privacy-send-oauth',
    gen_random_uuid(),
    'https://example.com/oauth/callback?code=SECRET',
    NULL
  );

  SELECT id, current_url
  INTO v_session_id, v_current_url
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_session_token);

  SELECT source_url
  INTO v_source_url
  FROM public.conversations
  WHERE visitor_session_id = v_session_id
  ORDER BY created_at DESC
  LIMIT 1;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('send_oauth_current_url', COALESCE(v_current_url, '')),
    ('send_oauth_source_url', COALESCE(v_source_url, ''));

  PERFORM public.widget_send_visitor_message(
    v_workspace,
    v_session_token,
    'url-privacy-send-hash',
    gen_random_uuid(),
    'https://example.com/path#token=SECRET',
    NULL
  );

  SELECT current_url INTO v_current_url
  FROM public.visitor_sessions
  WHERE id = v_session_id;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('send_hash_current_url', COALESCE(v_current_url, ''));

  -- Prefer page-view context: establish clean current_url, then send dirty.
  v_session_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en',
    'https://example.com/pricing?utm_source=ads',
    NULL
  );
  v_session_token := v_session_result ->> 'session_token';

  PERFORM public.widget_record_page_view(
    v_workspace,
    v_session_token,
    'https://example.com/docs/guide',
    'Guide',
    NULL,
    NULL, NULL, NULL, NULL, NULL,
    'tab-url-privacy'
  );

  SELECT current_url INTO v_page_view_url
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_session_token);

  PERFORM public.widget_send_visitor_message(
    v_workspace,
    v_session_token,
    'url-privacy-no-stale-overwrite',
    gen_random_uuid(),
    'https://example.com/reset-password?access_token=SECRET&utm_source=stale',
    'https://evil.example/?session=SECRET'
  );

  SELECT current_url, referrer
  INTO v_current_url, v_referrer
  FROM public.visitor_sessions
  WHERE session_token_hash = app_private.hash_visitor_session_token(v_session_token);

  INSERT INTO tests.fixtures (key, value) VALUES
    ('send_preserve_page_view_url', COALESCE(v_page_view_url, '')),
    ('send_after_stale_current_url', COALESCE(v_current_url, '')),
    ('send_after_stale_referrer', COALESCE(v_referrer, ''));

  -- Attachment initiate: ensure conversation with dirty URLs.
  v_session_result := public.widget_create_or_resume_visitor_session(
    v_workspace, NULL, 'en', NULL, NULL
  );
  v_session_token := v_session_result ->> 'session_token';

  v_ensure := public.widget_ensure_conversation_for_attachments(
    v_workspace,
    v_session_token,
    'https://example.com/reset-password?access_token=SECRET&utm_source=upload',
    'https://referrer.example/path?code=SECRET&utm_campaign=spring'
  );
  v_conversation_id := (v_ensure ->> 'conversation_id')::uuid;
  v_session_id := (v_ensure ->> 'visitor_session_id')::uuid;

  SELECT current_url, referrer
  INTO v_current_url, v_referrer
  FROM public.visitor_sessions
  WHERE id = v_session_id;

  SELECT source_url, referrer
  INTO v_source_url, v_conv_referrer
  FROM public.conversations
  WHERE id = v_conversation_id;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('attach_ensure_current_url', COALESCE(v_current_url, '')),
    ('attach_ensure_source_url', COALESCE(v_source_url, '')),
    ('attach_ensure_session_referrer', COALESCE(v_referrer, '')),
    ('attach_ensure_conv_referrer', COALESCE(v_conv_referrer, ''));

  -- Attachment complete: finalize with dirty URLs must remain sanitized.
  INSERT INTO public.attachment_uploads (
    id,
    workspace_id,
    conversation_id,
    batch_id,
    attachment_id,
    storage_key,
    filename,
    mime_type,
    size_bytes,
    kind,
    status,
    actor_role,
    visitor_session_id,
    expires_at
  ) VALUES (
    v_upload_id,
    v_workspace,
    v_conversation_id,
    v_batch_id,
    v_attachment_id,
    'workspaces/' || v_workspace::text || '/attachments/' || v_attachment_id::text || '/doc.pdf',
    'doc.pdf',
    'application/pdf',
    1024,
    'document',
    'uploaded',
    'visitor',
    v_session_id,
    now() + interval '30 minutes'
  );

  v_finalize := public.finalize_visitor_attachment_message(
    v_workspace,
    v_session_token,
    v_batch_id,
    ARRAY[v_upload_id],
    'url-privacy-attach-complete',
    gen_random_uuid(),
    'https://example.com/oauth/callback?code=SECRET&utm_source=complete',
    'https://evil.example/#token=SECRET',
    jsonb_build_array(
      jsonb_build_object(
        'id', v_attachment_id,
        'storage_key', 'workspaces/' || v_workspace::text || '/attachments/' || v_attachment_id::text || '/doc.pdf',
        'thumbnail_storage_key', NULL,
        'mime_type', 'application/pdf',
        'filename', 'doc.pdf',
        'size_bytes', 1024,
        'kind', 'document',
        'width', NULL,
        'height', NULL,
        'duration_ms', NULL,
        'scan_status', 'skipped',
        'sort_order', 0,
        'metadata_json', '{}'::jsonb
      )
    )
  );

  SELECT current_url, referrer
  INTO v_current_url, v_referrer
  FROM public.visitor_sessions
  WHERE id = v_session_id;

  SELECT source_url
  INTO v_source_url
  FROM public.conversations
  WHERE id = v_conversation_id;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('attach_complete_current_url', COALESCE(v_current_url, '')),
    ('attach_complete_source_url', COALESCE(v_source_url, '')),
    ('attach_complete_message_id', COALESCE(v_finalize -> 'message' ->> 'id', ''));
END;
$$;

SELECT is(
  tests.fixture('send_reset_current_url'),
  'https://example.com/reset-password?utm_source=test',
  'send sanitizes reset-password current_url (keeps UTM, drops access_token)'
);

SELECT is(
  tests.fixture('send_reset_source_url'),
  'https://example.com/reset-password?utm_source=test',
  'send sanitizes conversation source_url from dirty pageUrl'
);

SELECT is(
  tests.fixture('send_reset_session_referrer'),
  'https://evil.example/login?utm_medium=email',
  'send sanitizes session referrer (drops token + hash)'
);

SELECT is(
  tests.fixture('send_reset_conv_referrer'),
  'https://evil.example/login?utm_medium=email',
  'send sanitizes conversation referrer'
);

SELECT ok(
  position('SECRET' in tests.fixture('send_reset_current_url')
    || tests.fixture('send_reset_source_url')
    || tests.fixture('send_reset_session_referrer')
    || tests.fixture('send_reset_conv_referrer')) = 0
  AND position('access_token' in tests.fixture('send_reset_current_url')
    || tests.fixture('send_reset_source_url')) = 0,
  'send persisted URLs never contain SECRET or access_token'
);

SELECT is(
  tests.fixture('send_oauth_current_url'),
  'https://example.com/oauth/callback',
  'send sanitizes oauth callback current_url (drops code)'
);

SELECT is(
  tests.fixture('send_oauth_source_url'),
  'https://example.com/oauth/callback',
  'send sanitizes oauth callback source_url'
);

SELECT is(
  tests.fixture('send_hash_current_url'),
  'https://example.com/oauth/callback',
  'send with hash-only dirty URL does not overwrite existing sanitized current_url'
);

SELECT is(
  tests.fixture('send_after_stale_current_url'),
  tests.fixture('send_preserve_page_view_url'),
  'send does not overwrite newer page-view current_url with stale client pageUrl'
);

SELECT ok(
  position('SECRET' in tests.fixture('send_after_stale_current_url')
    || COALESCE(tests.fixture('send_after_stale_referrer'), '')) = 0,
  'stale send path leaves no SECRET in session URL fields'
);

SELECT is(
  tests.fixture('attach_ensure_current_url'),
  'https://example.com/reset-password?utm_source=upload',
  'attachment initiate sanitizes session current_url'
);

SELECT is(
  tests.fixture('attach_ensure_source_url'),
  'https://example.com/reset-password?utm_source=upload',
  'attachment initiate sanitizes conversation source_url'
);

SELECT is(
  tests.fixture('attach_ensure_session_referrer'),
  'https://referrer.example/path?utm_campaign=spring',
  'attachment initiate sanitizes session referrer'
);

SELECT is(
  tests.fixture('attach_ensure_conv_referrer'),
  'https://referrer.example/path?utm_campaign=spring',
  'attachment initiate sanitizes conversation referrer'
);

SELECT is(
  tests.fixture('attach_complete_current_url'),
  'https://example.com/reset-password?utm_source=upload',
  'attachment complete does not overwrite existing sanitized current_url with dirty complete pageUrl'
);

SELECT ok(
  position('SECRET' in tests.fixture('attach_complete_current_url')
    || tests.fixture('attach_complete_source_url')) = 0
  AND position('code=' in tests.fixture('attach_complete_current_url')
    || tests.fixture('attach_complete_source_url')) = 0
  AND tests.fixture('attach_complete_message_id') ~ '^[0-9a-f-]{36}$',
  'attachment complete persists no SECRET/code and creates a message'
);

SELECT * FROM finish();

ROLLBACK;
