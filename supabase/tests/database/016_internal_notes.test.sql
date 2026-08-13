\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(32);

CREATE TEMP TABLE note_fixtures (
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
  v_contact_a uuid;
  v_session_a uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
BEGIN
  v_owner_a := tests.create_auth_user('notes-owner-a@test.local');
  v_agent_a := tests.create_auth_user('notes-agent-a@test.local');
  v_agent_b := tests.create_auth_user('notes-agent-b@test.local');
  v_viewer_a := tests.create_auth_user('notes-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('notes-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'notes-owner-a@test.local');
  v_workspace_a := (public.create_workspace('Notes Workspace A', 'notes-workspace-a')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'notes-owner-b@test.local');
  v_workspace_b := (public.create_workspace('Notes Workspace B', 'notes-workspace-b')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_agent_b, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active'),
    (v_workspace_b, v_agent_a, 'agent', 'active');

  SELECT id INTO v_owner_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_owner_a;
  SELECT id INTO v_agent_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;
  SELECT id INTO v_agent_member_b FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_b;
  SELECT id INTO v_viewer_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_viewer_a;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_a, 'notes-visitor@test.local', 'Notes Visitor')
  RETURNING id INTO v_contact_a;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_a,
    v_contact_a,
    encode(extensions.digest('notes-session-a', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, status, channel_type
  )
  VALUES (v_workspace_a, v_session_a, v_contact_a, 'open', 'widget')
  RETURNING id INTO v_conversation_a;

  INSERT INTO public.contacts (workspace_id, email, name)
  VALUES (v_workspace_b, 'notes-visitor-b@test.local', 'Notes Visitor B');

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  SELECT
    v_workspace_b,
    c.id,
    encode(extensions.digest('notes-session-b', 'sha256'), 'hex'),
    now() + interval '1 day'
  FROM public.contacts c
  WHERE c.workspace_id = v_workspace_b
  LIMIT 1;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, status, channel_type
  )
  SELECT
    v_workspace_b,
    vs.id,
    vs.contact_id,
    'open',
    'widget'
  FROM public.visitor_sessions vs
  WHERE vs.workspace_id = v_workspace_b
  LIMIT 1
  RETURNING id INTO v_conversation_b;

  INSERT INTO note_fixtures(key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_a', v_owner_a::text),
    ('agent_a', v_agent_a::text),
    ('agent_b', v_agent_b::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_member_a', v_owner_member_a::text),
    ('agent_member_a', v_agent_member_a::text),
    ('agent_member_b', v_agent_member_b::text),
    ('viewer_member_a', v_viewer_member_a::text),
    ('conversation_a', v_conversation_a::text),
    ('conversation_b', v_conversation_b::text),
    ('contact_a', v_contact_a::text);
END;
$$;

-- Create note + mentions
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_a'),
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent A'
);

SELECT isnt(
  public.create_internal_note(
    (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
    (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
    'Please review pricing with @notes-agent-b',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    ARRAY[(SELECT value::uuid FROM note_fixtures WHERE key = 'agent_member_b')]
  )->>'id',
  NULL,
  'agent can create internal note'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_notes
   WHERE conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')
     AND deleted_at IS NULL),
  1,
  'note row persisted'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = (SELECT id FROM public.internal_notes LIMIT 1)),
  1,
  'mention row persisted'
);

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'mention'
     AND recipient_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_member_b')),
  1,
  'durable mention notification created'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_created'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'timeline internal_note_created emitted once'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'mention_created'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'timeline mention_created emitted once'
);

-- Idempotent create via client_note_id
SELECT is(
  (
    SELECT count(DISTINCT id)::integer FROM (
      SELECT (public.create_internal_note(
        (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
        (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
        'Please review pricing with @notes-agent-b',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
        ARRAY[(SELECT value::uuid FROM note_fixtures WHERE key = 'agent_member_b')]
      )->>'id')::uuid AS id
      FROM generate_series(1, 3)
    ) retries
  ),
  1,
  'client_note_id prevents duplicate notes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_created'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'duplicate create does not duplicate timeline created event'
);

-- Edit
SELECT ok(
  (public.update_internal_note(
    (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
    (SELECT id FROM public.internal_notes WHERE deleted_at IS NULL LIMIT 1),
    'Updated note body mentioning agent B',
    ARRAY[(SELECT value::uuid FROM note_fixtures WHERE key = 'agent_member_b')]
  )->>'body') = 'Updated note body mentioning agent B',
  'agent can update note body'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_updated'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'timeline internal_note_updated emitted'
);

-- Viewer cannot list or create
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'viewer_a'),
      'notes-viewer-a@test.local'
    );
  $$,
  'authenticate viewer'
);

SELECT throws_like(
  $$
    SELECT public.list_internal_notes(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      '{}'::jsonb
    );
  $$,
  '%FORBIDDEN%',
  'viewer cannot list notes'
);

SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      'viewer note',
      NULL,
      NULL
    );
  $$,
  '%',
  'viewer cannot create notes'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_notes
   WHERE workspace_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a')),
  0,
  'viewer RLS cannot SELECT notes'
);

