\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

CREATE TEMP TABLE realtime_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

DO $$
DECLARE
  v_owner uuid;
  v_workspace uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_topic_a text;
  v_topic_b text;
BEGIN
  v_owner := tests.create_auth_user('realtime-owner@test.local');
  PERFORM tests.authenticate_as(v_owner, 'realtime-owner@test.local');
  v_workspace := (public.create_workspace('Realtime Workspace', 'realtime-workspace')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace,
    encode(extensions.digest('realtime-session-a', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace,
    encode(extensions.digest('realtime-session-b', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_b;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace,
    v_session_a,
    'open',
    1,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id, visitor_realtime_topic_key
  INTO v_conversation_a, v_topic_a;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace,
    v_session_b,
    'open',
    1,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id, visitor_realtime_topic_key
  INTO v_conversation_b, v_topic_b;

  INSERT INTO realtime_fixtures (key, value) VALUES
    ('workspace_id', v_workspace::text),
    ('conversation_a', v_conversation_a::text),
    ('conversation_b', v_conversation_b::text),
    ('topic_a', v_topic_a),
    ('topic_b', v_topic_b),
    ('session_token_a', 'realtime-session-a');
END;
$$;

-- T1 publication includes messages
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ),
  'messages table is in supabase_realtime publication'
);

-- T2 publication includes conversations
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversations'
  ),
  'conversations table is in supabase_realtime publication'
);

-- T3 topic key format
SELECT matches(
  (SELECT visitor_realtime_topic_key FROM public.conversations LIMIT 1),
  '^[a-f0-9]{64}$',
  'visitor_realtime_topic_key uses 64-char hex format'
);

-- T4 resolve realtime topic for active session
SELECT is(
  app_private.widget_resolve_realtime_topic(
    (SELECT value::uuid FROM realtime_fixtures WHERE key = 'workspace_id'),
    (SELECT value FROM realtime_fixtures WHERE key = 'session_token_a')
  ) ->> 'topic',
  'widget-conversation:' || (SELECT value FROM realtime_fixtures WHERE key = 'topic_a'),
  'widget_resolve_realtime_topic returns private topic'
);

-- T5 internal message does not broadcast
DO $$
DECLARE
  v_workspace uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'workspace_id');
  v_conversation uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'conversation_a');
  v_topic text := 'widget-conversation:' || (SELECT value FROM realtime_fixtures WHERE key = 'topic_a');
  v_before integer;
  v_after integer;
BEGIN
  SELECT count(*) INTO v_before
  FROM realtime.messages
  WHERE topic = v_topic;

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
    v_workspace,
    v_conversation,
    1,
    'agent',
    wm.id,
    'Internal note',
    true
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace
  LIMIT 1;

  SELECT count(*) INTO v_after
  FROM realtime.messages
  WHERE topic = v_topic;

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'Internal message emitted broadcast';
  END IF;
END;
$$;

SELECT pass('internal messages do not emit visitor broadcast');

-- T6 visitor-visible message broadcasts sanitized payload
DO $$
DECLARE
  v_workspace uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'workspace_id');
  v_conversation uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'conversation_a');
  v_topic text := 'widget-conversation:' || (SELECT value FROM realtime_fixtures WHERE key = 'topic_a');
  v_payload jsonb;
BEGIN
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
    v_workspace,
    v_conversation,
    2,
    'agent',
    wm.id,
    'Hello visitor',
    false
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace
  LIMIT 1;

  SELECT payload INTO v_payload
  FROM realtime.messages
  WHERE topic = v_topic
  ORDER BY inserted_at DESC
  LIMIT 1;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Expected broadcast payload';
  END IF;

  IF v_payload ->> 'type' <> 'message.created' THEN
    RAISE EXCEPTION 'Unexpected broadcast type';
  END IF;

  IF v_payload -> 'message' ? 'workspace_id'
     OR v_payload -> 'message' ? 'conversation_id'
     OR v_payload -> 'message' ? 'agent_member_id'
     OR v_payload -> 'message' ? 'is_internal' THEN
    RAISE EXCEPTION 'Broadcast payload leaked sensitive fields';
  END IF;
