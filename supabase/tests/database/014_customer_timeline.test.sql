\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- schema/privs(6) + cross-tenant(3) + page view(5) + message/idempotency(6)
-- + identity(4) + status/assign(4) + pagination(3) + viewer(1) + foreign contact(1)
-- = 33
SELECT plan(33);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_owner_b uuid;
  v_viewer_a uuid;
  v_agent_a uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_session_a uuid;
  v_token text := 'timeline-session-token-aaaaaaaa';
  v_token_hash text;
BEGIN
  v_owner_a := tests.create_auth_user('timeline-owner-a@test.local');
  v_owner_b := tests.create_auth_user('timeline-owner-b@test.local');
  v_viewer_a := tests.create_auth_user('timeline-viewer-a@test.local');
  v_agent_a := tests.create_auth_user('timeline-agent-a@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'timeline-owner-a@test.local');
  v_workspace_a := (
    public.create_workspace('Timeline A', 'timeline-a')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'timeline-owner-b@test.local');
  v_workspace_b := (
    public.create_workspace('Timeline B', 'timeline-b')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_viewer_a, 'viewer', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active');

  INSERT INTO public.contacts (workspace_id, public_id)
  VALUES (
    v_workspace_a,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex')
  )
  RETURNING id INTO v_contact_a;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_b,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'secret-b@test.local',
    'Workspace B Visitor'
  )
  RETURNING id INTO v_contact_b;

  v_token_hash := encode(
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
    'hex'
  );

  INSERT INTO public.visitor_sessions (
    workspace_id,
    contact_id,
    session_token_hash,
    expires_at,
    locale
  )
  VALUES (
    v_workspace_a,
    v_contact_a,
    v_token_hash,
    now() + interval '1 day',
    'en'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('owner_a', v_owner_a::text),
    ('owner_b', v_owner_b::text),
    ('viewer_a', v_viewer_a::text),
    ('agent_a', v_agent_a::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('contact_a', v_contact_a::text),
    ('contact_b', v_contact_b::text),
    ('session_a', v_session_a::text),
    ('session_token', v_token);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema + privileges
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'customer_timeline_events',
  'customer_timeline_events exists'
);

SELECT col_type_is(
  'public',
  'customer_timeline_events',
  'metadata_json',
  'jsonb',
  'metadata_json is jsonb'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.customer_timeline_events'::regclass
  ),
  'RLS enabled on customer_timeline_events'
);

SELECT ok(
  has_function_privilege(
    'anon',
    'public.list_customer_timeline(uuid, jsonb)',
    'EXECUTE'
  ) = false,
  'anon cannot execute list_customer_timeline'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.list_customer_timeline(uuid, jsonb)',
    'EXECUTE'
  ),
  'authenticated can execute list_customer_timeline'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.emit_customer_timeline_event(uuid, uuid, text, text, jsonb, uuid, uuid, uuid, timestamptz, text)',
    'EXECUTE'
  ) = false,
  'authenticated cannot execute emit helper'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant isolation
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT app_private.emit_customer_timeline_event(
      tests.fixture('workspace_b')::uuid,
      tests.fixture('contact_b')::uuid,
      'page_viewed',
      'visitor',
      '{"v":1,"url":"https://b.example/secret"}'::jsonb,
      NULL,
      NULL,
      NULL,
      now(),
      'test:seed:b'
    );
  $$,
  'seed workspace B timeline event'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'timeline-owner-a@test.local'
);

SELECT throws_ok(
  $$
    SELECT public.list_customer_timeline(
      tests.fixture('workspace_b')::uuid,
      jsonb_build_object(
        'contact_id', tests.fixture('contact_b')::uuid,
        'limit', 20
      )
    );
  $$,
  NULL,
  'owner A cannot list workspace B timeline'
);

SELECT is_empty(
  $$
    SELECT id
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_b')::uuid;
  $$,
  'RLS hides workspace B timeline rows from owner A'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Page view emission + dedupe + sanitized URL
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.widget_record_page_view(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'https://shop.example/pricing?utm_source=ads&token=SECRET&utm_medium=cpc#frag',
      'Pricing',
      NULL,
      'ads',
      'cpc',
      NULL,
      NULL,
      NULL,
      'tab-1'
    );
  $$,
  'record page view with secret-bearing URL'
);

SELECT results_eq(
  $$
    SELECT metadata_json ->> 'url'
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'page_viewed'
    ORDER BY occurred_at DESC
    LIMIT 1;
  $$,
  $$VALUES ('https://shop.example/pricing?utm_source=ads&utm_medium=cpc')$$,
  'page_viewed stores sanitized URL only'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'page_viewed'
      AND metadata_json::text ILIKE '%SECRET%'
  ),
  0,
  'no secret token leaked into page_viewed metadata'
);

SELECT lives_ok(
  $$
    SELECT public.widget_record_page_view(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'https://shop.example/pricing?utm_source=ads&utm_medium=cpc',
      'Pricing',
      NULL,
      'ads',
      'cpc',
      NULL,
      NULL,
      NULL,
      'tab-1'
    );
  $$,
  'duplicate page view within dedupe window'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'page_viewed'
      AND metadata_json ->> 'url'
        = 'https://shop.example/pricing?utm_source=ads&utm_medium=cpc'
  ),
  1,
  'page-view dedupe does not create duplicate timeline events'
);

