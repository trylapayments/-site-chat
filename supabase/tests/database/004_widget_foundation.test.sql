\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(32);

CREATE TEMP TABLE widget_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_owner_b uuid;
  v_agent_a uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_public_key_a text;
  v_public_key_b text;
  v_session_token text;
  v_session_token_hash text;
  v_session_id uuid;
  v_client_message_id uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_result jsonb;
BEGIN
  v_owner_a := tests.create_auth_user('widget-owner-a@test.local');
  v_owner_b := tests.create_auth_user('widget-owner-b@test.local');
  v_agent_a := tests.create_auth_user('widget-agent-a@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'widget-owner-a@test.local');
  v_workspace_a := (public.create_workspace('Widget A', 'widget-workspace-a')->>'workspace_id')::uuid;
  SELECT widget_public_key INTO v_public_key_a FROM public.workspaces WHERE id = v_workspace_a;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'widget-owner-b@test.local');
  v_workspace_b := (public.create_workspace('Widget B', 'widget-workspace-b')->>'workspace_id')::uuid;
  SELECT widget_public_key INTO v_public_key_b FROM public.workspaces WHERE id = v_workspace_b;
  PERFORM tests.clear_auth();

  INSERT INTO public.allowed_domains (workspace_id, domain, verified)
  VALUES (v_workspace_a, 'example.com', true);

  INSERT INTO public.allowed_domains (workspace_id, domain, verified)
  VALUES (v_workspace_a, '*.example.com', true);

  INSERT INTO public.allowed_domains (workspace_id, domain, verified)
  VALUES (v_workspace_b, 'other.com', true);

  INSERT INTO widget_fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('public_key_a', v_public_key_a),
    ('public_key_b', v_public_key_b),
    ('client_message_id', v_client_message_id::text);

  v_session_token := replace(
    replace(
      replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'),
      '/',
      '_'
    ),
    '=',
    ''
  );
  v_session_token_hash := encode(extensions.digest(convert_to(v_session_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at, locale)
  VALUES (v_workspace_a, v_session_token_hash, now() + interval '1 day', 'en')
  RETURNING id INTO v_session_id;

  INSERT INTO widget_fixtures (key, value) VALUES
    ('session_token_a', v_session_token),
    ('session_id_a', v_session_id::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------

SELECT has_column('public', 'workspaces', 'widget_public_key', 'workspaces.widget_public_key exists');
SELECT has_column('public', 'workspaces', 'settings_json', 'workspaces.settings_json exists');
SELECT has_table('public', 'allowed_domains', 'allowed_domains table exists');
SELECT has_index('public', 'visitor_sessions', 'idx_visitor_sessions_token_hash', 'session token hash index exists');
SELECT has_index(
  'public',
  'conversations',
  'uq_conversations_one_open_pending_per_session',
  'partial unique open/pending index exists'
);

-- ---------------------------------------------------------------------------
-- Domain matching
-- ---------------------------------------------------------------------------

SELECT is(
  app_private.domain_matches_pattern('sub.example.com', '*.example.com'),
  true,
  '*.example.com matches subdomain'
);

SELECT is(
  app_private.domain_matches_pattern('example.com', '*.example.com'),
  false,
  '*.example.com does not match apex'
);

SELECT is(
  app_private.domain_matches_pattern('evil-example.com', '*.example.com'),
  false,
  '*.example.com does not match evil-example.com'
);

SELECT is(
  public.widget_validate_origin(
    (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
    'https://shop.example.com',
    true
  ),
  true,
  'verified allowed domain passes'
);

SELECT is(
  public.widget_validate_origin(
    (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
    'https://blocked.com',
    true
  ),
  false,
  'unlisted domain fails'
);

-- ---------------------------------------------------------------------------
-- Public key resolution
-- ---------------------------------------------------------------------------

SELECT isnt(
  public.widget_resolve_public_key((SELECT value FROM widget_fixtures WHERE key = 'public_key_a')),
  NULL,
  'public key resolves workspace config'
);

SELECT is(
  public.widget_resolve_public_key('wk_invalid000000000000000000000000'),
  NULL,
  'invalid public key returns null'
);

-- ---------------------------------------------------------------------------
-- Session create / resume (service_role context via postgres)
-- ---------------------------------------------------------------------------

SELECT isnt(
  public.widget_create_or_resume_visitor_session(
    (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
    NULL,
    'en',
    'https://example.com/page',
    'https://google.com'
  ) ->> 'session_token',
  NULL,
  'creates new visitor session token'
);

SELECT is(
  public.widget_create_or_resume_visitor_session(
    (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
    (SELECT value FROM widget_fixtures WHERE key = 'session_token_a'),
    'ru',
    NULL,
    NULL
  ) ->> 'locale',
  'ru',
  'resumes existing session and updates locale'
);

-- ---------------------------------------------------------------------------
-- Send message + idempotency
-- ---------------------------------------------------------------------------

SELECT is(
  (
    public.widget_send_visitor_message(
      (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
      (SELECT value FROM widget_fixtures WHERE key = 'session_token_a'),
      'Hello from widget',
      (SELECT value::uuid FROM widget_fixtures WHERE key = 'client_message_id'),
      'https://example.com/pricing',
      NULL
    ) -> 'message' ->> 'body'
  ),
  'Hello from widget',
  'send_visitor_message stores visitor message'
);

SELECT is(
  (
    public.widget_send_visitor_message(
      (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
      (SELECT value FROM widget_fixtures WHERE key = 'session_token_a'),
      'Hello from widget',
      (SELECT value::uuid FROM widget_fixtures WHERE key = 'client_message_id'),
      NULL,
      NULL
    ) -> 'message' ->> 'body'
  ),
  'Hello from widget',
  'client_message_id is idempotent'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.messages m
    INNER JOIN public.conversations c ON c.id = m.conversation_id
    WHERE c.visitor_session_id = (SELECT value::uuid FROM widget_fixtures WHERE key = 'session_id_a')
      AND m.client_message_id = (SELECT value::uuid FROM widget_fixtures WHERE key = 'client_message_id')
  ),
  1,
  'idempotent send creates one message row'
);

-- ---------------------------------------------------------------------------
-- List messages excludes internal
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace_a uuid := (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a');
  v_session_token text := (SELECT value FROM widget_fixtures WHERE key = 'session_token_a');
  v_conversation_id uuid;
BEGIN
  SELECT c.id
  INTO v_conversation_id
  FROM public.conversations c
  WHERE c.visitor_session_id = (SELECT value::uuid FROM widget_fixtures WHERE key = 'session_id_a')
  LIMIT 1;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    agent_member_id,
    body,
    is_internal
  )
  SELECT
    v_workspace_a,
    v_conversation_id,
    c.next_message_sequence,
    'agent',
    wm.id,
    'Internal note',
    true
  FROM public.conversations c
  INNER JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id AND wm.role = 'owner'
  WHERE c.id = v_conversation_id
  LIMIT 1;
END;
$$;

SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.widget_list_visitor_messages(
        (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a'),
        (SELECT value FROM widget_fixtures WHERE key = 'session_token_a'),
        50,
        NULL
      ) -> 'items'
    ) elem
    WHERE elem ->> 'body' = 'Internal note'
  ),
  0,
  'internal messages are not returned to visitors'
);

-- ---------------------------------------------------------------------------
-- Cross-workspace isolation
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    SELECT public.widget_send_visitor_message(
      (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_b'),
      (SELECT value FROM widget_fixtures WHERE key = 'session_token_a'),
      'Cross workspace attempt',
      NULL,
      NULL,
      NULL
    )
  $$,
  'Session invalid or expired',
  'session token cannot send in another workspace'
);

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

SELECT is(
  public.widget_consume_rate_limit('test-bucket', 60, 2),
  true,
  'rate limit first request allowed'
);

SELECT is(
  public.widget_consume_rate_limit('test-bucket', 60, 2),
  true,
  'rate limit second request allowed'
);

SELECT is(
  public.widget_consume_rate_limit('test-bucket', 60, 2),
  false,
  'rate limit third request blocked in fixed window'
);

-- ---------------------------------------------------------------------------
-- Closed conversation creates new on send
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_workspace_a uuid := (SELECT value::uuid FROM widget_fixtures WHERE key = 'workspace_a');
  v_session_token text;
  v_session_id uuid;
  v_token_hash text;
  v_conv_id uuid;
BEGIN
  v_session_token := replace(
    replace(
      replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'),
      '/',
      '_'
    ),
    '=',
    ''
  );
  v_token_hash := encode(extensions.digest(convert_to(v_session_token, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at, locale)
  VALUES (v_workspace_a, v_token_hash, now() + interval '1 day', 'en')
  RETURNING id INTO v_session_id;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, status, channel_type, next_message_sequence
  )
  VALUES (v_workspace_a, v_session_id, 'closed', 'widget', 1)
  RETURNING id INTO v_conv_id;

  PERFORM public.widget_send_visitor_message(
    v_workspace_a,
    v_session_token,
    'New thread after closed',
    NULL,
    NULL,
    NULL
  );

  INSERT INTO widget_fixtures (key, value)
  SELECT 'closed_session_conv_count', count(*)::text
  FROM public.conversations
  WHERE visitor_session_id = v_session_id;
END;
$$;

SELECT is(
  (SELECT value::integer FROM widget_fixtures WHERE key = 'closed_session_conv_count'),
  2,
  'closed conversation triggers new conversation on send'
);

-- ---------------------------------------------------------------------------
-- Grants: authenticated cannot execute widget RPCs
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    SET LOCAL role authenticated;
    SELECT public.widget_send_visitor_message(
      gen_random_uuid(),
      'fake',
      'nope',
      NULL,
      NULL,
      NULL
    );
  $$,
  '42501',
  NULL,
  'authenticated role cannot execute widget_send_visitor_message'
);

SELECT throws_ok(
  $$
    SET LOCAL role anon;
    INSERT INTO public.messages (workspace_id, conversation_id, sequence_number, sender_type, body)
    VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'visitor', 'blocked');
  $$,
  '42501',
  NULL,
  'anon cannot insert messages directly'
);

SELECT * FROM finish();

ROLLBACK;