END;
$$;

SELECT pass('visitor-visible messages emit sanitized broadcast payload');

-- T7 widget_realtime cannot select product tables
SELECT throws_ok(
  $$
    SET LOCAL role widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:test"}';
    SELECT count(*) FROM public.messages;
  $$,
  '42501',
  NULL,
  'widget_realtime cannot select messages'
);

-- T8 widget_realtime cannot execute operator RPC
SELECT throws_ok(
  $$
    SET LOCAL role widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:test"}';
    SELECT public.list_conversations('00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb);
  $$,
  '42501',
  NULL,
  'widget_realtime cannot execute list_conversations'
);

-- T9 widget_realtime cannot execute widget RPC wrappers
SELECT throws_ok(
  $$
    SET LOCAL role widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:test"}';
    SELECT public.widget_send_visitor_message(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'token',
      'hello',
      NULL,
      NULL,
      NULL
    );
  $$,
  '42501',
  NULL,
  'widget_realtime cannot execute widget_send_visitor_message'
);

RESET role;

-- T10 after_sequence operator catch-up
DO $$
DECLARE
  v_workspace uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'workspace_id');
  v_conversation uuid := (SELECT value::uuid FROM realtime_fixtures WHERE key = 'conversation_a');
  v_owner uuid := tests.create_auth_user('realtime-agent@test.local');
  v_result jsonb;
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace, v_owner, 'agent', 'active');

  PERFORM tests.authenticate_as(v_owner, 'realtime-agent@test.local');

  v_result := public.list_messages(
    v_workspace,
    v_conversation,
    jsonb_build_object('after_sequence', 1, 'limit', 50)
  );

  IF jsonb_array_length(v_result -> 'items') < 1 THEN
    RAISE EXCEPTION 'after_sequence catch-up returned no items';
  END IF;
END;
$$;

SELECT pass('list_messages after_sequence returns newer messages');

-- T11 after_sequence widget catch-up
SELECT ok(
  jsonb_array_length(
    public.widget_list_visitor_messages(
      (SELECT value::uuid FROM realtime_fixtures WHERE key = 'workspace_id'),
      (SELECT value FROM realtime_fixtures WHERE key = 'session_token_a'),
      50,
      NULL,
      1
    ) -> 'items'
  ) >= 1,
  'widget_list_visitor_messages after_sequence returns newer messages'
);

-- T12 widget_realtime policy allows exact topic only
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_receive_own_broadcast'
  ),
  'widget_realtime realtime.messages policy exists'
);

-- T13 widget_realtime JWT cannot read another topic broadcast
DO $$
DECLARE
  v_count integer;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}',
    true
  );
  SET LOCAL ROLE widget_realtime;

  SELECT count(*)
  INTO v_count
  FROM realtime.messages
  WHERE topic = 'widget-conversation:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'widget_realtime JWT read another topic broadcast';
  END IF;
END;
$$;

SELECT pass('widget_realtime JWT cannot read broadcasts for a different topic');

RESET role;

-- T14 authenticated cannot execute new app_private topic helpers
SELECT throws_ok(
  $$
    SET LOCAL role authenticated;
    SELECT app_private.generate_visitor_realtime_topic_key();
  $$,
  '42501',
  NULL,
  'authenticated cannot execute generate_visitor_realtime_topic_key'
);

SELECT throws_ok(
  $$
    SET LOCAL role authenticated;
    SELECT app_private.widget_resolve_realtime_topic(
      '00000000-0000-4000-8000-000000000001'::uuid,
      'token'
    );
  $$,
  '42501',
  NULL,
  'authenticated cannot execute widget_resolve_realtime_topic'
);

-- T15 authenticated cannot execute broadcast trigger function
SELECT throws_ok(
  $$
    SET LOCAL role authenticated;
    SELECT app_private.broadcast_visitor_safe_message();
  $$,
  '42501',
  NULL,
  'authenticated cannot execute broadcast_visitor_safe_message'
);

SELECT finish();

ROLLBACK;
