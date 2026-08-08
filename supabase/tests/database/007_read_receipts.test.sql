\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

DO $$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_workspace uuid;
  v_other_workspace uuid;
  v_member_id uuid;
  v_session uuid;
  v_conversation uuid;
  v_token text := 'read-receipt-session-token';
BEGIN
  DELETE FROM tests.fixtures;

  v_owner := tests.create_auth_user('read-receipts-owner@test.local');
  v_outsider := tests.create_auth_user('read-receipts-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner, 'read-receipts-owner@test.local');
  v_workspace := (public.create_workspace('Read Receipts WS', 'read-receipts-ws')->>'workspace_id')::uuid;

  SELECT wm.id INTO v_member_id
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace
    AND wm.user_id = v_owner;

  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_outsider, 'read-receipts-outsider@test.local');
  v_other_workspace := (public.create_workspace('Other RR WS', 'read-receipts-other')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
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
  RETURNING id INTO v_conversation;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('owner_id', v_owner::text),
    ('outsider_id', v_outsider::text),
    ('workspace_id', v_workspace::text),
    ('other_workspace_id', v_other_workspace::text),
    ('member_id', v_member_id::text),
    ('session_id', v_session::text),
    ('conversation_id', v_conversation::text),
    ('session_token', v_token);
END;
$$;

SELECT has_table('public', 'conversation_visitor_reads', 'conversation_visitor_reads exists');
SELECT has_column(
  'public',
  'conversation_member_reads',
  'unread_count',
  'member reads has unread_count'
);
SELECT has_column(
  'public',
  'conversation_member_reads',
  'last_delivered_sequence',
  'member reads has last_delivered_sequence'
);
SELECT has_column(
  'public',
  'conversations',
  'visitor_message_count',
  'conversations has visitor_message_count'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.widget_mark_conversation_receipt(uuid, text, text, bigint)',
    'execute'
  ),
  'service_role can execute widget_mark_conversation_receipt'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.widget_mark_conversation_receipt(uuid, text, text, bigint)',
    'execute'
  ),
  'authenticated cannot execute widget_mark_conversation_receipt'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'conversation_member_reads'
  ),
  'conversation_member_reads published for CDC'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'conversation_visitor_reads'
  ),
  'conversation_visitor_reads published for CDC'
);

-- Visitor message increments visitor_message_count
SELECT lives_ok(
  format(
    $sql$
      INSERT INTO public.messages (
        workspace_id,
        conversation_id,
        sequence_number,
        sender_type,
        visitor_session_id,
        body
      )
      VALUES (
        %L::uuid,
        %L::uuid,
        1,
        'visitor',
        %L::uuid,
        'hello unread'
      );
      UPDATE public.conversations
      SET next_message_sequence = 2, message_count = 1, last_message_at = now(), last_message_preview = 'hello unread'
      WHERE id = %L::uuid;
    $sql$,
    tests.fixture('workspace_id'),
    tests.fixture('conversation_id'),
    tests.fixture('session_id'),
    tests.fixture('conversation_id')
  ),
  'insert visitor message'
);

SELECT is(
  (
    SELECT visitor_message_count
    FROM public.conversations
    WHERE id = tests.fixture('conversation_id')::uuid
  ),
  1::bigint,
  'visitor_message_count increments on visitor message'
);

-- Operator mark read clears unread and is no-op on reopen
SELECT tests.authenticate_as(
  tests.fixture('owner_id')::uuid,
  'read-receipts-owner@test.local'
);

SELECT is(
  (
    SELECT (public.mark_conversation_read(
      tests.fixture('workspace_id')::uuid,
      tests.fixture('conversation_id')::uuid,
      1
    ) ->> 'unread_count')::integer
  ),
  0,
  'mark_conversation_read clears unread_count'
);

SELECT is(
  (
    SELECT (public.mark_conversation_read(
      tests.fixture('workspace_id')::uuid,
      tests.fixture('conversation_id')::uuid,
      1
    ) ->> 'updated')::boolean
  ),
  false,
  'reopening already-read conversation performs no write'
);

SELECT is(
  (
    SELECT (public.get_inbox_unread_total(
      tests.fixture('workspace_id')::uuid
    ) ->> 'unread_total')::integer
  ),
  0,
  'global unread total is zero after read'
);

SELECT tests.clear_auth();