-- Soft delete
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_a'),
      'notes-agent-a@test.local'
    );
  $$,
  're-authenticate agent A'
);

SELECT ok(
  (public.soft_delete_internal_note(
    (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
    (SELECT id FROM public.internal_notes LIMIT 1)
  )->>'deleted_at') IS NOT NULL,
  'soft delete sets deleted_at'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_deleted'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'timeline internal_note_deleted emitted once'
);

SELECT is(
  jsonb_array_length(
    public.list_internal_notes(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      '{}'::jsonb
    )->'items'
  ),
  0,
  'list excludes soft-deleted notes'
);

-- Soft-delete idempotent
SELECT ok(
  (public.soft_delete_internal_note(
    (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
    (SELECT id FROM public.internal_notes LIMIT 1)
  )->>'deleted_at') IS NOT NULL,
  'soft delete is idempotent'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_deleted'
     AND conversation_id = (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a')),
  1,
  'idempotent soft delete does not duplicate deleted timeline event'
);

-- Workspace isolation
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_a'),
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent for isolation'
);

SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_b'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      'cross tenant',
      NULL,
      NULL
    );
  $$,
  '%',
  'cannot create note for conversation outside workspace'
);

-- Search includes note bodies for agents
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_a'),
      'notes-agent-a@test.local'
    );
    PERFORM public.create_internal_note(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      'unique-search-token-notes-xyz',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
      NULL
    );
  $$,
  'create searchable note'
);

SELECT ok(
  (
    SELECT count(*) > 0
    FROM jsonb_array_elements(
      public.list_conversations(
        (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
        jsonb_build_object('q', 'unique-search-token-notes-xyz')
      )->'items'
    ) AS item
  ),
  'inbox search finds conversation via note body for agents'
);

-- Viewer search must not hit notes
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'viewer_a'),
      'notes-viewer-a@test.local'
    );
  $$,
  'authenticate viewer for search isolation'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_conversations(
        (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
        jsonb_build_object('q', 'unique-search-token-notes-xyz')
      )->'items'
    ) AS item
  ),
  0,
  'viewer inbox search does not match internal note bodies'
);

-- Direct table insert denied for authenticated
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_a'),
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent for direct write denial'
);

SELECT throws_ok(
  $$
    INSERT INTO public.internal_notes (
      workspace_id, conversation_id, author_member_id, body
    ) VALUES (
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'agent_member_a'),
      'direct insert'
    );
  $$,
  '42501',
  'direct INSERT into internal_notes denied'
);

-- Mention viewer rejected
SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      'mention viewer',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      ARRAY[(SELECT value::uuid FROM note_fixtures WHERE key = 'viewer_member_a')]
    );
  $$,
  '%MEMBER_NOT_MENTIONABLE%',
  'cannot mention viewer'
);

-- Anonymous / visitor cannot execute note RPCs
SELECT lives_ok(
  $$ SELECT tests.clear_auth(); $$,
  'clear auth for visitor denial'
);

SELECT throws_like(
  $$
    SELECT public.list_internal_notes(
      (SELECT value::uuid FROM note_fixtures WHERE key = 'workspace_a'),
      (SELECT value::uuid FROM note_fixtures WHERE key = 'conversation_a'),
      '{}'::jsonb
    );
  $$,
  '%',
  'unauthenticated cannot list notes'
);

SELECT * FROM finish();
ROLLBACK;
