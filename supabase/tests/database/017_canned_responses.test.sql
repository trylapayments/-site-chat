\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(151);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_admin_a uuid;
  v_agent_a uuid;
  v_agent_b uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_owner_member_a uuid;
  v_admin_member_a uuid;
  v_agent_member_a uuid;
  v_agent_member_b uuid;
  v_viewer_member_a uuid;
BEGIN
  v_owner_a := tests.create_auth_user('canned-owner-a@test.local');
  v_admin_a := tests.create_auth_user('canned-admin-a@test.local');
  v_agent_a := tests.create_auth_user('canned-agent-a@test.local');
  v_agent_b := tests.create_auth_user('canned-agent-b@test.local');
  v_viewer_a := tests.create_auth_user('canned-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('canned-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'canned-owner-a@test.local');
  PERFORM public.create_workspace('Canned Workspace A', 'canned-workspace-a');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'canned-owner-b@test.local');
  PERFORM public.create_workspace('Canned Workspace B', 'canned-workspace-b');
  PERFORM tests.clear_auth();

  SELECT id INTO v_workspace_a FROM public.workspaces WHERE slug = 'canned-workspace-a';
  SELECT id INTO v_workspace_b FROM public.workspaces WHERE slug = 'canned-workspace-b';

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_admin_a, 'admin', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_agent_b, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  SELECT id INTO v_owner_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_owner_a;
  SELECT id INTO v_admin_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_admin_a;
  SELECT id INTO v_agent_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;
  SELECT id INTO v_agent_member_b FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_b;
  SELECT id INTO v_viewer_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_viewer_a;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('agent_b', v_agent_b::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('owner_member_a', v_owner_member_a::text),
    ('admin_member_a', v_admin_member_a::text),
    ('agent_member_a', v_agent_member_a::text),
    ('agent_member_b', v_agent_member_b::text),
    ('viewer_member_a', v_viewer_member_a::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------

SELECT has_table('public', 'canned_responses', 'canned_responses exists');
SELECT has_table('public', 'canned_response_folders', 'canned_response_folders exists');
SELECT has_table('public', 'canned_response_favorites', 'canned_response_favorites exists');

SELECT has_enum('public', 'app_canned_visibility', 'app_canned_visibility enum exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm' AND n.nspname = 'extensions'
  ),
  'pg_trgm installed in extensions schema'
);

SELECT is(
  (SELECT count(*)::int FROM pg_class
   WHERE relname IN ('canned_responses', 'canned_response_folders', 'canned_response_favorites')
     AND relkind = 'r'
     AND relreplident = 'f'),
  3,
  'all canned tables use REPLICA IDENTITY FULL'
);

SELECT is(
  (SELECT count(*)::int FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename IN ('canned_responses', 'canned_response_folders', 'canned_response_favorites')),
  3,
  'all canned tables are in supabase_realtime'
);

SELECT has_index('public', 'canned_responses', 'uq_canned_responses_workspace_shortcut',
  'shared shortcut partial unique index exists');
SELECT has_index('public', 'canned_responses', 'uq_canned_responses_personal_shortcut',
  'personal shortcut partial unique index exists');
SELECT has_index('public', 'canned_responses', 'idx_canned_responses_search_vector',
  'FTS index exists');
SELECT has_index('public', 'canned_responses', 'idx_canned_responses_trgm',
  'trigram index exists');
SELECT has_index('public', 'canned_responses', 'idx_canned_responses_tombstones',
  'snippet tombstone index exists');
SELECT has_index('public', 'canned_response_folders', 'idx_canned_response_folders_tombstones',
  'folder tombstone index exists');

-- ---------------------------------------------------------------------------
-- Privilege matrix
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege('authenticated', 'public.list_canned_responses(uuid, jsonb)', 'execute'),
  'authenticated can execute list_canned_responses'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_canned_response(uuid, text, text, text, text, uuid)',
    'execute'
  ),
  'authenticated can execute create_canned_response'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.update_canned_response(uuid, uuid, text, text, text, uuid)',
    'execute'
  ),
  'authenticated can execute update_canned_response'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.soft_delete_canned_response(uuid, uuid)', 'execute'),
  'authenticated can execute soft_delete_canned_response'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.get_canned_response(uuid, uuid)', 'execute'),
  'authenticated can execute get_canned_response'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.list_canned_response_folders(uuid, jsonb)', 'execute'),
  'authenticated can execute list_canned_response_folders'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_canned_response_folder(uuid, text, text, integer)',
    'execute'
  ),
  'authenticated can execute create_canned_response_folder'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.update_canned_response_folder(uuid, uuid, text, integer)',
    'execute'
  ),
  'authenticated can execute update_canned_response_folder'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.soft_delete_canned_response_folder(uuid, uuid)',
    'execute'
  ),
  'authenticated can execute soft_delete_canned_response_folder'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.set_canned_response_favorite(uuid, uuid, boolean)',
    'execute'
  ),
  'authenticated can execute set_canned_response_favorite'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.record_canned_response_usage(uuid, uuid)', 'execute'),
  'authenticated can execute record_canned_response_usage'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.list_canned_responses(uuid, jsonb)', 'execute'),
  'anon cannot execute list_canned_responses'
);
SELECT ok(
  NOT has_function_privilege(
    'public',
    'public.create_canned_response(uuid, text, text, text, text, uuid)',
    'execute'
  ),
  'PUBLIC cannot execute create_canned_response'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.create_canned_response(uuid, text, text, text, text, uuid)',
    'execute'
  ),
  'authenticated cannot execute app_private.create_canned_response'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.require_workspace_canned_manage(uuid)',
    'execute'
  ),
  'authenticated cannot execute app_private.require_workspace_canned_manage'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app_private.list_canned_responses(uuid, jsonb)', 'execute'),
  'anon cannot execute app_private.list_canned_responses'
);
SELECT ok(
  has_function_privilege('authenticated', 'app_private.get_caller_member_id(uuid)', 'execute'),
  'authenticated retains get_caller_member_id'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.canned_responses', 'select'),
  'authenticated can select canned_responses'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.canned_responses', 'insert'),
  'authenticated cannot insert canned_responses'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.canned_responses', 'update'),
  'authenticated cannot update canned_responses'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.canned_response_folders', 'delete'),
  'authenticated cannot delete canned_response_folders'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.canned_responses', 'select'),
  'anon cannot select canned_responses'
);

