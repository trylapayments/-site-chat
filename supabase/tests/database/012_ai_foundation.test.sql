\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- 25 existing foundation/privilege assertions + 4 member-delete FK behavior checks.
SELECT plan(29);

SELECT has_table('public', 'ai_usage_events', 'ai_usage_events exists');
SELECT has_table('public', 'ai_rate_limit_buckets', 'ai_rate_limit_buckets exists');
SELECT has_function(
  'public',
  'ai_consume_rate_limit',
  ARRAY['text', 'integer', 'integer']
);
SELECT has_function('app_private', 'workspace_ai_config', ARRAY['jsonb']);
SELECT has_function(
  'app_private',
  'ai_consume_rate_limit',
  ARRAY['text', 'integer', 'integer']
);

SELECT is(
  (app_private.workspace_ai_config('{}'::jsonb) ->> 'enabled')::boolean,
  false,
  'AI config defaults to disabled'
);

SELECT is(
  (
    app_private.workspace_ai_config(
      '{"ai":{"enabled":true,"provider":"mock","features":{"suggestedReplies":true}}}'::jsonb
    ) -> 'features' ->> 'suggestedReplies'
  )::boolean,
  true,
  'AI config extracts suggestedReplies feature flag'
);

SELECT is(
  public.ai_consume_rate_limit('ai-test-bucket', 60, 2),
  true,
  'AI rate limit first request allowed'
);

SELECT is(
  public.ai_consume_rate_limit('ai-test-bucket', 60, 2),
  true,
  'AI rate limit second request allowed'
);

SELECT is(
  public.ai_consume_rate_limit('ai-test-bucket', 60, 2),
  false,
  'AI rate limit third request blocked in fixed window'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_rate_limit_buckets', 'INSERT'),
  'authenticated cannot insert into ai_rate_limit_buckets'
);

SELECT ok(
  has_table_privilege('service_role', 'public.workspaces', 'UPDATE'),
  'service_role can update workspaces for server-side AI config'
);

-- Privilege assertions (same style as 007_read_receipts.test.sql)
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'service_role can execute public.ai_consume_rate_limit'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'authenticated cannot execute public.ai_consume_rate_limit'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'anon cannot execute public.ai_consume_rate_limit'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'app_private.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'service_role can execute app_private.ai_consume_rate_limit'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'authenticated cannot execute app_private.ai_consume_rate_limit'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.ai_consume_rate_limit(text, integer, integer)',
    'execute'
  ),
  'anon cannot execute app_private.ai_consume_rate_limit'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'app_private.workspace_ai_config(jsonb)',
    'execute'
  ),
  'service_role can execute app_private.workspace_ai_config'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.workspace_ai_config(jsonb)',
    'execute'
  ),
  'authenticated cannot execute app_private.workspace_ai_config'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.workspace_ai_config(jsonb)',
    'execute'
  ),
  'anon cannot execute app_private.workspace_ai_config'
);

-- Telemetry table: authenticated has no SELECT (service_role only until analytics UI).
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_usage_events', 'SELECT'),
  'authenticated cannot select ai_usage_events'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.ai_usage_events', 'SELECT'),
  'anon cannot select ai_usage_events'
);

SELECT ok(
  has_table_privilege('service_role', 'public.ai_usage_events', 'INSERT'),
  'service_role can insert ai_usage_events'
);

-- Composite FK exists for member/workspace integrity.
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_ai_usage_events_member_workspace'
      AND contype = 'f'
  ),
  'ai_usage_events has composite member/workspace FK'
);

-- ---------------------------------------------------------------------------
-- Member hard-delete must null only member_id (workspace_id stays NOT NULL).
-- Exercises the real remove_workspace_member path used by the product.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_owner uuid;
  v_agent uuid;
  v_workspace uuid;
  v_owner_member uuid;
  v_agent_member uuid;
  v_usage_id uuid;
BEGIN
  DELETE FROM tests.fixtures;

  v_owner := tests.create_auth_user('ai-foundation-owner@test.local');
  v_agent := tests.create_auth_user('ai-foundation-agent@test.local');

  PERFORM tests.authenticate_as(v_owner, 'ai-foundation-owner@test.local');
  v_workspace := (
    public.create_workspace('AI Foundation WS', 'ai-foundation-ws')
    ->> 'workspace_id'
  )::uuid;

  SELECT wm.id INTO v_owner_member
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace
    AND wm.user_id = v_owner;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace, v_agent, 'agent', 'active')
  RETURNING id INTO v_agent_member;

  INSERT INTO public.ai_usage_events (
    workspace_id,
    member_id,
    feature,
    provider,
    model,
    latency_ms,
    status
  )
  VALUES (
    v_workspace,
    v_agent_member,
    'suggested_replies',
    'mock',
    'mock-suggested-reply',
    12,
    'success'
  )
  RETURNING id INTO v_usage_id;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('owner_id', v_owner::text),
    ('agent_id', v_agent::text),
    ('workspace_id', v_workspace::text),
    ('owner_member_id', v_owner_member::text),
    ('agent_member_id', v_agent_member::text),
    ('usage_event_id', v_usage_id::text);

  PERFORM tests.clear_auth();
END;
$$;

SELECT tests.authenticate_as(
  tests.fixture('owner_id')::uuid,
  'ai-foundation-owner@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.remove_workspace_member(%L::uuid)$q$,
    tests.fixture('agent_member_id')
  ),
  'remove_workspace_member succeeds when ai_usage_events reference the member'
);

SELECT tests.clear_auth();

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.ai_usage_events
    WHERE id = tests.fixture('usage_event_id')::uuid
  ),
  'ai_usage_events row remains after member deletion'
);

SELECT is(
  (
    SELECT member_id
    FROM public.ai_usage_events
    WHERE id = tests.fixture('usage_event_id')::uuid
  ),
  NULL,
  'member_id is NULL after member deletion'
);

SELECT is(
  (
    SELECT workspace_id
    FROM public.ai_usage_events
    WHERE id = tests.fixture('usage_event_id')::uuid
  ),
  tests.fixture('workspace_id')::uuid,
  'workspace_id is preserved after member deletion'
);

SELECT * FROM finish();
ROLLBACK;
