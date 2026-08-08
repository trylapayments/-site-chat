\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

CREATE TEMP TABLE read_receipt_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

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

  INSERT INTO read_receipt_fixtures (key, value) VALUES
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

SELECT has_table('public', 'conversation_visitor_reads');
SELECT has_column('public', 'conversation_member_reads', 'unread_count');
SELECT has_column('public', 'conversation_member_reads', 'last_delivered_sequence');
SELECT has_column('public', 'conversations', 'visitor_message_count');

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

-- Visitor message increments visitor_message_count + creates unread for members with rows
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
    (SELECT value FROM read_receipt_fixtures WHERE key = 'workspace_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'conversation_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'session_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'conversation_id')
  ),
  'insert visitor message'
);

SELECT is(
  (
    SELECT visitor_message_count
    FROM public.conversations
    WHERE id = (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'conversation_id')
  ),
  1::bigint,
  'visitor_message_count increments on visitor message'
);

-- Operator mark read clears unread and is no-op on reopen
SELECT tests.authenticate_as(
  (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'owner_id'),
  'read-receipts-owner@test.local'
);

SELECT is(
  (
    SELECT (public.mark_conversation_read(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'conversation_id'),
      1
    ) ->> 'unread_count')::integer
  ),
  0,
  'mark_conversation_read clears unread_count'
);

SELECT is(
  (
    SELECT (public.mark_conversation_read(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'conversation_id'),
      1
    ) ->> 'updated')::boolean
  ),
  false,
  'reopening already-read conversation performs no write'
);

SELECT is(
  (
    SELECT (public.get_inbox_unread_total(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id')
    ) ->> 'unread_total')::integer
  ),
  0,
  'global unread total is zero after read'
);

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
    (SELECT value FROM read_receipt_fixtures WHERE key = 'workspace_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'conversation_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'member_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'conversation_id')
  ),
  'insert agent reply'
);

SET LOCAL ROLE service_role;

SELECT is(
  (
    SELECT (public.widget_mark_conversation_receipt(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value FROM read_receipt_fixtures WHERE key = 'session_token'),
      'delivered',
      2
    ) ->> 'last_delivered_sequence')::bigint
  ),
  2::bigint,
  'visitor delivered advances last_delivered_sequence'
);

SELECT is(
  (
    SELECT (public.widget_mark_conversation_receipt(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value FROM read_receipt_fixtures WHERE key = 'session_token'),
      'delivered',
      2
    ) ->> 'updated')::boolean
  ),
  false,
  'duplicate visitor delivered is a no-op'
);

SELECT is(
  (
    SELECT (public.widget_mark_conversation_receipt(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value FROM read_receipt_fixtures WHERE key = 'session_token'),
      'read',
      2
    ) ->> 'last_read_sequence')::bigint
  ),
  2::bigint,
  'visitor read advances last_read_sequence'
);

RESET ROLE;

SELECT tests.authenticate_as(
  (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'owner_id'),
  'read-receipts-owner@test.local'
);

SELECT is(
  (
    SELECT (public.get_conversation(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'conversation_id')
    ) ->> 'visitor_last_read_sequence')::bigint
  ),
  2::bigint,
  'get_conversation exposes visitor_last_read_sequence'
);

SELECT is(
  (
    SELECT (public.list_conversations(
      (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'workspace_id'),
      '{}'::jsonb
    ) -> 'items' -> 0 ->> 'unread_count')::integer
  ),
  0,
  'list_conversations includes unread_count'
);

-- Cross-workspace isolation: outsider cannot mark read
SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  (SELECT value::uuid FROM read_receipt_fixtures WHERE key = 'outsider_id'),
  'read-receipts-outsider@test.local'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.mark_conversation_read(%L::uuid, %L::uuid, 2)
    $sql$,
    (SELECT value FROM read_receipt_fixtures WHERE key = 'workspace_id'),
    (SELECT value FROM read_receipt_fixtures WHERE key = 'conversation_id')
  ),
  'P0001',
  NULL,
  'outsider cannot mark conversation read in another workspace'
);

SELECT finish();
ROLLBACK;
