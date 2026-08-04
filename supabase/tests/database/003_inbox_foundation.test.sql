\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(28);

CREATE TEMP TABLE inbox_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_agent_a uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_outsider uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_agent_member_a uuid;
  v_viewer_member_a uuid;
  v_contact_a uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_contact_b uuid;
  v_client_message_id uuid := 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
BEGIN
  v_owner_a := tests.create_auth_user('inbox-owner-a@test.local');
  v_agent_a := tests.create_auth_user('inbox-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('inbox-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('inbox-owner-b@test.local');
  v_outsider := tests.create_auth_user('inbox-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'inbox-owner-a@test.local');
  v_workspace_a := (public.create_workspace('Inbox Workspace A', 'inbox-workspace-a')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'inbox-owner-b@test.local');
  v_workspace_b := (public.create_workspace('Inbox Workspace B', 'inbox-workspace-b')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_a, v_agent_a, 'agent', 'active');

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_a, v_viewer_a, 'viewer', 'active');

  SELECT id INTO v_agent_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;

  SELECT id INTO v_viewer_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_viewer_a;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_a, 'visitor-a@test.local', 'Visitor A')
  RETURNING id INTO v_contact_a;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_a,
    v_contact_a,
    encode(extensions.digest('session-a', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
    status,
    assigned_to,
    message_count,
    last_message_at,
    last_message_preview,
    next_message_sequence
  )
  VALUES (
    v_workspace_a,
    v_session_a,
    v_contact_a,
    'open',
    v_agent_member_a,
    2,
    now(),
    'Hello from visitor',
    3
  )
  RETURNING id INTO v_conversation_a;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body
  )
  VALUES (
    v_workspace_a,
    v_conversation_a,
    1,
    'visitor',
    v_session_a,
    'Hello from visitor'
  );

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    agent_member_id,
    body
  )
  VALUES (
    v_workspace_a,
    v_conversation_a,
    2,
    'agent',
    v_agent_member_a,
    'Agent reply'
  );

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_b, 'visitor-b@test.local', 'Visitor B')
  RETURNING id INTO v_contact_b;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_b,
    v_contact_b,
    encode(extensions.digest('session-b', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_b;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
    message_count,
    last_message_at,
    last_message_preview,
    next_message_sequence
  )
  VALUES (
    v_workspace_b,
    v_session_b,
    v_contact_b,
    1,
    now(),
    'Workspace B message',
    2
  )
  RETURNING id INTO v_conversation_b;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body
  )
  VALUES (
    v_workspace_b,
    v_conversation_b,
    1,
    'visitor',
    v_session_b,
    'Workspace B message'
  );

  INSERT INTO inbox_fixtures (key, value) VALUES
    ('owner_a', v_owner_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('outsider', v_outsider::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('agent_member_a', v_agent_member_a::text),
    ('viewer_member_a', v_viewer_member_a::text),
    ('contact_a', v_contact_a::text),
    ('conversation_a', v_conversation_a::text),
    ('conversation_b', v_conversation_b::text),
    ('client_message_id', v_client_message_id::text);

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM inbox_fixtures
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

-- Schema
SELECT has_table('public', 'contacts', 'contacts table exists');
SELECT has_table('public', 'visitor_sessions', 'visitor_sessions table exists');
SELECT has_table('public', 'conversations', 'conversations table exists');
SELECT has_table('public', 'messages', 'messages table exists');
SELECT has_table('public', 'conversation_member_reads', 'conversation_member_reads table exists');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_messages_sender_identity'
      AND conrelid = 'public.messages'::regclass
  ),
  'messages sender identity check exists'
);

-- Cross-tenant SELECT (RLS)
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'inbox-outsider@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.conversations
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'outsider cannot read workspace A conversations'
);

SELECT tests.clear_auth();

SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'inbox-owner-b@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.get_conversation(%L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'Workspace not accessible',
  'workspace B owner cannot get workspace A conversation via RPC'
);

SELECT tests.clear_auth();

-- Composite FK: contact from wrong workspace on conversation
SELECT throws_ok(
  format(
    $q$
    INSERT INTO public.conversations (
      workspace_id,
      visitor_session_id,
      contact_id
    )
    SELECT
      %1$L::uuid,
      vs.id,
      c.id
    FROM public.visitor_sessions vs
    CROSS JOIN public.contacts c
    WHERE vs.workspace_id = %1$L::uuid
      AND c.workspace_id = %2$L::uuid
    LIMIT 1
    $q$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_b')
  ),
  '23503',
  NULL,
  'composite FK rejects contact from another workspace'
);

-- list_conversations
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'inbox-agent-a@test.local'
);

SELECT ok(
  (
    SELECT jsonb_array_length(
      public.list_conversations(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('page', 1, 'pageSize', 25)
      ) -> 'items'
    ) >= 1
  ),
  'agent can list conversations in workspace A'
);

SELECT ok(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('assignment', 'assigned_to_me')
    ) -> 'items' -> 0 -> 'has_unread')::boolean
  ),
  'assigned conversation shows unread visitor message'
);

