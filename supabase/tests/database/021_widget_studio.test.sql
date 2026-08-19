\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(114);

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
  v_pending_asset_a uuid;
  v_verified_asset_a uuid;
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

  INSERT INTO public.widget_assets (
    workspace_id,
    kind,
    storage_key,
    mime_type,
    byte_size,
    original_filename,
    created_by
  )
  VALUES (
    v_workspace_a,
    'logo',
    format('workspaces/%s/widget-assets/pending-logo.png', v_workspace_a),
    'image/png',
    128,
    'pending-logo.png',
    v_owner_a
  )
  RETURNING id INTO v_pending_asset_a;

  INSERT INTO public.widget_assets (
    workspace_id,
    kind,
    storage_key,
    mime_type,
    byte_size,
    width,
    height,
    original_filename,
    created_by,
    status,
    verified_at
  )
  VALUES (
    v_workspace_a,
    'agent_avatar',
    format('workspaces/%s/widget-assets/verified-avatar.webp', v_workspace_a),
    'image/webp',
    256,
    64,
    64,
    'verified-avatar.webp',
    v_owner_a,
    'verified',
    now()
  )
  RETURNING id INTO v_verified_asset_a;

  INSERT INTO tests.fixtures (key, value)
  VALUES
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('public_key_a', v_public_key_a),
    ('pending_asset_a', v_pending_asset_a::text),
    ('verified_asset_a', v_verified_asset_a::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema, constraints, indexes, and RLS
-- ---------------------------------------------------------------------------

SELECT has_table('public', 'widget_configs', 'widget_configs table exists');
SELECT has_table('public', 'widget_assets', 'widget_assets table exists');

SELECT has_column('public', 'widget_configs', 'workspace_id', 'widget_configs.workspace_id exists');
SELECT has_column('public', 'widget_configs', 'draft_json', 'widget_configs.draft_json exists');
SELECT has_column('public', 'widget_configs', 'published_json', 'widget_configs.published_json exists');
SELECT has_column(
  'public',
  'widget_configs',
  'published_version',
  'widget_configs.published_version exists'
);
SELECT has_column(
  'public',
  'widget_configs',
  'draft_updated_at',
  'widget_configs.draft_updated_at exists'
);
SELECT has_column('public', 'widget_configs', 'published_at', 'widget_configs.published_at exists');
SELECT has_column('public', 'widget_configs', 'published_by', 'widget_configs.published_by exists');
SELECT has_column(
  'public',
  'widget_configs',
  'draft_updated_by',
  'widget_configs.draft_updated_by exists'
);
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
SELECT has_column(
  'public',
  'widget_assets',
  'original_filename',
  'widget_assets.original_filename exists'
);
SELECT has_column('public', 'widget_assets', 'created_by', 'widget_assets.created_by exists');
SELECT has_column('public', 'widget_assets', 'created_at', 'widget_assets.created_at exists');
SELECT has_column('public', 'widget_assets', 'updated_at', 'widget_assets.updated_at exists');
SELECT has_column('public', 'widget_assets', 'deleted_at', 'widget_assets.deleted_at exists');
SELECT has_column('public', 'widget_assets', 'status', 'widget_assets.status exists');
SELECT has_column('public', 'widget_assets', 'verified_at', 'widget_assets.verified_at exists');

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint c
    WHERE c.conrelid = 'public.widget_assets'::regclass
      AND c.conname = 'chk_widget_assets_storage_key_workspace'
      AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%workspace_id%'
  ),
  'widget_assets has a workspace-prefixed storage_key check constraint'
);

SELECT has_index(
  'public',
  'widget_configs',
  'widget_configs_pkey',
  'widget_configs primary-key index exists'
);
SELECT has_index(
  'public',
  'widget_assets',
  'widget_assets_pkey',
  'widget_assets primary-key index exists'
);
SELECT has_index(
  'public',
  'widget_assets',
  'idx_widget_assets_workspace',
  'widget_assets workspace index exists'
);
SELECT has_index(
  'public',
  'widget_assets',
  'idx_widget_assets_workspace_kind',
  'widget_assets active-kind index exists'
);
SELECT has_index(
  'public',
  'widget_assets',
  'uq_widget_assets_workspace_storage_key',
  'widget_assets workspace storage-key unique index exists'
);
SELECT has_index(
  'public',
  'widget_assets',
  'idx_widget_assets_workspace_verified',
  'widget_assets verified-asset lookup index exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_configs'::regclass),
  'widget_configs has RLS enabled'
);
SELECT ok(
  (
    SELECT relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.widget_configs'::regclass
  ),
  'widget_configs forces RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.widget_assets'::regclass),
  'widget_assets has RLS enabled'
);
SELECT ok(
  (
    SELECT relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.widget_assets'::regclass
  ),
  'widget_assets forces RLS'
);

