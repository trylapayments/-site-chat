\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(87);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_admin_a uuid;
  v_agent_a uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_public_key_a text;
BEGIN
  v_owner_a := tests.create_auth_user('studio-owner-a@test.local');
  v_admin_a := tests.create_auth_user('studio-admin-a@test.local');
  v_agent_a := tests.create_auth_user('studio-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('studio-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('studio-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'studio-owner-a@test.local');
  v_workspace_a := (
    public.create_workspace('Studio Workspace A', 'studio-workspace-a') ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'studio-owner-b@test.local');
  v_workspace_b := (
    public.create_workspace('Studio Workspace B', 'studio-workspace-b') ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_admin_a, 'admin', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  PERFORM app_private.ensure_widget_config(v_workspace_a);
  PERFORM app_private.ensure_widget_config(v_workspace_b);

  SELECT widget_public_key
  INTO v_public_key_a
  FROM public.workspaces
  WHERE id = v_workspace_a;

  INSERT INTO tests.fixtures (key, value)
  VALUES
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('public_key_a', v_public_key_a);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema, indexes, and RLS
-- ---------------------------------------------------------------------------

SELECT has_table('public', 'widget_configs', 'widget_configs table exists');
SELECT has_table('public', 'widget_assets', 'widget_assets table exists');

SELECT has_column('public', 'widget_configs', 'workspace_id', 'widget_configs.workspace_id exists');
SELECT has_column('public', 'widget_configs', 'draft_json', 'widget_configs.draft_json exists');
SELECT has_column('public', 'widget_configs', 'published_json', 'widget_configs.published_json exists');
SELECT has_column('public', 'widget_configs', 'published_version', 'widget_configs.published_version exists');
SELECT has_column('public', 'widget_configs', 'draft_updated_at', 'widget_configs.draft_updated_at exists');
SELECT has_column('public', 'widget_configs', 'published_at', 'widget_configs.published_at exists');
SELECT has_column('public', 'widget_configs', 'published_by', 'widget_configs.published_by exists');
SELECT has_column('public', 'widget_configs', 'draft_updated_by', 'widget_configs.draft_updated_by exists');
SELECT has_column('public', 'widget_configs', 'created_at', 'widget_configs.created_at exists');
SELECT has_column('public', 'widget_configs', 'updated_at', 'widget_configs.updated_at exists');

SELECT has_column('public', 'widget_assets', 'id', 'widget_assets.id exists');
SELECT has_column('public', 'widget_assets', 'workspace_id', 'widget_assets.workspace_id exists');
SELECT has_column('public', 'widget_assets', 'kind', 'widget_assets.kind exists');
SELECT has_column('public', 'widget_assets', 'storage_key', 'widget_assets.storage_key exists');
SELECT has_column('public', 'widget_assets', 'mime_type', 'widget_assets.mime_type exists');
SELECT has_column('public', 'widget_assets', 'byte_size', 'widget_assets.byte_size exists');
SELECT has_column('public', 'widget_assets', 'width', 'widget_assets.width exists');
SELECT has_column('public', 'widget_assets', 'height', 'widget_assets.height exists');
SELECT has_column('public', 'widget_assets', 'original_filename', 'widget_assets.original_filename exists');
SELECT has_column('public', 'widget_assets', 'created_by', 'widget_assets.created_by exists');
SELECT has_column('public', 'widget_assets', 'created_at', 'widget_assets.created_at exists');
SELECT has_column('public', 'widget_assets', 'updated_at', 'widget_assets.updated_at exists');
SELECT has_column('public', 'widget_assets', 'deleted_at', 'widget_assets.deleted_at exists');

SELECT has_index('public', 'widget_configs', 'widget_configs_pkey', 'widget_configs primary-key index exists');
SELECT has_index('public', 'widget_assets', 'idx_widget_assets_workspace', 'widget_assets workspace index exists');
SELECT has_index('public', 'widget_assets', 'idx_widget_assets_workspace_kind', 'widget_assets active-kind index exists');
SELECT has_index(
  'public',
  'widget_assets',
  'uq_widget_assets_workspace_storage_key',
  'widget_assets workspace storage-key unique index exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_configs'::regclass),
  'widget_configs has RLS enabled'
);
SELECT ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_configs'::regclass),
  'widget_configs forces RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_assets'::regclass),
  'widget_assets has RLS enabled'
);
SELECT ok(
  (SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_assets'::regclass),
  'widget_assets forces RLS'
);

-- ---------------------------------------------------------------------------
-- Function privileges and locked search paths
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege('authenticated', 'public.get_widget_studio_state(uuid)', 'EXECUTE'),
  'authenticated can execute get_widget_studio_state'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.save_widget_studio_draft(uuid,jsonb)', 'EXECUTE'),
  'authenticated can execute save_widget_studio_draft'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.publish_widget_studio(uuid)', 'EXECUTE'),
  'authenticated can execute publish_widget_studio'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.discard_widget_studio_draft(uuid)', 'EXECUTE'),
  'authenticated can execute discard_widget_studio_draft'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.reset_widget_studio_draft(uuid)', 'EXECUTE'),
  'authenticated can execute reset_widget_studio_draft'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_widget_studio_state(uuid)', 'EXECUTE'),
  'anon cannot execute get_widget_studio_state'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.save_widget_studio_draft(uuid,jsonb)', 'EXECUTE'),
  'anon cannot execute save_widget_studio_draft'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.publish_widget_studio(uuid)', 'EXECUTE'),
  'anon cannot execute publish_widget_studio'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.discard_widget_studio_draft(uuid)', 'EXECUTE'),
  'anon cannot execute discard_widget_studio_draft'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.reset_widget_studio_draft(uuid)', 'EXECUTE'),
  'anon cannot execute reset_widget_studio_draft'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.require_widget_studio_manage(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute app_private.require_widget_studio_manage'
);
SELECT ok(
  has_function_privilege('service_role', 'public.widget_resolve_public_key(text)', 'EXECUTE'),
  'service_role can execute widget_resolve_public_key'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.widget_resolve_public_key(text)', 'EXECUTE'),
  'anon cannot execute widget_resolve_public_key'
);

SELECT is(
  (
    SELECT count(*)
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN (
        'widget_appearance_defaults',
        'widget_appearance_from_legacy',
        'require_widget_studio_view',
        'require_widget_studio_manage',
        'validate_widget_appearance',
        'ensure_widget_config',
        'widget_studio_state_payload',
        'widget_public_localized_copy',
        'widget_public_config_payload',
        'widget_public_config',
        'widget_public_config_for_workspace',
        'widget_resolve_public_key',
        'widget_reopen_window_hours'
      )
  ),
  13::bigint,
  'all Widget Studio app_private functions exist'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN (
        'widget_appearance_defaults',
        'widget_appearance_from_legacy',
        'require_widget_studio_view',
        'require_widget_studio_manage',
        'validate_widget_appearance',
        'ensure_widget_config',
        'widget_studio_state_payload',
        'widget_public_localized_copy',
        'widget_public_config_payload',
        'widget_public_config',
        'widget_public_config_for_workspace',
        'widget_resolve_public_key',
        'widget_reopen_window_hours'
      )
      AND NOT COALESCE(p.proconfig @> ARRAY['search_path=""'], false)
  ),
  'all Widget Studio app_private functions set search_path to empty'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_widget_studio_state',
        'save_widget_studio_draft',
        'publish_widget_studio',
        'discard_widget_studio_draft',
        'reset_widget_studio_draft',
        'widget_resolve_public_key'
      )
      AND NOT COALESCE(p.proconfig @> ARRAY['search_path=""'], false)
  ),
  'all Widget Studio public RPCs set search_path to empty'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_widget_studio_state',
        'save_widget_studio_draft',
        'publish_widget_studio',
        'discard_widget_studio_draft',
        'reset_widget_studio_draft',
        'widget_resolve_public_key'
      )
      AND NOT p.prosecdef
  ),
  'all Widget Studio public RPCs are SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- Workspace isolation and asset ownership
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  1,
  'workspace A owner can read workspace A config'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_b')::uuid
  ),
  0,
  'workspace A owner cannot read workspace B config through RLS'
);
SELECT throws_ok(
  format(
    'UPDATE public.widget_configs SET published_version = published_version + 1 WHERE workspace_id = %L::uuid',
    tests.fixture('workspace_b')
  ),
  '42501',
  'permission denied for table widget_configs',
  'authenticated callers cannot update foreign widget configs directly'
);
SELECT throws_ok(
  format(
    'SELECT public.get_widget_studio_state(%L::uuid)',
    tests.fixture('workspace_b')
  ),
  'FORBIDDEN: Workspace not accessible',
  'workspace A owner cannot get workspace B Studio state'
);

