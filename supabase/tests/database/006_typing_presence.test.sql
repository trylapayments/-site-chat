\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(17);

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
    ('message_topic', 'widget-conversation:' || v_topic_key),
    ('ephemeral_topic', 'widget-ephemeral:' || v_topic_key),
    ('foreign_ephemeral', 'widget-ephemeral:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc');
END;
$$;

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_receive_message_topic'
  ),
  'widget_realtime receive message-topic policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_receive_ephemeral_topic'
  ),
  'widget_realtime receive ephemeral-topic policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_publish_ephemeral_topic'
  ),
  'widget_realtime publish ephemeral-topic policy exists'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'widget_realtime_publish_own_topic'
  ),
  'legacy single-topic widget_realtime publish policy removed'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname = 'authenticated_conversation_message_select'
  ),
  'authenticated conversation message select policy exists'
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

SELECT matches(
  (SELECT value FROM typing_presence_fixtures WHERE key = 'topic_key'),
  '^[a-f0-9]{64}$',
  'visitor_realtime_topic_key uses 64-char hex format'
);

DO $$
DECLARE
  v_owner uuid;
  v_workspace uuid;
  v_conversation uuid;
  v_message_topic text;
  v_ephemeral_topic text;
  v_detail jsonb;
BEGIN
  SELECT value::uuid INTO v_owner FROM typing_presence_fixtures WHERE key = 'owner_id';
  SELECT value::uuid INTO v_workspace FROM typing_presence_fixtures WHERE key = 'workspace_id';
  SELECT value::uuid INTO v_conversation FROM typing_presence_fixtures WHERE key = 'conversation_id';
  SELECT value INTO v_message_topic FROM typing_presence_fixtures WHERE key = 'message_topic';
  SELECT value INTO v_ephemeral_topic FROM typing_presence_fixtures WHERE key = 'ephemeral_topic';

  PERFORM tests.authenticate_as(v_owner, 'typing-presence-owner@test.local');
  v_detail := public.get_conversation(v_workspace, v_conversation);
  PERFORM tests.clear_auth();

  IF v_detail ->> 'visitor_realtime_topic' IS DISTINCT FROM v_message_topic THEN
    RAISE EXCEPTION 'Expected visitor_realtime_topic %, got %',
      v_message_topic, v_detail ->> 'visitor_realtime_topic';
  END IF;

  IF v_detail ->> 'visitor_ephemeral_topic' IS DISTINCT FROM v_ephemeral_topic THEN
    RAISE EXCEPTION 'Expected visitor_ephemeral_topic %, got %',
      v_ephemeral_topic, v_detail ->> 'visitor_ephemeral_topic';
  END IF;
END;
$$;

SELECT pass('get_conversation returns opaque message and ephemeral topics');

-- widget_realtime can evaluate SELECT allow for own message topic (broadcast).
DO $$
DECLARE
  v_topic_key text;
  v_message_topic text;
BEGIN
  SELECT value INTO v_topic_key FROM typing_presence_fixtures WHERE key = 'topic_key';
  SELECT value INTO v_message_topic FROM typing_presence_fixtures WHERE key = 'message_topic';

  SET LOCAL ROLE widget_realtime;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic_key', v_topic_key
    )::text,
    true
  );

  IF NOT (
    'broadcast' = 'broadcast'
    AND v_message_topic = ('widget-conversation:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  ) THEN
    RAISE EXCEPTION 'Expected widget_realtime message-topic SELECT allow';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime can receive its own message topic');

-- widget_realtime INSERT deny on message topic (forgery closed).
DO $$
DECLARE
  v_topic_key text;
  v_message_topic text;
BEGIN
  SELECT value INTO v_topic_key FROM typing_presence_fixtures WHERE key = 'topic_key';
  SELECT value INTO v_message_topic FROM typing_presence_fixtures WHERE key = 'message_topic';

  SET LOCAL ROLE widget_realtime;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic_key', v_topic_key
    )::text,
    true
  );

  -- Publish policy requires ephemeral topic; message topic must fail the check.
  IF (
    'broadcast' IN ('broadcast', 'presence')
    AND v_message_topic = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  ) THEN
    RAISE EXCEPTION 'widget_realtime must not INSERT to message topic';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime cannot INSERT to its message topic');

-- widget_realtime INSERT allow on own ephemeral topic.
DO $$
DECLARE
  v_topic_key text;
  v_ephemeral_topic text;