-- ---------------------------------------------------------------------------
-- Least-privilege table and function boundaries
-- ---------------------------------------------------------------------------

SELECT ok(
  has_table_privilege('authenticated', 'public.widget_assets', 'SELECT'),
  'authenticated has SELECT on widget_assets'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.widget_assets', 'INSERT'),
  'authenticated has no INSERT on widget_assets'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.widget_assets', 'UPDATE'),
  'authenticated has no UPDATE on widget_assets'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.widget_assets', 'DELETE'),
  'authenticated has no DELETE on widget_assets'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.widget_assets', 'width', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.widget_assets', 'height', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.widget_assets', 'status', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.widget_assets', 'verified_at', 'UPDATE')
    AND NOT has_column_privilege('authenticated', 'public.widget_assets', 'storage_key', 'UPDATE'),
  'authenticated cannot update asset dimensions, verification state, or storage_key'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.widget_assets', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.widget_assets', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.widget_assets', 'DELETE'),
  'anon cannot mutate widget_assets'
);
SELECT ok(
  has_table_privilege('service_role', 'public.widget_assets', 'INSERT'),
  'service_role has INSERT on widget_assets'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.get_widget_studio_state(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute get_widget_studio_state'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.save_widget_studio_draft(uuid,jsonb)',
    'EXECUTE'
  ),
  'authenticated can execute save_widget_studio_draft'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.publish_widget_studio(uuid,integer)',
    'EXECUTE'
  ),
  'authenticated can execute CAS publish_widget_studio'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.discard_widget_studio_draft(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute discard_widget_studio_draft'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.reset_widget_studio_draft(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute reset_widget_studio_draft'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.save_widget_studio_draft(uuid,jsonb)',
    'EXECUTE'
  )
    AND NOT has_function_privilege(
      'anon',
      'public.publish_widget_studio(uuid,integer)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.discard_widget_studio_draft(uuid)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'anon',
      'public.reset_widget_studio_draft(uuid)',
      'EXECUTE'
    ),
  'anon cannot execute Widget Studio mutation RPCs'
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
  has_function_privilege(
    'service_role',
    'public.widget_resolve_public_key(text)',
    'EXECUTE'
  ),
  'service_role can execute widget_resolve_public_key'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.widget_resolve_public_key(text)',
    'EXECUTE'
  ),
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
        'widget_reopen_window_hours',
        'widget_assets_protect_immutable_fields'
      )
  ),
  14::bigint,
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
        'widget_reopen_window_hours',
        'widget_assets_protect_immutable_fields'
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
      AND (
        NOT p.prosecdef
        OR NOT COALESCE(p.proconfig @> ARRAY['search_path=""'], false)
      )
  ),
  'all Widget Studio public RPCs are SECURITY DEFINER with empty search_path'
);

-- ---------------------------------------------------------------------------
-- Asset mutation denial, trusted seeding, and tenant isolation
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
    'SELECT public.get_widget_studio_state(%L::uuid)',
    tests.fixture('workspace_b')
  ),
  'P0001',
  'Workspace not accessible',
  'workspace A owner cannot get workspace B Studio state'
);

SELECT throws_ok(
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
        'workspaces/%s/widget-assets/authenticated-forge.png',
        'image/png',
        64,
        'authenticated-forge.png',
        %L::uuid
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a'),
    tests.fixture('owner_a')
  ),
  '42501',
  'permission denied for table widget_assets',
  'authenticated owner cannot insert widget_assets rows'
);
SELECT throws_ok(
  format(
    $sql$
      UPDATE public.widget_assets
      SET
        width = 128,
        height = 128,
        status = 'verified',
        verified_at = now(),
        storage_key = 'workspaces/%s/widget-assets/authenticated-rewrite.png'
      WHERE id = %L::uuid
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('pending_asset_a')
  ),
  '42501',
  'permission denied for table widget_assets',
  'authenticated owner cannot forge asset metadata or storage_key'
);

SELECT tests.clear_auth();
SELECT set_config('role', 'anon', true);
SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.widget_assets (
        workspace_id,
        kind,
        storage_key,
        mime_type,
        byte_size,
        original_filename
      ) VALUES (
        %L::uuid,
        'logo',
        'workspaces/%s/widget-assets/anon-forge.png',
        'image/png',
        64,
        'anon-forge.png'
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  '42501',
  'permission denied for table widget_assets',
  'anon insert into widget_assets is denied'
);