-- ---------------------------------------------------------------------------
-- Shortcut normalization
-- ---------------------------------------------------------------------------

SELECT is(
  app_private.normalize_canned_shortcut('  /Greeting '),
  'greeting',
  'shortcut is trimmed, slash-stripped and lowercased'
);
SELECT is(
  app_private.normalize_canned_shortcut('   '),
  NULL,
  'blank shortcut normalizes to NULL'
);
SELECT throws_like(
  $$ SELECT app_private.normalize_canned_shortcut('bad shortcut!') $$,
  '%INVALID_SHORTCUT%',
  'shortcut rejects spaces and punctuation'
);
SELECT throws_like(
  $$ SELECT app_private.normalize_canned_shortcut('-leading') $$,
  '%INVALID_SHORTCUT%',
  'shortcut must start with a letter or digit'
);

-- ---------------------------------------------------------------------------
-- Create: shared library is owner/admin only
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'canned-owner-a@test.local'); $$,
  'authenticate owner A'
);

SELECT is(
  public.create_canned_response(
    tests.fixture('workspace_a')::uuid,
    '  Greeting  ',
    'Hi {{visitor.name}}, thanks for reaching out. I will take a look and get back to you shortly.',
    '/Greeting',
    'workspace',
    NULL
  ) ->> 'shortcut',
  'greeting',
  'owner creates a shared snippet with a normalized shortcut'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, '   ', 'body', NULL, 'workspace', NULL);
  $$,
  '%INVALID_TITLE%',
  'blank title is rejected'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Title', '  ', NULL, 'workspace', NULL);
  $$,
  '%INVALID_BODY%',
  'blank body is rejected'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Title', repeat('x', 4001), NULL, 'workspace', NULL);
  $$,
  '%INVALID_BODY%',
  'oversized body is rejected'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Title', 'body', NULL, 'secret', NULL);
  $$,
  '%INVALID_VISIBILITY%',
  'unknown visibility is rejected'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Dup', 'body', 'greeting', 'workspace', NULL);
  $$,
  '%SHORTCUT_TAKEN%',
  'duplicate shared shortcut is rejected'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'shared_1', id::text
