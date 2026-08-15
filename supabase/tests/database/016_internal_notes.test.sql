\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(99);

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

  INSERT INTO tests.fixtures (key, value) VALUES
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

-- ---------------------------------------------------------------------------
-- Privilege matrix: public RPCs + app_private lockdown
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_internal_note(uuid, uuid, text, uuid, uuid[])',
    'execute'
  ),
  'authenticated can execute create_internal_note'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.list_internal_notes(uuid, uuid, jsonb)',
    'execute'
  ),
  'authenticated can execute list_internal_notes'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.create_internal_note(uuid, uuid, text, uuid, uuid[])',
    'execute'
  ),
  'anon cannot execute create_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'public',
    'public.create_internal_note(uuid, uuid, text, uuid, uuid[])',
    'execute'
  ),
  'PUBLIC cannot execute create_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.sync_internal_note_mentions(uuid, uuid, uuid, uuid, uuid[], boolean)',
    'execute'
  ),
  'authenticated cannot execute sync_internal_note_mentions'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.sync_internal_note_mentions(uuid, uuid, uuid, uuid, uuid[], boolean)',
    'execute'
  ),
  'anon cannot execute sync_internal_note_mentions'
);

SELECT ok(
  NOT has_function_privilege(
    'public',
    'app_private.sync_internal_note_mentions(uuid, uuid, uuid, uuid, uuid[], boolean)',
    'execute'
  ),
  'PUBLIC cannot execute sync_internal_note_mentions'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'app_private.sync_internal_note_mentions(uuid, uuid, uuid, uuid, uuid[], boolean)',
    'execute'
  ),
  'service_role cannot execute sync_internal_note_mentions directly'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.create_internal_note(uuid, uuid, text, uuid, uuid[])',
    'execute'
  ),
  'authenticated cannot execute app_private.create_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.update_internal_note(uuid, uuid, text, uuid[])',
    'execute'
  ),
  'authenticated cannot execute app_private.update_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.soft_delete_internal_note(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot execute app_private.soft_delete_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.list_internal_notes(uuid, uuid, jsonb)',
    'execute'
  ),
  'authenticated cannot execute app_private.list_internal_notes'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.get_internal_note(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot execute app_private.get_internal_note'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.require_notes_access(uuid)',
    'execute'
  ),
  'authenticated cannot execute require_notes_access'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.assert_mentionable_member(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot execute assert_mentionable_member'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.resolve_note_contact_id(uuid, uuid)',
    'execute'
  ),
  'authenticated cannot execute resolve_note_contact_id'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.user_workspace_ids()',
    'execute'
  ),
  'authenticated retains user_workspace_ids'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.user_workspace_role(uuid)',
    'execute'
  ),
  'authenticated retains user_workspace_role'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.workspace_is_accessible(uuid)',
    'execute'
  ),
  'authenticated retains workspace_is_accessible'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.get_caller_member_id(uuid)',
    'execute'
  ),
  'authenticated retains get_caller_member_id'
);

-- ---------------------------------------------------------------------------
-- Create note + mentions + timeline + notifications
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent A'
);

SELECT isnt(
  public.create_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('conversation_a')::uuid,
    'Please review pricing with agent B',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
    ARRAY[tests.fixture('agent_member_b')::uuid]
  )->>'id',
  NULL,
  'agent can create internal note'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_1', id::text
FROM public.internal_notes
WHERE conversation_id = tests.fixture('conversation_a')::uuid
  AND client_note_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
LIMIT 1;

SELECT is(
  (SELECT count(*)::integer FROM public.internal_notes
   WHERE conversation_id = tests.fixture('conversation_a')::uuid
     AND deleted_at IS NULL),
  1,
  'note row persisted'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = tests.fixture('note_1')::uuid),
  1,
  'mention row persisted'
);

-- Notifications are recipient-scoped under RLS; count as postgres.
SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'mention'
     AND recipient_id = tests.fixture('agent_member_b')::uuid
     AND resource_id = tests.fixture('note_1')::uuid),
  1,
  'durable mention notification created'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_created'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'timeline internal_note_created emitted once'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'mention_created'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'timeline mention_created emitted once'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-authenticate agent A after notification count'
);