-- ---------------------------------------------------------------------------
-- Message / conversation / idempotency
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.widget_send_visitor_message(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'Hello timeline',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'https://shop.example/pricing',
      NULL
    );
  $$,
  'visitor sends message'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'conversation_started'
  ),
  'conversation_started emitted'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'visitor_message_sent'
      AND metadata_json ? 'message_id'
      AND NOT (metadata_json ? 'body')
  ),
  'visitor_message_sent emitted without message body'
);

SELECT lives_ok(
  $$
    SELECT public.widget_send_visitor_message(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'Hello timeline',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'https://shop.example/pricing',
      NULL
    );
  $$,
  'retry visitor message with same client_message_id'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'visitor_message_sent'
  ),
  1,
  'message retry does not duplicate timeline event'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'conversation_started'
  ),
  1,
  'conversation_started not duplicated on message retry'
);

-- ---------------------------------------------------------------------------
-- Identity: anonymous → identified, then no-op on identical values
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.widget_identify_visitor(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'Jane Timeline',
      'jane.timeline@example.com',
      NULL,
      NULL,
      NULL
    );
  $$,
  'identify anonymous visitor with name/email'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'visitor_identified'
      AND metadata_json ->> 'email' = 'jane.timeline@example.com'
      AND NOT (metadata_json ? 'continuity_token')
  ),
  'visitor_identified emitted with safe metadata'
);

SELECT lives_ok(
  $$
    SELECT public.widget_identify_visitor(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('session_token'),
      'Jane Timeline',
      'jane.timeline@example.com',
      NULL,
      NULL,
      NULL
    );
  $$,
  'identify with unchanged values (no-op)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type IN ('visitor_identified', 'visitor_profile_updated')
  ),
  1,
  'no-op identify creates no additional identity timeline event'
);

-- ---------------------------------------------------------------------------
-- Status / assignment
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'timeline-agent-a@test.local'
);

SELECT lives_ok(
  $$
    SELECT public.update_conversation_status(
      tests.fixture('workspace_a')::uuid,
      (
        SELECT id
        FROM public.conversations
        WHERE workspace_id = tests.fixture('workspace_a')::uuid
        LIMIT 1
      ),
      'resolved'
    );
  $$,
  'operator resolves conversation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'conversation_status_changed'
      AND metadata_json ->> 'to_status' = 'resolved'
  ),
  'conversation_status_changed emitted'
);

SELECT lives_ok(
  $$
    SELECT public.assign_conversation(
      tests.fixture('workspace_a')::uuid,
      (
        SELECT id
        FROM public.conversations
        WHERE workspace_id = tests.fixture('workspace_a')::uuid
        LIMIT 1
      ),
      (
        SELECT id
        FROM public.workspace_members
        WHERE workspace_id = tests.fixture('workspace_a')::uuid
          AND user_id = tests.fixture('agent_a')::uuid
        LIMIT 1
      )
    );
  $$,
  'operator assigns conversation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND event_type = 'conversation_assigned'
  ),
  'conversation_assigned emitted'
);

-- ---------------------------------------------------------------------------
-- Pagination
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

SELECT lives_ok(
  $$
    SELECT app_private.emit_customer_timeline_event(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      'page_viewed',
      'visitor',
      '{"v":1,"url":"https://shop.example/old"}'::jsonb,
      tests.fixture('session_a')::uuid,
      NULL,
      NULL,
      now() - interval '2 hours',
      'test:page:old'
    );
    SELECT app_private.emit_customer_timeline_event(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      'page_viewed',
      'visitor',
      '{"v":1,"url":"https://shop.example/new"}'::jsonb,
      tests.fixture('session_a')::uuid,
      NULL,
      NULL,
      now() + interval '1 minute',
      'test:page:new'
    );
  $$,
  'seed ordered page events for pagination'
);

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'timeline-agent-a@test.local'
);

SELECT ok(
  (
    WITH page AS (
      SELECT public.list_customer_timeline(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'contact_id', tests.fixture('contact_a')::uuid,
          'limit', 2
        )
      ) AS result
    )
    SELECT
      (result -> 'events' -> 0 ->> 'occurred_at')
        >= (result -> 'events' -> 1 ->> 'occurred_at')
      AND (result ->> 'has_more')::boolean
      AND jsonb_typeof(result -> 'next_before') = 'object'
    FROM page
  ),
  'list returns newest-first page with has_more cursor'
);

SELECT ok(
  (
    WITH first_page AS (
      SELECT public.list_customer_timeline(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'contact_id', tests.fixture('contact_a')::uuid,
          'limit', 2
        )
      ) AS result
    ),
    second_page AS (
      SELECT public.list_customer_timeline(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'contact_id', tests.fixture('contact_a')::uuid,
          'limit', 50,
          'before', (SELECT result -> 'next_before' FROM first_page)
        )
      ) AS result
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements((SELECT result -> 'events' FROM first_page)) a
      JOIN jsonb_array_elements((SELECT result -> 'events' FROM second_page)) b
        ON a ->> 'id' = b ->> 'id'
    )
  ),
  'load-older page has no overlapping event ids'
);

SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'timeline-viewer-a@test.local'
);

SELECT lives_ok(
  $$
    SELECT public.list_customer_timeline(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object(
        'contact_id', tests.fixture('contact_a')::uuid,
        'limit', 5
      )
    );
  $$,
  'viewer can list timeline'
);

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'timeline-agent-a@test.local'
);

SELECT throws_ok(
  $$
    SELECT public.list_customer_timeline(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object(
        'contact_id', tests.fixture('contact_b')::uuid,
        'limit', 5
      )
    );
  $$,
  NULL,
  'cannot list foreign contact via own workspace_id'
);

SELECT * FROM finish();

ROLLBACK;