SELECT tests.clear_auth();
SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.widget_assets (
        workspace_id,
        kind,
        storage_key,
        mime_type,
        byte_size,
        original_filename
      ) VALUES (
        %L::uuid,
        'logo',
        'workspaces/%s/widget-assets/wrong-workspace.png',
        'image/png',
        64,
        'wrong-workspace.png'
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_b')
  ),
  'P0001',
  'INVALID_STORAGE_KEY: storage_key must be scoped to the asset workspace.',
  'trusted insert still rejects a storage_key with the wrong workspace prefix'
);

SELECT set_config('role', 'service_role', true);
SELECT lives_ok(
  format(
    $sql$
      INSERT INTO public.widget_assets (
        workspace_id,
        kind,
        storage_key,
        mime_type,
        byte_size,
        original_filename
      ) VALUES (
        %L::uuid,
        'launcher_icon',
        'workspaces/%s/widget-assets/service-role-pending.webp',
        'image/webp',
        96,
        'service-role-pending.webp'
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'service_role can insert trusted widget asset metadata'
);

SELECT tests.clear_auth();
SELECT throws_ok(
  format(
    $sql$
      UPDATE public.widget_assets
      SET storage_key = 'workspaces/%s/widget-assets/renamed.png'
      WHERE id = %L::uuid
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('pending_asset_a')
  ),
  'P0001',
  'FORBIDDEN: widget_assets.storage_key is immutable.',
  'storage_key remains immutable even for a privileged update'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.widget_assets
    WHERE id = tests.fixture('pending_asset_a')::uuid
      AND status = 'pending'
      AND verified_at IS NULL
      AND width IS NULL
      AND height IS NULL
  ),
  'pending assets remain explicitly unverified for public-enrichment exclusion'
);
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.widget_assets
    WHERE id = tests.fixture('verified_asset_a')::uuid
      AND status = 'verified'
      AND verified_at IS NOT NULL
      AND width = 64
      AND height = 64
  ),
  'verified assets are distinguishable from pending assets'
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
  'workspace B owner cannot select workspace A assets'
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
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        public.get_widget_studio_state(%L::uuid) -> 'draft'
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'agent cannot save Widget Studio draft'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'P0001',
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'agent cannot publish Widget Studio'
);

SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'studio-viewer-a@test.local'
);
SELECT is(
  public.get_widget_studio_state(tests.fixture('workspace_a')::uuid) ->> 'publishedVersion',
  '1',
  'viewer can view Widget Studio state'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        public.get_widget_studio_state(%L::uuid) -> 'draft'
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'viewer cannot save Widget Studio draft'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'P0001',
  'FORBIDDEN: Only owners and admins can manage Widget Studio.',
  'viewer cannot publish Widget Studio'
);

-- ---------------------------------------------------------------------------
-- Draft, publish CAS, discard, reset, and monotonic version lifecycle
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);
SELECT set_config(
  'tests.initial_published_version',
  (
    SELECT published_version::text
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  true
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{primaryColor}',
          '"#112233"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
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
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  current_setting('tests.initial_published_version')::integer,
  'save draft does not change published_version'
);

SELECT tests.clear_auth();
SELECT is(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ->> 'primaryColor',
  '#0066FF',
  'workspace public config reads published_json before publish'
);
SELECT is(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config' ->> 'primaryColor',
  '#0066FF',
  'public-key resolution reads published_json before publish'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid, %s)',
    tests.fixture('workspace_a'),
    current_setting('tests.initial_published_version')::integer + 100
  ),
  'P0001',
  'PUBLISH_CONFLICT: Widget Studio publish version mismatch.',
  'publish with the wrong expected version raises PUBLISH_CONFLICT'
);
SELECT is(
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  current_setting('tests.initial_published_version')::integer,
  'failed CAS publish leaves published_version unchanged'
);
SELECT lives_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid, %s)',
    tests.fixture('workspace_a'),
    current_setting('tests.initial_published_version')::integer
  ),
  'publish with the correct expected version succeeds'
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
  current_setting('tests.initial_published_version')::integer + 1,
  'publish atomically increments published_version by one'
);