-- Idempotent create via client_note_id (atomic ON CONFLICT)
SELECT is(
  (
    SELECT count(DISTINCT id)::integer FROM (
      SELECT (public.create_internal_note(
        tests.fixture('workspace_a')::uuid,
        tests.fixture('conversation_a')::uuid,
        'Please review pricing with agent B',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
        ARRAY[tests.fixture('agent_member_b')::uuid]
      )->>'id')::uuid AS id
      FROM generate_series(1, 5)
    ) retries
  ),
  1,
  'client_note_id prevents duplicate notes under retries'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_created'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'duplicate create does not duplicate timeline created event'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = tests.fixture('note_1')::uuid),
  1,
  'duplicate create does not duplicate mention rows'
);

SELECT tests.clear_auth();

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'mention'
     AND resource_id = tests.fixture('note_1')::uuid),
  1,
  'duplicate create does not duplicate notifications'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-authenticate agent A before mention edit'
);

-- ---------------------------------------------------------------------------
-- Mention edit: remove then re-add notifies again
-- ---------------------------------------------------------------------------

SELECT ok(
  (public.update_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid,
    'Updated note body without mentions',
    ARRAY[]::uuid[]
  )->>'body') = 'Updated note body without mentions',
  'agent can update note body and clear mentions'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = tests.fixture('note_1')::uuid),
  0,
  'removing mention deletes internal_note_mentions row'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_updated'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'timeline internal_note_updated emitted on body change'
);

-- No-op edit: same body + empty mentions → no extra updated event
SELECT ok(
  (public.update_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid,
    'Updated note body without mentions',
    ARRAY[]::uuid[]
  )->>'body') = 'Updated note body without mentions',
  'no-op edit returns current note'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_updated'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'no-op edit does not emit another internal_note_updated'
);

SELECT ok(
  (public.update_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid,
    'Updated note body mentioning agent B again',
    ARRAY[tests.fixture('agent_member_b')::uuid]
  )->>'body') IS NOT NULL,
  're-add mention on edit succeeds'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = tests.fixture('note_1')::uuid
     AND mentioned_member_id = tests.fixture('agent_member_b')::uuid),
  1,
  're-added mention inserts a new mention row'
);

SELECT tests.clear_auth();

SELECT is(
  (SELECT count(*)::integer FROM public.notifications
   WHERE type = 'mention'
     AND recipient_id = tests.fixture('agent_member_b')::uuid
     AND resource_id = tests.fixture('note_1')::uuid),
  2,
  're-adding a mention notifies again'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-authenticate agent A after re-add notification count'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'mention_created'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  2,
  're-adding a mention emits another mention_created'
);

-- Duplicate mention ids in one submit collapse to one row
SELECT ok(
  (public.update_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid,
    'Deduped mentions',
    ARRAY[
      tests.fixture('agent_member_b')::uuid,
      tests.fixture('agent_member_b')::uuid
    ]
  )->>'body') = 'Deduped mentions',
  'update with duplicate mention ids succeeds'
);

SELECT is(
  (SELECT count(*)::integer FROM public.internal_note_mentions
   WHERE note_id = tests.fixture('note_1')::uuid),
  1,
  'duplicate mention ids result in one mention row'
);

-- ---------------------------------------------------------------------------
-- Viewer isolation: notes CRUD + timeline events
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('viewer_a')::uuid,
      'notes-viewer-a@test.local'
    );
  $$,
  'authenticate viewer'
);

SELECT throws_like(
  $$
    SELECT public.list_internal_notes(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      '{}'::jsonb
    );
  $$,
  '%FORBIDDEN%',
  'viewer cannot list notes'
);

SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
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
   WHERE workspace_id = tests.fixture('workspace_a')::uuid),
  0,
  'viewer RLS cannot SELECT notes'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type IN (
        'internal_note_created',
        'internal_note_updated',
        'internal_note_deleted',
        'mention_created'
      )
  ),
  0,
  'viewer direct SELECT sees zero note/mention timeline events'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_customer_timeline(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'contact_id', tests.fixture('contact_a')::uuid,
          'conversation_id', tests.fixture('conversation_a')::uuid,
          'limit', 50
        )
      )->'events'
    ) AS item
    WHERE item->>'event_type' IN (
      'internal_note_created',
      'internal_note_updated',
      'internal_note_deleted',
      'mention_created'
    )
  ),
  0,
  'viewer list_customer_timeline returns zero note/mention events'
);

-- Agent still sees note timeline events
SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-authenticate agent A after viewer checks'
);

SELECT ok(
  (
    SELECT count(*) > 0
    FROM public.customer_timeline_events
    WHERE conversation_id = tests.fixture('conversation_a')::uuid
      AND event_type = 'internal_note_created'
  ),
  'agent can still SELECT internal_note_created events'
);