BEGIN
  SELECT value INTO v_topic_key FROM typing_presence_fixtures WHERE key = 'topic_key';
  SELECT value INTO v_ephemeral_topic FROM typing_presence_fixtures WHERE key = 'ephemeral_topic';

  SET LOCAL ROLE widget_realtime;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic_key', v_topic_key
    )::text,
    true
  );

  IF NOT (
    'broadcast' IN ('broadcast', 'presence')
    AND v_ephemeral_topic = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  ) THEN
    RAISE EXCEPTION 'Expected widget_realtime ephemeral INSERT allow';
  END IF;

  IF NOT (
    'presence' IN ('broadcast', 'presence')
    AND v_ephemeral_topic = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  ) THEN
    RAISE EXCEPTION 'Expected widget_realtime ephemeral Presence INSERT allow';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime can INSERT Broadcast/Presence to its own ephemeral topic');

-- widget_realtime cannot access another ephemeral topic.
DO $$
DECLARE
  v_topic_key text;
  v_foreign text;
  v_count integer;
BEGIN
  SELECT value INTO v_topic_key FROM typing_presence_fixtures WHERE key = 'topic_key';
  SELECT value INTO v_foreign FROM typing_presence_fixtures WHERE key = 'foreign_ephemeral';

  SET LOCAL ROLE widget_realtime;
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'role', 'widget_realtime',
      'purpose', 'widget_realtime',
      'topic_key', v_topic_key
    )::text,
    true
  );

  SELECT count(*)
  INTO v_count
  FROM realtime.messages
  WHERE topic = v_foreign;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'widget_realtime JWT read another ephemeral topic';
  END IF;

  IF v_foreign = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key')) THEN
    RAISE EXCEPTION 'Expected foreign ephemeral topic publish deny';
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('widget_realtime cannot access another ephemeral topic');

-- Authenticated membership required for both topics; cross-workspace denied.
DO $$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_message_topic text;
  v_ephemeral_topic text;
  v_ok boolean;
BEGIN
  SELECT value::uuid INTO v_owner FROM typing_presence_fixtures WHERE key = 'owner_id';
  SELECT value::uuid INTO v_outsider FROM typing_presence_fixtures WHERE key = 'outsider_id';
  SELECT value INTO v_message_topic FROM typing_presence_fixtures WHERE key = 'message_topic';
  SELECT value INTO v_ephemeral_topic FROM typing_presence_fixtures WHERE key = 'ephemeral_topic';

  -- Member: message topic SELECT expression allows.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_message_topic, true);
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
    RAISE EXCEPTION 'Expected workspace member to authorize message topic';
  END IF;

  RESET ROLE;

  -- Member: ephemeral topic INSERT expression allows.
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_ephemeral_topic, true);
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
        ('widget-ephemeral:' || c.visitor_realtime_topic_key)
  )
  INTO v_ok;

  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Expected workspace member to authorize ephemeral topic';
  END IF;

  RESET ROLE;
  PERFORM tests.clear_auth();

  -- Outsider: deny both.
  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_ephemeral_topic, true);
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
        ('widget-ephemeral:' || c.visitor_realtime_topic_key)
  )
  INTO v_ok;

  IF COALESCE(v_ok, false) THEN
    RAISE EXCEPTION 'Outsider authorized foreign ephemeral topic';
  END IF;

  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_outsider::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_outsider, 'role', 'authenticated')::text,
    true
  );
  PERFORM set_config('realtime.topic', v_message_topic, true);
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
    RAISE EXCEPTION 'Outsider authorized foreign message topic';
  END IF;

  RESET ROLE;
  PERFORM tests.clear_auth();
END;
$$;

SELECT pass('authenticated membership required for both topics; cross-workspace denied');

-- Product-table / RPC denial remains intact.
SELECT throws_ok(
  $$
    SET LOCAL ROLE widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
    SELECT count(*) FROM public.messages;
  $$,
  '42501',
  NULL,
  'widget_realtime cannot select messages'
);

SELECT throws_ok(
  $$
    SET LOCAL ROLE widget_realtime;
    SET LOCAL request.jwt.claims TO '{"role":"widget_realtime","purpose":"widget_realtime","topic_key":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}';
    SELECT public.list_conversations('00000000-0000-4000-8000-000000000001'::uuid, '{}'::jsonb);
  $$,
  '42501',
  NULL,
  'widget_realtime cannot execute list_conversations'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'realtime'
      AND tablename = 'messages'
      AND policyname IN (
        'widget_realtime_receive_own_broadcast',
        'widget_realtime_receive_own_topic'
      )
  ),
  'legacy single-topic widget_realtime receive policies removed'
);

SELECT * FROM finish();
ROLLBACK;
