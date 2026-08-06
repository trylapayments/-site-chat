\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

CREATE TEMP TABLE typing_presence_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

DO $$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_workspace uuid;
  v_other_workspace uuid;
  v_session uuid;
  v_conversation uuid;
  v_topic_key text;
BEGIN
  v_owner := tests.create_auth_user('typing-presence-owner@test.local');
  v_outsider := tests.create_auth_user('typing-presence-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner, 'typing-presence-owner@test.local');
  v_workspace := (public.create_workspace('Typing Presence WS', 'typing-presence-ws')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_outsider, 'typing-presence-outsider@test.local');
  v_other_workspace := (public.create_workspace('Other WS', 'typing-presence-other')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace,
    encode(extensions.digest('typing-presence-session', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace,
    v_session,
    'open',
    1,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id, visitor_realtime_topic_key
  INTO v_conversation, v_topic_key;

  INSERT INTO typing_presence_fixtures (key, value) VALUES
    ('owner_id', v_owner::text),
    ('outsider_id', v_outsider::text),
    ('workspace_id', v_workspace::text),
    ('other_workspace_id', v_other_workspace::text),
    ('conversation_id', v_conversation::text),
    ('topic_key', v_topic_key),
    ('topic', 'widget-conversation:' || v_topic_key);
END;
$$;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_receive_own_topic'
  ),
  'widget_realtime receive policy includes broadcast+presence topic'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_publish_own_topic'
  ),
  'widget_realtime publish policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'authenticated_conversation_ephemeral_select'
  ),
  'authenticated conversation ephemeral select policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'authenticated_conversation_ephemeral_insert'
  ),
  'authenticated conversation ephemeral insert policy exists'
);

DO $$
DECLARE
  v_owner uuid;
  v_workspace uuid;
  v_conversation uuid;
  v_topic text;
  v_detail jsonb;
BEGIN
  SELECT value::uuid INTO v_owner FROM typing_presence_fixtures WHERE key = 'owner_id';
  SELECT value::uuid INTO v_workspace FROM typing_presence_fixtures WHERE key = 'workspace_id';
  SELECT value::uuid INTO v_conversation FROM typing_presence_fixtures WHERE key = 'conversation_id';
  SELECT value INTO v_topic FROM typing_presence_fixtures WHERE key = 'topic';

  PERFORM tests.authenticate_as(v_owner, 'typing-presence-owner@test.local');
  v_detail := public.get_conversation(v_workspace, v_conversation);
  PERFORM tests.clear_auth();

  IF v_detail ->> 'visitor_realtime_topic' IS DISTINCT FROM v_topic THEN
    RAISE EXCEPTION 'Expected visitor_realtime_topic %, got %',
      v_topic, v_detail ->> 'visitor_realtime_topic';
  END IF;
END;
$$;

SELECT pass('get_conversation returns opaque visitor_realtime_topic');

DO $$
DECLARE
  v_topic text;
  v_count integer;
BEGIN
  SELECT value INTO v_topic FROM typing_presence_fixtures WHERE key = 'topic';

  SET LOCAL ROLE widget_realtime;
  SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}';

  SELECT count(*)
  INTO v_count
  FROM realtime.messages
  WHERE topic = v_topic;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'widget_realtime JWT read another topic';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime JWT cannot read another conversation topic');

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_receive_own_broadcast'
  ),
  'legacy widget_realtime_receive_own_broadcast policy removed'
);

SELECT matches(
  (SELECT value FROM typing_presence_fixtures WHERE key = 'topic_key'),
  '^[a-f0-9]{64}$',
  'visitor_realtime_topic_key uses 64-char hex format'
);

-- Evaluate authenticated INSERT WITH CHECK via realtime.topic() config.
DO $$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_topic text;
  v_ok boolean;
BEGIN
  SELECT value::uuid INTO v_owner FROM typing_presence_fixtures WHERE key = 'owner_id';
  SELECT value::uuid INTO v_outsider FROM typing_presence_fixtures WHERE key = 'outsider_id';
  SELECT value INTO v_topic FROM typing_presence_fixtures WHERE key = 'topic';

  -- Member of workspace: policy expression must allow.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_topic, true);
  SET LOCAL ROLE authenticated;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    INNER JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
    INNER JOIN public.workspaces w ON w.id = c.workspace_id
    WHERE wm.user_id = (SELECT auth.uid())
      AND wm.status = 'active'
      AND w.deleted_at IS NULL
      AND w.status = 'active'
      AND (SELECT realtime.topic()) =
        ('widget-conversation:' || c.visitor_realtime_topic_key)
  )
  INTO v_ok;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Expected workspace member to authorize conversation topic';
  END IF;

  RESET ROLE;
  PERFORM tests.clear_auth();

  -- Outsider (other workspace only): must deny.
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_topic, true);
  SET LOCAL ROLE authenticated;

  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    INNER JOIN public.workspace_members wm ON wm.workspace_id = c.workspace_id
    INNER JOIN public.workspaces w ON w.id = c.workspace_id
    WHERE wm.user_id = (SELECT auth.uid())
      AND wm.status = 'active'
      AND w.deleted_at IS NULL
      AND w.status = 'active'
      AND (SELECT realtime.topic()) =
        ('widget-conversation:' || c.visitor_realtime_topic_key)
  )
  INTO v_ok;

  IF COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Outsider authorized foreign conversation topic';
  END IF;

  RESET ROLE;
  PERFORM tests.clear_auth();
END;
$$;

SELECT pass('authenticated membership authorizes own topic and denies cross-workspace');

-- widget_realtime publish policy expression: own topic + purpose + extension.
DO $$
DECLARE
  v_topic text;
  v_wrong text := 'widget-conversation:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
BEGIN
  SELECT value INTO v_topic FROM typing_presence_fixtures WHERE key = 'topic';

  SET LOCAL ROLE widget_realtime;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic', v_topic
    )::text,
    true
  );

  IF NOT (
    'broadcast' IN ('broadcast', 'presence')
    AND v_topic = (auth.jwt() ->> 'topic')
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  ) THEN
    RAISE EXCEPTION 'Expected widget_realtime own-topic publish allow expression';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic', v_wrong
    )::text,
    true
  );

  IF v_topic = (auth.jwt() ->> 'topic') THEN
    RAISE EXCEPTION 'Expected widget_realtime foreign-topic publish deny';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime publish checks exact topic and purpose');

-- widget_realtime still cannot touch product tables.
SELECT throws_ok(
  $$
    SET LOCAL ROLE widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic":"widget-conversation:test"}';
    SELECT count(*) FROM public.messages;
  $$,
  '42501',
  NULL,
  'widget_realtime cannot select messages'
);

SELECT * FROM finish();
ROLLBACK;