-- get_conversation + list_messages
SELECT ok(
  (
    SELECT (public.get_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid
    ) ->> 'id') = tests.fixture('conversation_a')
  ),
  'agent can get conversation detail'
);

SELECT is(
  (
    SELECT jsonb_array_length(
      public.list_messages(
        tests.fixture('workspace_a')::uuid,
        tests.fixture('conversation_a')::uuid,
        '{}'::jsonb
      ) -> 'items'
    )
  ),
  2,
  'agent sees two messages'
);

-- send_operator_message + idempotency
SELECT ok(
  (
    SELECT (public.send_operator_message(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'Follow-up message',
      tests.fixture('client_message_id')::uuid
    ) -> 'message' ->> 'sequence_number') = '3'
  ),
  'agent can send operator message with sequence 3'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.messages
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND client_message_id = tests.fixture('client_message_id')::uuid
  ),
  1,
  'idempotent client_message_id creates only one message'
);

SELECT ok(
  (
    SELECT (public.send_operator_message(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'Follow-up message',
      tests.fixture('client_message_id')::uuid
    ) -> 'message' ->> 'sequence_number') = '3'
  ),
  'retry returns existing message without new sequence'
);

-- viewer cannot send
SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'inbox-viewer-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.send_operator_message(%L::uuid, %L::uuid, 'Blocked', NULL)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'Insufficient permissions',
  'viewer cannot send operator message'
);

SELECT throws_like(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('agent_member_a')
  ),
  'Insufficient permissions',
  'viewer cannot assign conversation'
);

SELECT throws_like(
  format(
    $q$SELECT public.update_conversation_status(%L::uuid, %L::uuid, 'resolved'::public.app_conversation_status)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'Insufficient permissions',
  'viewer cannot update conversation status'
);

SELECT ok(
  (
    SELECT jsonb_array_length(
      public.list_messages(
        tests.fixture('workspace_a')::uuid,
        tests.fixture('conversation_a')::uuid,
        '{}'::jsonb
      ) -> 'items'
    ) >= 1
  ),
  'viewer can list non-internal messages'
);

SELECT tests.clear_auth();

-- assign + status by agent
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'inbox-agent-a@test.local'
);

SELECT ok(
  (
    SELECT (public.assign_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      NULL
    ) ->> 'assigned_to') IS NULL
  ),
  'agent can unassign conversation'
);

SELECT is(
  (
    SELECT (public.update_conversation_status(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'resolved'::public.app_conversation_status
    ) ->> 'status')
  ),
  'resolved',
  'agent can update conversation status'
);

-- mark_conversation_read
SELECT ok(
  (
    SELECT (public.mark_conversation_read(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      NULL
    ) -> 'has_unread')::boolean = false
  ),
  'mark_conversation_read clears unread for visitor messages'
);

SELECT ok(
  (
    SELECT last_read_sequence >= 1
    FROM public.conversation_member_reads
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND member_id = tests.fixture('agent_member_a')::uuid
  ),
  'read cursor persisted'
);

-- Internal messages hidden from viewer
SELECT tests.clear_auth();

INSERT INTO public.messages (
  workspace_id,
  conversation_id,
  sequence_number,
  sender_type,
  agent_member_id,
  body,
  is_internal
)
VALUES (
  tests.fixture('workspace_a')::uuid,
  tests.fixture('conversation_a')::uuid,
  99,
  'agent',
  tests.fixture('agent_member_a')::uuid,
  'Internal note',
  true
);

UPDATE public.conversations
SET next_message_sequence = GREATEST(next_message_sequence, 100)
WHERE id = tests.fixture('conversation_a')::uuid;

SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'inbox-viewer-a@test.local'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.messages
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND is_internal = true
  ),
  'viewer RLS hides internal messages'
);

SELECT tests.clear_auth();

-- System messages do not cause unread
SELECT tests.clear_auth();

INSERT INTO public.messages (
  workspace_id,
  conversation_id,
  sequence_number,
  sender_type,
  body
)
VALUES (
  tests.fixture('workspace_a')::uuid,
  tests.fixture('conversation_a')::uuid,
  100,
  'system',
  'System event'
);

SELECT ok(
  NOT app_private.conversation_has_unread(
    tests.fixture('conversation_a')::uuid,
    tests.fixture('agent_member_a')::uuid,
    (
      SELECT last_read_sequence
      FROM public.conversation_member_reads
      WHERE conversation_id = tests.fixture('conversation_a')::uuid
        AND member_id = tests.fixture('agent_member_a')::uuid
    )
  ),
  'system messages do not create unread'
);

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'inbox-agent-a@test.local'
);

-- Search filter
SELECT ok(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', 'Visitor A')
    ) -> 'total')::integer >= 1
  ),
  'search matches contact name'
);

-- Pagination
SELECT ok(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('page', 1, 'pageSize', 10)
    ) -> 'pageSize')::integer = 10
  ),
  'pagination returns requested page size'
);

SELECT tests.clear_auth();

SELECT * FROM finish();
ROLLBACK;