FROM public.canned_responses
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND shortcut = 'greeting'
  AND visibility = 'workspace';

SELECT is(
  (SELECT owner_member_id FROM public.canned_responses
   WHERE id = tests.fixture('shared_1')::uuid),
  NULL,
  'shared snippet has no owner'
);

SELECT is(
  (SELECT created_by FROM public.canned_responses WHERE id = tests.fixture('shared_1')::uuid),
  tests.fixture('owner_member_a')::uuid,
  'created_by records the author member'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Agent shared', 'body', NULL, 'workspace', NULL);
  $$,
  '%FORBIDDEN%',
  'agent cannot create a shared snippet'
);

-- ---------------------------------------------------------------------------
-- Personal snippets belong to the caller
-- ---------------------------------------------------------------------------

SELECT is(
  public.create_canned_response(
    tests.fixture('workspace_a')::uuid,
    'My refund reply',
    'Refund is on the way.',
    'refund',
    'personal',
    NULL
  ) ->> 'owner_member_id',
  tests.fixture('agent_member_a'),
  'personal snippet is owned by the caller'
);

SELECT is(
  public.create_canned_response(
    tests.fixture('workspace_a')::uuid,
    'My greeting',
    'Hi there!',
    'greeting',
    'personal',
    NULL
  ) ->> 'shortcut',
  'greeting',
  'a personal shortcut may shadow a shared one'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Dup personal', 'body', 'greeting', 'personal', NULL);
  $$,
  '%SHORTCUT_TAKEN%',
  'duplicate personal shortcut is rejected for the same member'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'personal_1', id::text
FROM public.canned_responses
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND shortcut = 'refund';

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_b')::uuid, 'canned-agent-b@test.local'); $$,
  'authenticate agent B'
);

SELECT is(
  public.create_canned_response(
    tests.fixture('workspace_a')::uuid,
    'Other greeting',
    'Yo!',
    'greeting',
    'personal',
    NULL
  ) ->> 'shortcut',
  'greeting',
  'two members may hold the same personal shortcut'
);

SELECT throws_like(
  $$
    SELECT public.get_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid);
  $$,
  '%CANNED_NOT_FOUND%',
  'another member cannot read a personal snippet'
);

SELECT throws_like(
  $$
    SELECT public.update_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid,
      'Hijack', 'body', NULL, NULL);
  $$,
  '%CANNED_NOT_FOUND%',
  'another member cannot edit a personal snippet'
);

SELECT throws_like(
  $$
    SELECT public.set_canned_response_favorite(
      tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid, true);
  $$,
  '%CANNED_NOT_FOUND%',
  'another member cannot favorite a personal snippet'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Viewers may read but never use
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('viewer_a')::uuid, 'canned-viewer-a@test.local'); $$,
  'authenticate viewer'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'items'
  ),
  1,
  'viewer lists shared snippets only'
);

SELECT throws_like(
  $$
    SELECT public.set_canned_response_favorite(
      tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid, true);
  $$,
  '%FORBIDDEN%',
  'viewer cannot favorite'
);

SELECT throws_like(
  $$
    SELECT public.record_canned_response_usage(
      tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid);
  $$,
  '%FORBIDDEN%',
  'viewer cannot record usage'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Viewer personal', 'body', NULL, 'personal', NULL);
  $$,
  '%FORBIDDEN%',
  'viewer cannot create a personal snippet'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Folders and scope matching
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('admin_a')::uuid, 'canned-admin-a@test.local'); $$,
  'authenticate admin A'
);

