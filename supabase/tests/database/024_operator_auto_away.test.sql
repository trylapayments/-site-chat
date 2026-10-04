BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(3);
SELECT col_default_is('public', 'operator_availability', 'idle_timeout_minutes', '5', 'Auto-away defaults to five minutes');
SELECT col_not_null('public', 'operator_availability', 'last_activity_at', 'Activity timestamp is required');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operator_availability'::regclass), 'Preferences keep RLS enabled');
SELECT * FROM finish();
ROLLBACK;