SELECT lives_ok(
  format(
    $sql$
      INSERT INTO public.widget_assets (
        workspace_id,
        kind,
        storage_key,
        mime_type,
        byte_size,
        original_filename,
        created_by
      ) VALUES (
        %L::uuid,
        'logo',
        'studio-test/logo.png',
        'image/png',
        128,
        'logo.png',
        %L::uuid
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('owner_a')
  ),
  'workspace A owner can insert a workspace A asset'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'studio-owner-b@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_assets
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'workspace B member cannot see workspace A assets'
);
SELECT is(
  (
    WITH changed AS (
      UPDATE public.widget_assets
      SET original_filename = 'cross-workspace.png'
      WHERE workspace_id = tests.fixture('workspace_a')::uuid
      RETURNING 1
    )
    SELECT count(*)::integer FROM changed
  ),
  0,
  'workspace B member cannot update workspace A assets through RLS'
);

-- ---------------------------------------------------------------------------
-- Viewer and agent role matrix
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'studio-agent-a@test.local'
);

SELECT is(
  public.get_widget_studio_state(tests.fixture('workspace_a')::uuid) ->> 'publishedVersion',
  '1',
  'agent can view Widget Studio state'
);
SELECT throws_ok(
  format(
    'SELECT public.save_widget_studio_draft(%L::uuid, app_private.widget_appearance_defaults())',
    tests.fixture('workspace_a')
  ),
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'agent cannot save Widget Studio draft'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'agent cannot publish Widget Studio'
);

SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'studio-viewer-a@test.local'
);

SELECT throws_ok(
  format(
    'SELECT public.save_widget_studio_draft(%L::uuid, app_private.widget_appearance_defaults())',
    tests.fixture('workspace_a')
  ),
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'viewer cannot save Widget Studio draft'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'viewer cannot publish Widget Studio'
);

-- ---------------------------------------------------------------------------
-- Owner draft/publish behavior and atomic publication
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          app_private.widget_appearance_defaults(),
          '{primaryColor}',
          '"#112233"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a')
  ),
  'owner can save a Widget Studio draft'
);
SELECT is(
  (
    SELECT draft_json ->> 'primaryColor'
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  '#112233',
  'save draft updates draft_json'
);
SELECT is(
  (
    SELECT published_json ->> 'primaryColor'
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  '#0066FF',
  'save draft does not change published_json'
);
SELECT is(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ->> 'primaryColor',
  '#0066FF',
  'public config continues to use published_json before publish'
);

SELECT tests.clear_auth();
SELECT set_config(
  'tests.version_before_publish',
  (
    SELECT published_version::text
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  true
);
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);

SELECT lives_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'owner can publish Widget Studio'
);
SELECT ok(
  (
    SELECT published_json = draft_json
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'publish atomically copies draft_json to published_json'
);
SELECT is(
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  current_setting('tests.version_before_publish')::integer + 1,
  'publish atomically increments published_version by one'
);
SELECT is(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ->> 'primaryColor',
  '#112233',
  'public config reflects the published appearance'
);

-- ---------------------------------------------------------------------------
-- Validation, discard, reset, and admin management
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();
SELECT throws_ok(
  $$
    SELECT app_private.validate_widget_appearance(
      app_private.widget_appearance_defaults()
      || '{"customCss":"body { display: none; }"}'::jsonb
    )
  $$,
  'INVALID_APPEARANCE: customCss and customJS are not allowed.',
  'validate_widget_appearance rejects customCss'
);
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        app_private.widget_appearance_defaults()
        || '{"nested":{"customCss":"* { color: red; }"}}'::jsonb
      )
    $sql$,
    tests.fixture('workspace_a')
  ),
  'INVALID_APPEARANCE: customCss and customJS are not allowed.',
  'save_widget_studio_draft rejects nested customCss'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          app_private.widget_appearance_defaults(),
          '{primaryColor}',
          '"#ABCDEF"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a')
  ),
  'owner can save another unpublished draft'
);
SELECT lives_ok(
  format(
    'SELECT public.discard_widget_studio_draft(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'owner can discard a Widget Studio draft'
);
SELECT ok(
  (
    SELECT draft_json = published_json
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'discard restores draft_json from published_json'
);

SELECT tests.authenticate_as(
  tests.fixture('admin_a')::uuid,
  'studio-admin-a@test.local'
);
SELECT lives_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          app_private.widget_appearance_defaults(),
          '{primaryColor}',
          '"#445566"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a')
  ),
  'admin can save Widget Studio draft'
);
SELECT lives_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'admin can publish Widget Studio'
);
SELECT is(
  (
    SELECT published_json ->> 'primaryColor'
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  '#445566',
  'admin publication persists'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);
SELECT lives_ok(
  format(
    'SELECT public.reset_widget_studio_draft(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'owner can reset Widget Studio draft'
);
SELECT ok(
  (
    SELECT draft_json = app_private.widget_appearance_defaults()
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'reset draft restores canonical defaults'
);
SELECT is(
  (
    SELECT published_json ->> 'primaryColor'
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  '#445566',
  'reset draft does not alter published_json'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_b')
  ),
  'FORBIDDEN: Workspace not accessible',
  'workspace A owner cannot publish workspace B'
);

-- ---------------------------------------------------------------------------
-- Explicit visitor-safe published DTO
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

SELECT ok(
  NOT (
    app_private.widget_public_config_for_workspace(
      tests.fixture('workspace_a')::uuid
    ) ?| ARRAY[
      'draft',
      'billing',
      'ai',
      'crm',
      'secrets',
      'members',
      'draft_json'
    ]
  ),
  'public config excludes draft and sensitive workspace keys'
);
SELECT ok(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ? 'position',
  'public config exposes position'
);
SELECT ok(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ? 'greetingMessage',
  'public config exposes greetingMessage'
);
SELECT ok(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ? 'version',
  'public config exposes version'
);
SELECT is(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config',
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ),
  'public-key resolution returns exactly the published public config'
);

SELECT * FROM finish();
ROLLBACK;