SELECT is(
  public.create_canned_response_folder(
    tests.fixture('workspace_a')::uuid, ' Billing ', 'workspace', 10
  ) ->> 'name',
  'Billing',
  'admin creates a shared folder with a trimmed name'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response_folder(
      tests.fixture('workspace_a')::uuid, '   ', 'workspace', 0);
  $$,
  '%INVALID_NAME%',
  'blank folder name is rejected'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response_folder(
      tests.fixture('workspace_a')::uuid, 'Way out', 'workspace', 999999);
  $$,
  '%INVALID_SORT_ORDER%',
  'out-of-range sort_order is rejected'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'folder_shared', id::text
FROM public.canned_response_folders
WHERE workspace_id = tests.fixture('workspace_a')::uuid AND name = 'Billing';

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A for folders'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response_folder(
      tests.fixture('workspace_a')::uuid, 'Agent shared', 'workspace', 0);
  $$,
  '%FORBIDDEN%',
  'agent cannot create a shared folder'
);

SELECT is(
  public.create_canned_response_folder(
    tests.fixture('workspace_a')::uuid, 'Mine', 'personal', 0
  ) ->> 'owner_member_id',
  tests.fixture('agent_member_a'),
  'agent creates a personal folder owned by themselves'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Scoped', 'body', NULL, 'personal',
      tests.fixture('folder_shared')::uuid);
  $$,
  '%FOLDER_SCOPE_MISMATCH%',
  'personal snippet cannot join a shared folder'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Scoped', 'body', NULL, 'personal', gen_random_uuid());
  $$,
  '%FOLDER_NOT_FOUND%',
  'unknown folder is rejected'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'folder_personal', id::text
FROM public.canned_response_folders
WHERE workspace_id = tests.fixture('workspace_a')::uuid AND name = 'Mine';

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_b')::uuid, 'canned-agent-b@test.local'); $$,
  'authenticate agent B for folder scope'
);

SELECT throws_like(
  $$
    SELECT public.create_canned_response(
      tests.fixture('workspace_a')::uuid, 'Scoped', 'body', NULL, 'personal',
      tests.fixture('folder_personal')::uuid);
  $$,
  '%FOLDER_SCOPE_MISMATCH%',
  'a member cannot file into another member''s personal folder'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Update
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'canned-owner-a@test.local'); $$,
  'authenticate owner A for update'
);

SELECT is(
  public.update_canned_response(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('shared_1')::uuid,
    'Greeting',
    'Hi {{visitor.name}}, thanks for reaching out. I will take a look and get back to you shortly.',
    'greeting',
    tests.fixture('folder_shared')::uuid
  ) ->> 'folder_id',
  tests.fixture('folder_shared'),
  'shared snippet is filed into a shared folder'
);

SELECT is(
  (SELECT updated_by FROM public.canned_responses WHERE id = tests.fixture('shared_1')::uuid),
  tests.fixture('owner_member_a')::uuid,
  'update records updated_by'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'shared_1_updated_at', updated_at::text
FROM public.canned_responses
WHERE id = tests.fixture('shared_1')::uuid;

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'canned-owner-a@test.local'); $$,
  'authenticate owner A for no-op update'
);

SELECT lives_ok(
  $$
    SELECT public.update_canned_response(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('shared_1')::uuid,
      'Greeting',
      'Hi {{visitor.name}}, thanks for reaching out. I will take a look and get back to you shortly.',
      'greeting',
      tests.fixture('folder_shared')::uuid);
  $$,
  'identical update succeeds'
);

SELECT tests.clear_auth();

SELECT is(
  (SELECT updated_at::text FROM public.canned_responses
   WHERE id = tests.fixture('shared_1')::uuid),
  tests.fixture('shared_1_updated_at'),
  'identical update does not bump updated_at'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A for shared update'
);

SELECT throws_like(
  $$
    SELECT public.update_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid,
      'Hijack', 'body', NULL, NULL);
  $$,
  '%FORBIDDEN%',
  'agent cannot edit a shared snippet'
);

SELECT throws_like(
  $$
    SELECT public.soft_delete_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid);
  $$,
  '%FORBIDDEN%',
  'agent cannot delete a shared snippet'
);

-- ---------------------------------------------------------------------------
-- Favorites and usage
-- ---------------------------------------------------------------------------