SELECT tests.clear_auth();
SELECT is(
  app_private.widget_public_config_for_workspace(
    tests.fixture('workspace_a')::uuid
  ) ->> 'primaryColor',
  '#112233',
  'workspace public config reflects the newly published appearance'
);
SELECT is(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config' ->> 'primaryColor',
  '#112233',
  'public-key resolution reflects the newly published appearance'
);
SELECT is(
  (
    app_private.widget_public_config_for_workspace(
      tests.fixture('workspace_a')::uuid
    ) ->> 'version'
  )::integer,
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'public config version matches published_version'
);

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
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{primaryColor}',
          '"#ABCDEF"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
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
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{primaryColor}',
          '"#445566"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'admin can save Widget Studio draft'
);
SELECT set_config(
  'tests.version_before_admin_publish',
  (
    SELECT published_version::text
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  true
);
SELECT lives_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid, %s)',
    tests.fixture('workspace_a'),
    current_setting('tests.version_before_admin_publish')::integer
  ),
  'admin can publish with the current expected version'
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
SELECT is(
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  current_setting('tests.version_before_admin_publish')::integer + 1,
  'published_version increases monotonically on a later publish'
);
SELECT set_config(
  'tests.version_after_admin_publish',
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
    'SELECT public.reset_widget_studio_draft(%L::uuid)',
    tests.fixture('workspace_a')
  ),
  'owner can reset Widget Studio draft'
);
SELECT tests.clear_auth();
SELECT ok(
  (
    SELECT draft_json = app_private.widget_appearance_defaults()
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'reset restores canonical defaults to draft_json'
);
SELECT is(
  (
    SELECT published_json ->> 'primaryColor'
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  '#445566',
  'reset does not alter published_json'
);
SELECT is(
  (
    SELECT published_version
    FROM public.widget_configs
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  current_setting('tests.version_after_admin_publish')::integer,
  'reset does not alter published_version'
);

-- ---------------------------------------------------------------------------
-- Direct RPC validation parity with the strict appearance schema
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{widgetWidth}',
          '9999'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: widgetWidth must be between 300 and 480.',
  'save_widget_studio_draft rejects oversized widgetWidth'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{widgetHeight}',
          '9999'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: widgetHeight must be between 360 and 800.',
  'save_widget_studio_draft rejects oversized widgetHeight'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{fontFamily}',
          '"comic-sans"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: invalid fontFamily.',
  'save_widget_studio_draft rejects an unapproved fontFamily'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{launcherShape}',
          '"triangle"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: invalid launcherShape.',
  'save_widget_studio_draft rejects an illegal launcherShape enum'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        (public.get_widget_studio_state(%L::uuid) -> 'draft')
          || '{"unexpected":true}'::jsonb
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: unknown key unexpected is not allowed.',
  'save_widget_studio_draft rejects unknown top-level keys'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        jsonb_set(
          public.get_widget_studio_state(%L::uuid) -> 'draft',
          '{logoAssetId}',
          '"not-a-uuid"'::jsonb
        )
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: logoAssetId must be a UUID or null.',
  'save_widget_studio_draft rejects invalid asset UUID text'
);
SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_widget_studio_draft(
        %L::uuid,
        (public.get_widget_studio_state(%L::uuid) -> 'draft')
          || '{"nested":{"customCss":"* { display: none; }"}}'::jsonb
      )
    $sql$,
    tests.fixture('workspace_a'),
    tests.fixture('workspace_a')
  ),
  'P0001',
  'INVALID_APPEARANCE: customCss and customJS are not allowed.',
  'save_widget_studio_draft rejects nested customCss'
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
      'draft_json',
      'storage_key'
    ]
  ),
  'workspace public config excludes draft, sensitive, and storage keys'
);
SELECT ok(
  NOT (
    app_private.widget_resolve_public_key(
      tests.fixture('public_key_a')
    ) -> 'config' ?| ARRAY[
      'draft',
      'billing',
      'ai',
      'crm',
      'secrets',
      'members',
      'draft_json',
      'storage_key'
    ]
  ),
  'public-key config excludes draft, sensitive, and storage keys'
);
SELECT ok(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config' ? 'position',
  'public-key config exposes position'
);
SELECT ok(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config' ? 'greetingMessage',
  'public-key config exposes greetingMessage'
);
SELECT ok(
  app_private.widget_resolve_public_key(
    tests.fixture('public_key_a')
  ) -> 'config' ? 'version',
  'public-key config exposes version'
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

-- ---------------------------------------------------------------------------
-- Cross-workspace mutation denial uses the actual access exception
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'studio-owner-a@test.local'
);
SELECT throws_ok(
  format(
    'SELECT public.publish_widget_studio(%L::uuid, NULL)',
    tests.fixture('workspace_b')
  ),
  'P0001',
  'Workspace not accessible',
  'workspace A owner cannot publish workspace B'
);

SELECT * FROM finish();
ROLLBACK;