SELECT ok(
  (
    SELECT count(*) > 0
    FROM jsonb_array_elements(
      public.list_customer_timeline(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'contact_id', tests.fixture('contact_a')::uuid,
          'conversation_id', tests.fixture('conversation_a')::uuid,
          'limit', 50
        )
      )->'events'
    ) AS item
    WHERE item->>'event_type' = 'internal_note_created'
  ),
  'agent list_customer_timeline includes internal_note_created'
);

-- Soft delete
SELECT ok(
  (public.soft_delete_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid
  )->>'deleted_at') IS NOT NULL,
  'soft delete sets deleted_at'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_deleted'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'timeline internal_note_deleted emitted once'
);

SELECT is(
  jsonb_array_length(
    public.list_internal_notes(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      '{}'::jsonb
    )->'items'
  ),
  0,
  'list excludes soft-deleted notes'
);

SELECT is(
  jsonb_array_length(
    public.list_internal_notes(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      jsonb_build_object('authoritative', true)
    )->'tombstones'
  ),
  0,
  'authoritative without catch_up_since returns no tombstones (bounded)'
);

SELECT ok(
  jsonb_array_length(
    public.list_internal_notes(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      jsonb_build_object(
        'authoritative', true,
        'catch_up_since', (now() - interval '1 hour')::text
      )
    )->'tombstones'
  ) >= 1,
  'authoritative with catch_up_since returns soft-delete tombstones in window'
);

SELECT ok(
  (public.soft_delete_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_1')::uuid
  )->>'deleted_at') IS NOT NULL,
  'soft delete is idempotent'
);

SELECT is(
  (SELECT count(*)::integer FROM public.customer_timeline_events
   WHERE event_type = 'internal_note_deleted'
     AND conversation_id = tests.fixture('conversation_a')::uuid),
  1,
  'idempotent soft delete does not duplicate deleted timeline event'
);

-- Workspace isolation
SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_b')::uuid,
      tests.fixture('conversation_a')::uuid,
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
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent A for searchable note'
);

SELECT lives_ok(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
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
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'unique-search-token-notes-xyz')
      )->'items'
    ) AS item
  ),
  'inbox search finds conversation via note body for agents'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('viewer_a')::uuid,
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
        tests.fixture('workspace_a')::uuid,
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
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent for direct write denial'
);

SELECT throws_like(
  $$
    INSERT INTO public.internal_notes (
      workspace_id, conversation_id, author_member_id, body
    ) VALUES (
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      tests.fixture('agent_member_a')::uuid,
      'direct insert'
    );
  $$,
  '%permission denied%',
  'direct INSERT into internal_notes denied'
);

-- Mention viewer rejected
SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'mention viewer',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      ARRAY[tests.fixture('viewer_member_a')::uuid]
    );
  $$,
  '%MEMBER_NOT_MENTIONABLE%',
  'cannot mention viewer'
);

-- ---------------------------------------------------------------------------
-- Author member removal: column-specific SET NULL on author_member_id
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_b')::uuid,
      'notes-agent-b@test.local'
    );
  $$,
  'authenticate agent B for author-removal note'
);

SELECT lives_ok(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'Note authored by agent B for member-removal FK test',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      NULL
    );
  $$,
  'agent B creates note for author-removal test'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_author_b', id::text
FROM public.internal_notes
WHERE client_note_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('owner_a')::uuid,
      'notes-owner-a@test.local'
    );
  $$,
  'authenticate owner to remove author member'
);

SELECT lives_ok(
  $$
    SELECT public.remove_workspace_member(tests.fixture('agent_member_b')::uuid);
  $$,
  'owner can remove author member without FK failure'
);

-- Counts after member removal must run as postgres (bypass RLS).
SELECT tests.clear_auth();

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.internal_notes
    WHERE id = tests.fixture('note_author_b')::uuid
  ),
  1,
  'note retained after author member removal'
);

SELECT is(
  (
    SELECT workspace_id::text
    FROM public.internal_notes
    WHERE id = tests.fixture('note_author_b')::uuid
  ),
  tests.fixture('workspace_a'),
  'workspace_id unchanged after author member removal'
);

SELECT is(
  (
    SELECT author_member_id
    FROM public.internal_notes
    WHERE id = tests.fixture('note_author_b')::uuid
  ),
  NULL,
  'author_member_id IS NULL after author member removal'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent A to read former-member note'
);