SELECT is(
  (public.set_canned_response_favorite(
    tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid, true
  ) ->> 'is_favorited')::boolean,
  true,
  'agent favorites a shared snippet'
);

SELECT is(
  (public.set_canned_response_favorite(
    tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid, true
  ) ->> 'is_favorited')::boolean,
  true,
  'favoriting twice is idempotent'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_favorites
   WHERE canned_response_id = tests.fixture('shared_1')::uuid),
  1,
  'favorite is stored exactly once'
);

SELECT is(
  (public.record_canned_response_usage(
    tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid
  ) ->> 'usage_count')::int,
  1,
  'usage_count increments'
);

SELECT tests.clear_auth();

SELECT is(
  (SELECT updated_at::text FROM public.canned_responses
   WHERE id = tests.fixture('shared_1')::uuid),
  tests.fixture('shared_1_updated_at'),
  'usage_count bump does not touch updated_at'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_b')::uuid, 'canned-agent-b@test.local'); $$,
  'authenticate agent B for favorite isolation'
);

SELECT is(
  (public.get_canned_response(
    tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid
  ) ->> 'is_favorited')::boolean,
  false,
  'favorites are per member'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Listing, filters and search
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A for listing'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'items'
  ),
  3,
  'agent sees shared snippets plus their own personal ones'
);

SELECT is(
  (SELECT count(*)::int
   FROM jsonb_array_elements(
     public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'items'
   ) e
   WHERE e ->> 'visibility' = 'personal'
     AND e ->> 'owner_member_id' <> tests.fixture('agent_member_a')),
  0,
  'no foreign personal snippet leaks into the list'
);

SELECT ok(
  public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) ? 'folders',
  'folders are included by default'
);

SELECT ok(
  NOT (
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"include_folders": false}'::jsonb
    ) ? 'folders'
  ),
  'folders can be omitted'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'folders'
  ),
  2,
  'agent sees the shared folder plus their own personal folder'
);

SELECT is(
  (public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb)
    -> 'items' -> 0 ->> 'is_favorited')::boolean,
  true,
  'favorites sort first when not searching'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"visibility": "workspace"}'::jsonb
    ) -> 'items'
  ),
  1,
  'workspace visibility filter'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"visibility": "personal"}'::jsonb
    ) -> 'items'
  ),
  2,
  'personal visibility filter'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"favorites_only": true}'::jsonb
    ) -> 'items'
  ),
  1,
  'favorites_only filter'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"folder_id": "none"}'::jsonb
    ) -> 'items'
  ),
  2,
  'unfiled filter'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('folder_id', tests.fixture('folder_shared'))
    ) -> 'items'
  ),
  1,
  'folder filter'
);

SELECT throws_like(
  $$
    SELECT public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"folder_id": "nope"}'::jsonb);
  $$,
  '%INVALID_QUERY%',
  'folder_id must be a uuid or "none"'
);

SELECT throws_like(
  $$
    SELECT public.list_canned_responses(tests.fixture('workspace_a')::uuid, '[]'::jsonb);
  $$,
  '%INVALID_QUERY%',
  'query must be an object'
);

SELECT throws_like(
  $$
    SELECT public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"visibility": "nope"}'::jsonb);
  $$,
  '%INVALID_VISIBILITY%',
  'unknown visibility filter is rejected'
);

-- Guards the word_similarity (<%) choice: whole-string similarity() scores this
-- typo at ~0.07 against a realistic multi-sentence body and would never match.
SELECT ok(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"q": "gretting"}'::jsonb
    ) -> 'items'
  ) > 0,
  'a misspelled query matches a long body through trigram word similarity'
);

SELECT is(
  public.list_canned_responses(
    tests.fixture('workspace_a')::uuid, '{"q": "/refund"}'::jsonb
  ) -> 'items' -> 0 ->> 'id',
  tests.fixture('personal_1'),
  'an exact shortcut match ranks first even with the typed slash'
);

SELECT ok(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"q": "/ref"}'::jsonb
    ) -> 'items'
  ) > 0,
  'a shortcut prefix matches for autocomplete'
);

