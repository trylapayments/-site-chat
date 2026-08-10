BEGIN;
SELECT plan(10);

SELECT has_table('public', 'ai_usage_events', 'ai_usage_events exists');
SELECT has_table('public', 'ai_rate_limit_buckets', 'ai_rate_limit_buckets exists');
SELECT has_function(
  'public',
  'ai_consume_rate_limit',
  ARRAY['text', 'integer', 'integer']
);
SELECT has_function('app_private', 'workspace_ai_config', ARRAY['jsonb']);

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

SELECT * FROM finish();
ROLLBACK;