SELECT is(
  public.get_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_author_b')::uuid
  )->>'author_display_label',
  'Former member',
  'UI payload shows Former member after author removal'
);

-- Anonymous / visitor cannot execute note RPCs
SELECT lives_ok(
  $$ SELECT tests.clear_auth(); $$,
  'clear auth for visitor denial'
);

SELECT throws_like(
  $$
    SELECT public.list_internal_notes(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      '{}'::jsonb
    );
  $$,
  '%',
  'unauthenticated cannot list notes'
);

-- ---------------------------------------------------------------------------
-- Create after soft-delete with same client_note_id → NOTE_DELETED
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'authenticate agent A for create-after-delete idempotency'
);

SELECT lives_ok(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'idempotent-deleted-body',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      ARRAY[tests.fixture('agent_member_a')::uuid]
    );
  $$,
  'create note for soft-delete idempotency case'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_idem_del', id::text
FROM public.internal_notes
WHERE client_note_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-auth agent A to soft-delete idempotency note'
);

SELECT ok(
  (public.soft_delete_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_idem_del')::uuid
  )->>'deleted_at') IS NOT NULL,
  'soft-delete note used for create-after-delete test'
);

SELECT throws_like(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'idempotent-deleted-body-retry',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid,
      NULL
    );
  $$,
  '%NOTE_DELETED%',
  'create with soft-deleted client_note_id raises NOTE_DELETED'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.internal_notes
    WHERE client_note_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
      AND deleted_at IS NULL
  ),
  0,
  'create-after-delete does not resurrect an active note'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE event_type = 'internal_note_created'
      AND (metadata_json->>'note_id') = tests.fixture('note_idem_del')
  ),
  1,
  'create-after-delete does not duplicate created timeline event'
);

-- Watermarked tombstones: old deletes excluded
SELECT lives_ok(
  $$
    SELECT public.create_internal_note(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('conversation_a')::uuid,
      'old-tombstone-note',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid,
      NULL
    );
  $$,
  'create note that will become an old tombstone'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_old_tomb', id::text
FROM public.internal_notes
WHERE client_note_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  'auth for old tombstone soft-delete'
);

SELECT ok(
  (public.soft_delete_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_old_tomb')::uuid
  )->>'deleted_at') IS NOT NULL,
  'soft-delete old tombstone note'
);

-- Backdate as table owner (postgres). Authenticated sessions cannot ALTER triggers.
SELECT tests.clear_auth();

ALTER TABLE public.internal_notes DISABLE TRIGGER trg_internal_notes_set_updated_at;
UPDATE public.internal_notes
SET updated_at = now() - interval '2 days',
    deleted_at = now() - interval '2 days'
WHERE id = tests.fixture('note_old_tomb')::uuid;
ALTER TABLE public.internal_notes ENABLE TRIGGER trg_internal_notes_set_updated_at;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'notes-agent-a@test.local'
    );
  $$,
  're-auth agent for watermarked catch-up asserts'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_internal_notes(
        tests.fixture('workspace_a')::uuid,
        tests.fixture('conversation_a')::uuid,
        jsonb_build_object(
          'authoritative', true,
          'catch_up_since', (now() - interval '1 hour')::text
        )
      )->'tombstones'
    ) AS t
    WHERE t->>'id' = tests.fixture('note_old_tomb')
  ),
  0,
  'authoritative catch_up_since excludes old tombstones'
);

SELECT ok(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_internal_notes(
        tests.fixture('workspace_a')::uuid,
        tests.fixture('conversation_a')::uuid,
        jsonb_build_object(
          'authoritative', true,
          'catch_up_since', (now() - interval '1 hour')::text
        )
      )->'tombstones'
    ) AS t
    WHERE t->>'id' = tests.fixture('note_idem_del')
  ) >= 1,
  'authoritative catch_up_since includes recent tombstones'
);

-- Soft-deleted notes excluded from inbox search
SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_conversations(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'idempotent-deleted-body')
      )->'items'
    ) AS item
  ),
  0,
  'soft-deleted note body excluded from inbox search'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_internal_note(uuid, uuid, text, uuid, uuid[])',
    'execute'
  ),
  'authenticated can execute public.create_internal_note'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_internal_note(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute public.get_internal_note'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.update_internal_note(uuid, uuid, text, uuid[])',
    'execute'
  ),
  'authenticated can execute public.update_internal_note'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_internal_note(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute public.soft_delete_internal_note'
);

SELECT * FROM finish();
ROLLBACK;