SELECT ok(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"q": "refund is on the way"}'::jsonb
    ) -> 'items'
  ) > 0,
  'body text matches through full-text search'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid, '{"q": "%"}'::jsonb
    ) -> 'items'
  ),
  0,
  'LIKE metacharacters in the query are escaped'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Cross-tenant isolation
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_b')::uuid, 'canned-owner-b@test.local'); $$,
  'authenticate owner B'
);

SELECT throws_like(
  $$
    SELECT public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb);
  $$,
  '%not accessible%',
  'a foreign workspace cannot be listed'
);

SELECT throws_like(
  $$
    SELECT public.get_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('shared_1')::uuid);
  $$,
  '%not accessible%',
  'a foreign workspace snippet cannot be read'
);

SELECT throws_like(
  $$
    SELECT public.get_canned_response(
      tests.fixture('workspace_b')::uuid, tests.fixture('shared_1')::uuid);
  $$,
  '%CANNED_NOT_FOUND%',
  'a snippet id from another workspace is not found in your own'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses),
  0,
  'RLS hides every foreign-workspace snippet from a direct select'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- RLS visibility for members
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A for RLS'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses),
  3,
  'RLS exposes shared snippets plus the caller''s own personal snippets'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_folders),
  2,
  'RLS exposes the shared folder plus the caller''s own personal folder'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_favorites),
  1,
  'RLS exposes only the caller''s favorites'
);

SELECT throws_like(
  $$
    INSERT INTO public.canned_responses (workspace_id, visibility, title, body)
    VALUES (tests.fixture('workspace_a')::uuid, 'workspace', 'direct', 'write');
  $$,
  '%permission denied%',
  'authenticated cannot insert directly'
);

SELECT throws_like(
  $$ UPDATE public.canned_responses SET title = 'hacked'; $$,
  '%permission denied%',
  'authenticated cannot update directly'
);

SELECT throws_like(
  $$ DELETE FROM public.canned_response_folders; $$,
  '%permission denied%',
  'authenticated cannot delete directly'
);

SELECT tests.clear_auth();

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_b')::uuid, 'canned-agent-b@test.local'); $$,
  'authenticate agent B for RLS'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses),
  2,
  'a second agent sees shared snippets plus only their own personal one'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_favorites),
  0,
  'a second agent sees none of the first agent''s favorites'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Folder soft delete unfiles snippets
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('admin_a')::uuid, 'canned-admin-a@test.local'); $$,
  'authenticate admin A for folder delete'
);

SELECT isnt(
  public.soft_delete_canned_response_folder(
    tests.fixture('workspace_a')::uuid, tests.fixture('folder_shared')::uuid
  ) ->> 'deleted_at',
  NULL,
  'shared folder is soft deleted'
);

SELECT lives_ok(
  $$
    SELECT public.soft_delete_canned_response_folder(
      tests.fixture('workspace_a')::uuid, tests.fixture('folder_shared')::uuid);
  $$,
  'folder soft delete is idempotent'
);

SELECT throws_like(
  $$
    SELECT public.update_canned_response_folder(
      tests.fixture('workspace_a')::uuid, tests.fixture('folder_shared')::uuid, 'Renamed', 0);
  $$,
  '%FOLDER_DELETED%',
  'a deleted folder cannot be renamed'
);

SELECT tests.clear_auth();

SELECT is(
  (SELECT folder_id FROM public.canned_responses WHERE id = tests.fixture('shared_1')::uuid),
  NULL,
  'snippets are unfiled when their folder is deleted'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses
   WHERE id = tests.fixture('shared_1')::uuid AND deleted_at IS NULL),
  1,
  'deleting a folder does not delete its snippets'
);

-- ---------------------------------------------------------------------------
-- Snippet soft delete, idempotency and catch-up tombstones
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A for delete'
);

SELECT isnt(
  public.soft_delete_canned_response(
    tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid
  ) ->> 'deleted_at',
  NULL,
  'agent soft deletes their own personal snippet'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'personal_1_deleted_at', updated_at::text
FROM public.canned_responses
WHERE id = tests.fixture('personal_1')::uuid;

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'canned-agent-a@test.local'); $$,
  'authenticate agent A after delete'
);

