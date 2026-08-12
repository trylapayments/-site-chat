\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(32);

CREATE TEMP TABLE assignment_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_agent_a uuid;
  v_agent_b uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_owner_member_a uuid;
  v_agent_member_a uuid;
  v_agent_member_b uuid;
  v_viewer_member_a uuid;
  v_foreign_agent_member uuid;
  v_contact_a uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
BEGIN
  v_owner_a := tests.create_auth_user('assign-owner-a@test.local');
  v_agent_a := tests.create_auth_user('assign-agent-a@test.local');
  v_agent_b := tests.create_auth_user('assign-agent-b@test.local');
  v_viewer_a := tests.create_auth_user('assign-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('assign-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'assign-owner-a@test.local');
  v_workspace_a := (public.create_workspace('Assign Workspace A', 'assign-workspace-a')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'assign-owner-b@test.local');
  v_workspace_b := (public.create_workspace('Assign Workspace B', 'assign-workspace-b')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_agent_b, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active'),
    (v_workspace_b, v_agent_a, 'agent', 'active');

  SELECT id INTO v_owner_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_owner_a;

  SELECT id INTO v_agent_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;

  SELECT id INTO v_agent_member_b
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_b;

  SELECT id INTO v_viewer_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_viewer_a;

  SELECT id INTO v_foreign_agent_member
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_b AND user_id = v_agent_a;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_a, 'assign-visitor@test.local', 'Assign Visitor')
  RETURNING id INTO v_contact_a;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_a,
    v_contact_a,
    encode(extensions.digest('assign-session-a', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_a,
    v_contact_a,
    encode(extensions.digest('assign-session-b', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_b;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
    status,
    last_message_at,
    last_message_preview,
    message_count
  )
  VALUES (
    v_workspace_a,
    v_session_a,
    v_contact_a,
    'open',
    now() - interval '1 hour',
    'Need help with assignment',
    1
  )
  RETURNING id INTO v_conversation_a;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
    status,
    last_message_at,
    last_message_preview,
    message_count
  )
  VALUES (
    v_workspace_a,
    v_session_b,
    v_contact_a,
    'open',
    now() - interval '2 hours',
    'Second conversation',
    1
  )
  RETURNING id INTO v_conversation_b;

  INSERT INTO assignment_fixtures (key, value) VALUES
    ('owner_a', v_owner_a::text),
    ('agent_a', v_agent_a::text),
    ('agent_b', v_agent_b::text),
    ('viewer_a', v_viewer_a::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_member_a', v_owner_member_a::text),
    ('agent_member_a', v_agent_member_a::text),
    ('agent_member_b', v_agent_member_b::text),
    ('viewer_member_a', v_viewer_member_a::text),
    ('foreign_agent_member', v_foreign_agent_member::text),
    ('contact_a', v_contact_a::text),
    ('conversation_a', v_conversation_a::text),
    ('conversation_b', v_conversation_b::text);

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM assignment_fixtures;
END;
$$;

-- ---------------------------------------------------------------------------
-- Take unassigned
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'assign-agent-a@test.local'
);

SELECT is(
  (
    SELECT public.take_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid
    ) -> 'assignment' ->> 'assignee_member_id'
  ),
  tests.fixture('agent_member_a'),
  'take assigns unassigned conversation to caller'
);

SELECT is(
  (
    SELECT (public.take_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid
    ) ->> 'changed')::boolean
  ),
  false,
  'same operator take again is no-op'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type = 'conversation_assigned'
  ),
  1,
  'no duplicate timeline event on no-op take'
);

-- ---------------------------------------------------------------------------
-- Concurrent Take: second operator gets conflict
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('agent_b')::uuid,
  'assign-agent-b@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.take_conversation(%L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'ASSIGNMENT_CONFLICT%',
  'second operator take raises ASSIGNMENT_CONFLICT'
);

SELECT is(
  (
    SELECT assigned_to::text
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  tests.fixture('agent_member_a'),
  'original assignee remains after failed take'
);

-- ---------------------------------------------------------------------------
-- Assign / transfer / unassign
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('agent_member_b')
  ),
  'assign to valid workspace member'
);

SELECT is(
  (
    SELECT assigned_to::text
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  tests.fixture('agent_member_b'),
  'transfer updates current assignee'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type = 'conversation_transferred'
      AND metadata_json ->> 'from_member_id' = tests.fixture('agent_member_a')
      AND metadata_json ->> 'to_member_id' = tests.fixture('agent_member_b')
  ),
  'conversation_transferred timeline event emitted once'
);

SELECT is(
  (
    SELECT (public.assign_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      tests.fixture('agent_member_b')::uuid
    ) ->> 'changed')::boolean
  ),
  false,
  'assign to current assignee is no-op'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type = 'conversation_transferred'
  ),
  1,
  'no timeline event on no-op assign'
);

