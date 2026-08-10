BEGIN;
SELECT plan(28);

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

SELECT * FROM finish();
ROLLBACK;