SELECT is(
  public.soft_delete_canned_response(
    tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid
  ) ->> 'updated_at',
  (SELECT to_jsonb(updated_at) #>> '{}' FROM public.canned_responses
   WHERE id = tests.fixture('personal_1')::uuid),
  'repeat delete does not move the tombstone watermark'
);

SELECT throws_like(
  $$
    SELECT public.get_canned_response(
      tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid);
  $$,
  '%CANNED_DELETED%',
  'a deleted snippet cannot be fetched'
);

SELECT throws_like(
  $$
    SELECT public.record_canned_response_usage(
      tests.fixture('workspace_a')::uuid, tests.fixture('personal_1')::uuid);
  $$,
  '%CANNED_DELETED%',
  'a deleted snippet cannot record usage'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'items'
  ),
  2,
  'a deleted snippet leaves the active list'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'tombstones'
  ),
  0,
  'no tombstone scan happens without catch_up_since'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object(
        'authoritative', true,
        'catch_up_since', (tests.fixture('personal_1_deleted_at')::timestamptz - interval '1 minute')
      )
    ) -> 'tombstones'
  ),
  1,
  'catch-up returns the soft-delete tombstone'
);

SELECT ok(
  (
    public.list_canned_responses(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object(
        'authoritative', true,
        'catch_up_since', (tests.fixture('personal_1_deleted_at')::timestamptz - interval '1 minute')
      )
    ) ->> 'server_watermark'
  )::timestamptz >= tests.fixture('personal_1_deleted_at')::timestamptz,
  'server_watermark advances past the delete'
);

SELECT is(
  public.create_canned_response(
    tests.fixture('workspace_a')::uuid, 'Refund again', 'text', 'refund', 'personal', NULL
  ) ->> 'shortcut',
  'refund',
  'a shortcut freed by soft delete can be reused'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_response_folders(tests.fixture('workspace_a')::uuid, '{}'::jsonb) -> 'items'
  ),
  1,
  'only active folders are listed'
);

SELECT is(
  jsonb_array_length(
    public.list_canned_response_folders(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object(
        'catch_up_since', (tests.fixture('personal_1_deleted_at')::timestamptz - interval '1 hour')
      )
    ) -> 'tombstones'
  ),
  1,
  'folder catch-up returns the deleted folder'
);

SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Member removal: personal data leaves, shared history survives
-- ---------------------------------------------------------------------------

DELETE FROM public.workspace_members WHERE id = tests.fixture('agent_member_a')::uuid;

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses
   WHERE owner_member_id = tests.fixture('agent_member_a')::uuid),
  0,
  'personal snippets cascade away with the member'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_folders
   WHERE owner_member_id = tests.fixture('agent_member_a')::uuid),
  0,
  'personal folders cascade away with the member'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_response_favorites
   WHERE member_id = tests.fixture('agent_member_a')::uuid),
  0,
  'favorites cascade away with the member'
);

SELECT is(
  (SELECT count(*)::int FROM public.canned_responses
   WHERE id = tests.fixture('shared_1')::uuid),
  1,
  'the shared snippet survives member removal'
);

DELETE FROM public.workspace_members WHERE id = tests.fixture('admin_member_a')::uuid;

SELECT is(
  (SELECT created_by FROM public.canned_response_folders
   WHERE id = tests.fixture('folder_shared')::uuid),
  NULL,
  'created_by is nulled when the creating member is removed'
);

SELECT is(
  (SELECT workspace_id FROM public.canned_response_folders
   WHERE id = tests.fixture('folder_shared')::uuid),
  tests.fixture('workspace_a')::uuid,
  'workspace_id survives the column-scoped SET NULL'
);

SELECT is(
  app_private.build_canned_folder_item(f) ->> 'created_by_display_label',
  'Former member',
  'a removed creator renders as Former member'
)
FROM public.canned_response_folders f
WHERE f.id = tests.fixture('folder_shared')::uuid;

SELECT * FROM finish();

ROLLBACK;