SELECT throws_like(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('foreign_agent_member')
  ),
  'MEMBER_NOT_FOUND%',
  'reject foreign workspace member as assignee'
);

SELECT throws_like(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('viewer_member_a')
  ),
  'MEMBER_NOT_ASSIGNABLE%',
  'reject viewer as assignee'
);

-- deactivate agent_b then reject as assignee
SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'assign-owner-a@test.local'
);

-- First move assignment off agent_b so deactivate unassign path can be tested separately
SELECT lives_ok(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('agent_member_a')
  ),
  'reassign to agent_a before deactivate test'
);

UPDATE public.workspace_members
SET status = 'deactivated'
WHERE id = tests.fixture('agent_member_b')::uuid;

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'assign-agent-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('agent_member_b')
  ),
  'MEMBER_NOT_ASSIGNABLE%',
  'reject deactivated member as assignee'
);

-- Restore agent_b for later tests
UPDATE public.workspace_members
SET status = 'active'
WHERE id = tests.fixture('agent_member_b')::uuid;

SELECT is(
  (
    SELECT (public.unassign_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid
    ) -> 'assignment' ->> 'assignee_member_id')
  ),
  NULL,
  'unassign clears current assignee'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type = 'conversation_unassigned'
  ),
  'conversation_unassigned timeline event emitted'
);

SELECT is(
  (
    SELECT (public.unassign_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid
    ) ->> 'changed')::boolean
  ),
  false,
  'unassign when already unassigned is no-op'
);

-- ---------------------------------------------------------------------------
-- last_message_at must not bump on assignment
-- ---------------------------------------------------------------------------

UPDATE public.conversations
SET last_message_at = '2026-01-01T00:00:00Z'
WHERE id = tests.fixture('conversation_b')::uuid;

SELECT is(
  (
    SELECT (public.take_conversation(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_b')::uuid
    ) -> 'conversation' ->> 'last_message_at')
  ),
  '2026-01-01T00:00:00+00:00',
  'take does not bump last_message_at'
);

-- ---------------------------------------------------------------------------
-- Role authorization + cross-workspace denial
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'assign-viewer-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.take_conversation(%L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_b')
  ),
  'Insufficient permissions',
  'viewer cannot take conversation'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'assign-agent-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.take_conversation(%L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_b'),
    tests.fixture('conversation_a')
  ),
  '%',
  'cross-workspace take denied'
);

-- ---------------------------------------------------------------------------
-- Inbox filter correctness
-- ---------------------------------------------------------------------------

SELECT ok(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('assignment', 'unassigned')
    ) -> 'items') @> jsonb_build_array(
      jsonb_build_object('id', tests.fixture('conversation_a'))
    )
  ),
  'unassigned filter includes unassigned conversation_a'
);

SELECT lives_ok(
  format(
    $q$SELECT public.take_conversation(%L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a')
  ),
  'take conversation_a for mine filter'
);

SELECT ok(
  (
    SELECT (public.list_conversations(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('assignment', 'assigned_to_me')
    ) -> 'items') @> jsonb_build_array(
      jsonb_build_object('id', tests.fixture('conversation_a'))
    )
  ),
  'mine filter includes conversations assigned to caller'
);

SELECT ok(
  (
    SELECT NOT (
      (public.list_conversations(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('assignment', 'unassigned')
      ) -> 'items') @> jsonb_build_array(
        jsonb_build_object('id', tests.fixture('conversation_a'))
      )
    )
  ),
  'unassigned filter excludes assigned conversation'
);

-- ---------------------------------------------------------------------------
-- Deactivate member clears their assignments
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  format(
    $q$SELECT public.assign_conversation(%L::uuid, %L::uuid, %L::uuid)$q$,
    tests.fixture('workspace_a'),
    tests.fixture('conversation_a'),
    tests.fixture('agent_member_b')
  ),
  'assign to agent_b before deactivate'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'assign-owner-a@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.deactivate_workspace_member(%L::uuid)$q$,
    tests.fixture('agent_member_b')
  ),
  'owner deactivates agent_b'
);

SELECT is(
  (
    SELECT assigned_to
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  NULL,
  'deactivate clears assignee on open conversations'
);

-- ---------------------------------------------------------------------------
-- Privileges: EXECUTE grants + app_private locked
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege('authenticated', 'public.take_conversation(uuid, uuid, bigint)', 'execute'),
  'authenticated can execute take_conversation'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.unassign_conversation(uuid, uuid, bigint)', 'execute'),
  'authenticated can execute unassign_conversation'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.assign_conversation(uuid, uuid, uuid)', 'execute'),
  'authenticated can execute assign_conversation'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.apply_conversation_assignment(uuid, uuid, uuid, text, bigint)',
    'execute'
  ),
  'authenticated cannot execute app_private.apply_conversation_assignment'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.take_conversation(uuid, uuid, bigint)', 'execute'),
  'anon cannot execute take_conversation'
);

SELECT * FROM finish();

ROLLBACK;