-- Agent reply then visitor marks delivered + read via service_role RPC
SELECT lives_ok(
  format(
    $sql$
      INSERT INTO public.messages (
        workspace_id,
        conversation_id,
        sequence_number,
        sender_type,
        agent_member_id,
        body
      )
      VALUES (
        %L::uuid,
        %L::uuid,
        2,
        'agent',
        %L::uuid,
        'agent reply'
      );
      UPDATE public.conversations
      SET next_message_sequence = 3, message_count = 2, last_message_at = now(), last_message_preview = 'agent reply'
      WHERE id = %L::uuid;
    $sql$,
    tests.fixture('workspace_id'),
    tests.fixture('conversation_id'),
    tests.fixture('member_id'),
    tests.fixture('conversation_id')
  ),
  'insert agent reply'
);

DO $$
DECLARE
  v_workspace uuid := tests.fixture('workspace_id')::uuid;
  v_token text := tests.fixture('session_token');
  v_delivered jsonb;
  v_dup jsonb;
  v_read jsonb;
BEGIN
  SET LOCAL ROLE service_role;

  v_delivered := public.widget_mark_conversation_receipt(
    v_workspace,
    v_token,
    'delivered',
    2
  );

  IF (v_delivered ->> 'last_delivered_sequence')::bigint IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected delivered sequence 2, got %', v_delivered;
  END IF;

  v_dup := public.widget_mark_conversation_receipt(
    v_workspace,
    v_token,
    'delivered',
    2
  );

  IF (v_dup ->> 'updated')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'expected delivered no-op, got %', v_dup;
  END IF;

  v_read := public.widget_mark_conversation_receipt(
    v_workspace,
    v_token,
    'read',
    2
  );

  IF (v_read ->> 'last_read_sequence')::bigint IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'expected read sequence 2, got %', v_read;
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('visitor delivered advances last_delivered_sequence');
SELECT pass('duplicate visitor delivered is a no-op');
SELECT pass('visitor read advances last_read_sequence');

SELECT tests.authenticate_as(
  tests.fixture('owner_id')::uuid,
  'read-receipts-owner@test.local'
);

SELECT is(
  (
    SELECT (public.get_conversation(
      tests.fixture('workspace_id')::uuid,
      tests.fixture('conversation_id')::uuid
    ) ->> 'visitor_last_read_sequence')::bigint
  ),
  2::bigint,
  'get_conversation exposes visitor_last_read_sequence'
);

SELECT ok(
  (
    SELECT public.get_conversation(
      tests.fixture('workspace_id')::uuid,
      tests.fixture('conversation_id')::uuid
    ) ? 'last_message_at'
  ),
  'get_conversation includes last_message_at for detail schema compatibility'
);

SELECT is(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_id')::uuid,
      '{}'::jsonb
    ) -> 'items' -> 0 ->> 'unread_count')::integer
  ),
  0,
  'list_conversations includes unread_count'
);

-- Concurrent losing writer must not clobber unread after a higher watermark won.
-- Direct table write requires elevated role (authenticated has no INSERT).
DO $$
DECLARE
  v_unread integer;
BEGIN
  SET LOCAL ROLE service_role;

  INSERT INTO public.conversation_member_reads (
    workspace_id,
    conversation_id,
    member_id,
    last_read_sequence,
    last_delivered_sequence,
    unread_count,
    last_read_at
  )
  VALUES (
    tests.fixture('workspace_id')::uuid,
    tests.fixture('conversation_id')::uuid,
    tests.fixture('member_id')::uuid,
    1,
    1,
    2,
    now()
  )
  ON CONFLICT (conversation_id, member_id) DO UPDATE
  SET
    last_read_sequence = GREATEST(
      public.conversation_member_reads.last_read_sequence,
      EXCLUDED.last_read_sequence
    ),
    last_delivered_sequence = GREATEST(
      public.conversation_member_reads.last_delivered_sequence,
      EXCLUDED.last_delivered_sequence
    ),
    unread_count = CASE
      WHEN EXCLUDED.last_read_sequence > public.conversation_member_reads.last_read_sequence
        THEN EXCLUDED.unread_count
      ELSE public.conversation_member_reads.unread_count
    END;

  SELECT r.unread_count
  INTO v_unread
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = tests.fixture('conversation_id')::uuid
    AND r.member_id = tests.fixture('member_id')::uuid;

  IF v_unread IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'expected unread_count 0 after losing writer, got %', v_unread;
  END IF;

  RESET ROLE;
END;
$$;

SELECT pass('losing concurrent mark-read writer does not inflate unread_count');

-- Cross-workspace isolation: outsider cannot mark read
SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('outsider_id')::uuid,
  'read-receipts-outsider@test.local'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.mark_conversation_read(%L::uuid, %L::uuid, 2)
    $sql$,
    tests.fixture('workspace_id'),
    tests.fixture('conversation_id')
  ),
  'P0001',
  NULL,
  'outsider cannot mark conversation read in another workspace'
);

SELECT finish();
ROLLBACK;
