\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Schema(9) + page_views privileges(3) + RLS select/cross-tenant(3)
-- + widget RPC privileges(9) + update_visitor_profile privileges(2)
-- + SECURITY DEFINER prosecdef/privilege(6) + public_id format(1)
-- + page-view record + dedupe flag + count(3) + cascade(1)
-- + viewer deny / agent allow(2) = 39
SELECT plan(39);

TRUNCATE tests.fixtures;

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
-- Schema
-- ---------------------------------------------------------------------------

SELECT has_column('public', 'contacts', 'public_id', 'contacts.public_id exists');
SELECT has_column('public', 'contacts', 'visit_count', 'contacts.visit_count exists');
SELECT has_column('public', 'contacts', 'phone_e164', 'contacts.phone_e164 exists');
SELECT has_table('public', 'visitor_page_views', 'visitor_page_views table exists');
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
  (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a'),
  (SELECT value::uuid FROM tests.fixtures WHERE key = 'session_a'),
  'https://example.com/rls-seed',
  'RLS seed'
);

SELECT tests.authenticate_as(
  (SELECT value::uuid FROM tests.fixtures WHERE key = 'owner_a'),
  'visitor-id-owner-a@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE workspace_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a')
  ),
  1,
  'workspace A member can select own visitor_page_views'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.contacts
    WHERE workspace_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_b')
  ),
  0,
  'member of A cannot select contacts of B'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE workspace_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_b')
  ),
  0,
  'member of A cannot select visitor_page_views of B'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Widget RPC privileges (service_role only)
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
    'public.widget_record_page_view(uuid, text, text, text, text, text, text, text, text, text)',
    'execute'
  ),
  'service_role can execute widget_record_page_view'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.widget_record_page_view(uuid, text, text, text, text, text, text, text, text, text)',
    'execute'
  ),
  'authenticated cannot execute widget_record_page_view'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.widget_record_page_view(uuid, text, text, text, text, text, text, text, text, text)',
    'execute'
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

-- ---------------------------------------------------------------------------
-- update_visitor_profile privileges
-- ---------------------------------------------------------------------------

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
    'anon',
    'public.update_visitor_profile(uuid, uuid, jsonb)',
    'execute'
  ),
  'anon cannot execute update_visitor_profile'
);

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: prosecdef + app_private not executable by client roles
-- ---------------------------------------------------------------------------

SELECT ok(
  (
    SELECT bool_and(p.prosecdef)
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
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
        'widget_identify_visitor',
        'widget_record_page_view',
        'update_visitor_profile'
      )
  ),
  'app_private visitor identity RPCs are SECURITY DEFINER'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.ensure_visitor_contact(uuid, text, boolean)',
    'execute'
  ),
  'authenticated cannot execute app_private.ensure_visitor_contact'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.ensure_visitor_contact(uuid, text, boolean)',
    'execute'
  ),
  'anon cannot execute app_private.ensure_visitor_contact'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.widget_identify_visitor(uuid, text, text, text, text, text, jsonb)',
    'execute'
  ),
  'authenticated cannot execute app_private.widget_identify_visitor'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.widget_identify_visitor(uuid, text, text, text, text, text, jsonb)',
    'execute'
  ),
  'anon cannot execute app_private.widget_identify_visitor'
);

-- ---------------------------------------------------------------------------
-- ensure_visitor_contact public_id format
-- ---------------------------------------------------------------------------

SELECT matches(
  (
    app_private.ensure_visitor_contact(
      (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a'),
      NULL,
      false
    )
  ).public_id,
  '^vis_[a-f0-9]{32}$',
  'ensure_visitor_contact creates vis_ + 32 hex public_id'
);

-- ---------------------------------------------------------------------------
-- Page-view dedupe (30s same URL)
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_first jsonb;
  v_second jsonb;
BEGIN
  v_first := public.widget_record_page_view(
    (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a'),
    (SELECT value FROM tests.fixtures WHERE key = 'session_token'),
    'https://example.com/pricing',
    'Pricing',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  );

  v_second := public.widget_record_page_view(
    (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a'),
    (SELECT value FROM tests.fixtures WHERE key = 'session_token'),
    'https://example.com/pricing',
    'Pricing again',
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
  (SELECT value FROM tests.fixtures WHERE key = 'page_view_recorded'),
  'true',
  'first page view is recorded'
);

SELECT is(
  (SELECT value FROM tests.fixtures WHERE key = 'page_view_deduped'),
  'true',
  'second page view within 30s reports deduped=true'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.visitor_page_views
    WHERE visitor_session_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'session_a')
      AND url = 'https://example.com/pricing'
  ),
  1,
  'page view dedupe keeps a single row for the same URL within 30s'
);

-- ---------------------------------------------------------------------------
-- Cascade: deleting visitor_session deletes page_views
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace uuid := (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a');
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
  (SELECT value FROM tests.fixtures WHERE key = 'cascade_page_view_count'),
  '0',
  'deleting visitor_session cascades to visitor_page_views'
);

-- ---------------------------------------------------------------------------
-- Operator role: viewer denied, agent allowed
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  (SELECT value::uuid FROM tests.fixtures WHERE key = 'viewer_a'),
  'visitor-id-viewer-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.update_visitor_profile(%L::uuid, %L::uuid, '{"name":"Nope"}'::jsonb)$q$,
    (SELECT value FROM tests.fixtures WHERE key = 'workspace_a'),
    (SELECT value FROM tests.fixtures WHERE key = 'conversation_a')
  ),
  'Insufficient permissions',
  'viewer cannot update_visitor_profile'
);

SELECT tests.clear_auth();

SELECT tests.authenticate_as(
  (SELECT value::uuid FROM tests.fixtures WHERE key = 'agent_a'),
  'visitor-id-agent-a@test.local'
);

SELECT is(
  public.update_visitor_profile(
    (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_a'),
    (SELECT value::uuid FROM tests.fixtures WHERE key = 'conversation_a'),
    '{"name":"Ada Agent"}'::jsonb
  ) ->> 'name',
  'Ada Agent',
  'agent can update_visitor_profile'
);

SELECT tests.clear_auth();

SELECT * FROM finish();

ROLLBACK;
