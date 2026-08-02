\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

CREATE TEMP TABLE test_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner uuid;
  v_member uuid;
  v_outsider uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_invite_token text;
BEGIN
  v_owner := tests.create_auth_user('ctx-owner@test.local');
  v_member := tests.create_auth_user('ctx-member@test.local');
  v_outsider := tests.create_auth_user('ctx-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner, 'ctx-owner@test.local');
  v_workspace_a := (public.create_workspace('Context A', 'context-a')->>'workspace_id')::uuid;
  v_workspace_b := (public.create_workspace('Context B', 'context-b')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_a, v_member, 'agent', 'active');

  PERFORM tests.authenticate_as(v_owner, 'ctx-owner@test.local');
  v_invite_token := public.create_workspace_invitation(
    v_workspace_a,
    'ctx-outsider@test.local',
    'viewer'::public.app_member_role
  ) ->> 'token';
  PERFORM tests.clear_auth();

  UPDATE public.workspaces
  SET status = 'suspended', updated_at = now()
  WHERE id = v_workspace_b;

  INSERT INTO test_fixtures (key, value) VALUES
    ('owner', v_owner::text),
    ('member', v_member::text),
    ('outsider', v_outsider::text),
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('invite_token', v_invite_token);

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM test_fixtures
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

-- T1 list_accessible_workspaces returns stable JSON shape
SELECT tests.authenticate_as(
  tests.fixture('owner')::uuid,
  'ctx-owner@test.local'
);

SELECT is(
  public.list_accessible_workspaces() ? 'total_membership_count',
  true,
  'T1: list_accessible_workspaces includes total_membership_count'
);

SELECT is(
  public.list_accessible_workspaces() ? 'accessible_workspaces',
  true,
  'T1: list_accessible_workspaces includes accessible_workspaces'
);

-- T2 accessible workspaces exclude suspended
SELECT is(
  (
    SELECT jsonb_array_length(public.list_accessible_workspaces()->'accessible_workspaces')
  ),
  1,
  'T2: owner sees one accessible workspace (suspended excluded)'
);

-- T3 State A: zero memberships
SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'ctx-outsider@test.local'
);

SELECT is(
  (public.list_accessible_workspaces()->>'total_membership_count')::integer,
  0,
  'T3: outsider has zero total memberships (State A)'
);

SELECT is(
  (
    SELECT jsonb_array_length(public.list_accessible_workspaces()->'accessible_workspaces')
  ),
  0,
  'T3: outsider has zero accessible workspaces'
);

-- T6 set_last_workspace rejects non-member (must run before State D membership insert)
SELECT throws_like(
  format(
    $q$SELECT public.set_last_workspace(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'Not a member of this workspace',
  'T6: non-member cannot set last workspace'
);

-- T4 State D: memberships exist but none accessible
SELECT tests.clear_auth();

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES (
  tests.fixture('workspace_a')::uuid,
  tests.fixture('outsider')::uuid,
  'viewer',
  'deactivated'
);

SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'ctx-outsider@test.local'
);

SELECT ok(
  (public.list_accessible_workspaces()->>'total_membership_count')::integer >= 1,
  'T4: deactivated member has total_membership_count >= 1'
);

SELECT is(
  (
    SELECT jsonb_array_length(public.list_accessible_workspaces()->'accessible_workspaces')
  ),
  0,
  'T4: deactivated member has zero accessible workspaces (State D)'
);

-- T5 set_last_workspace succeeds for accessible workspace
SELECT tests.authenticate_as(
  tests.fixture('member')::uuid,
  'ctx-member@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.set_last_workspace(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'T5: active member can set last workspace'
);

-- T7 set_last_workspace rejects deactivated member (uses T4 deactivated row)
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'ctx-outsider@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.set_last_workspace(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'Workspace membership is not active',
  'T7: deactivated member cannot set last workspace'
);

-- T8 set_last_workspace rejects suspended workspace
SELECT tests.authenticate_as(
  tests.fixture('owner')::uuid,
  'ctx-owner@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.set_last_workspace(%L::uuid)$q$,
    tests.fixture('workspace_b')
  ),
  'Workspace is not active',
  'T8: suspended workspace rejected by set_last_workspace'
);

-- T9 set_last_workspace rejects soft-deleted workspace
SELECT tests.clear_auth();

DO $$
DECLARE
  v_owner uuid;
  v_ws uuid;
BEGIN
  v_owner := tests.create_auth_user('deleted-owner@test.local');
  PERFORM tests.authenticate_as(v_owner, 'deleted-owner@test.local');
  v_ws := (public.create_workspace('Deleted WS', 'deleted-ws')->>'workspace_id')::uuid;
  PERFORM public.soft_delete_workspace(v_ws);

  INSERT INTO test_fixtures (key, value) VALUES
    ('deleted_owner', v_owner::text),
    ('deleted_ws', v_ws::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

SELECT tests.authenticate_as(
  tests.fixture('deleted_owner')::uuid,
  'deleted-owner@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.set_last_workspace(%L::uuid)$q$,
    tests.fixture('deleted_ws')
  ),
  'Workspace has been deleted',
  'T9: soft-deleted workspace rejected by set_last_workspace'
);

-- T10 user_preferences direct write rejected
SELECT throws_like(
  format(
    $q$INSERT INTO public.user_preferences (user_id, last_workspace_id) VALUES (%L::uuid, %L::uuid)$q$,
    tests.fixture('deleted_owner'),
    tests.fixture('workspace_a')
  ),
  'permission denied for table user_preferences',
  'T10: authenticated cannot directly insert user_preferences'
);

-- T11 validate_workspace_invitation valid shape (anon)
SELECT tests.clear_auth();
SET LOCAL role anon;

SELECT is(
  (public.validate_workspace_invitation(tests.fixture('invite_token'))->>'valid')::boolean,
  true,
  'T11: valid invitation returns valid=true'
);

SELECT ok(
  public.validate_workspace_invitation(tests.fixture('invite_token'))->>'workspace_name' IS NOT NULL,
  'T11: valid invitation includes workspace_name'
);

SET LOCAL role postgres;

-- T12 validate invalid token
SELECT is(
  (public.validate_workspace_invitation('invalid-token')->>'valid')::boolean,
  false,
  'T12: invalid token returns valid=false'
);

SELECT ok(
  public.validate_workspace_invitation('invalid-token')->>'workspace_name' IS NULL,
  'T12: invalid token nulls workspace_name'
);

-- T13 create_workspace returns extended shape
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'ctx-outsider@test.local'
);

SELECT ok(
  public.create_workspace('New WS', 'new-ws-ctx') ? 'workspace_id',
  'T13: create_workspace returns workspace_id'
);

SELECT ok(
  public.create_workspace('New WS 2', 'new-ws-ctx-2') ? 'slug',
  'T13: create_workspace returns slug'
);

-- T17 create_workspace upserts last_workspace preference atomically
SELECT is(
  (
    SELECT up.last_workspace_id::text
    FROM public.user_preferences up
    WHERE up.user_id = auth.uid()
  ),
  (
    SELECT public.create_workspace('Atomic WS', 'atomic-ws-ctx')->>'workspace_id'
  ),
  'T17: create_workspace sets last_workspace_id in same transaction'
);

-- T18 failed create_workspace leaves preferences unchanged
SELECT is(
  (
    SELECT up.last_workspace_id::text
    FROM public.user_preferences up
    WHERE up.user_id = auth.uid()
  ),
  (
    SELECT id::text
    FROM public.workspaces
    WHERE slug = 'atomic-ws-ctx'
  ),
  'T18: last_workspace_id established before duplicate attempt'
);

SELECT throws_ok(
  $$SELECT public.create_workspace('Atomic WS Duplicate', 'atomic-ws-ctx')$$,
  '23505',
  'T18: duplicate slug create fails'
);

SELECT is(
  (
    SELECT up.last_workspace_id::text
    FROM public.user_preferences up
    WHERE up.user_id = auth.uid()
  ),
  (
    SELECT id::text
    FROM public.workspaces
    WHERE slug = 'atomic-ws-ctx'
  ),
  'T18: duplicate slug failure preserves existing last_workspace_id'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspaces
    WHERE slug = 'atomic-ws-ctx'
  ),
  1,
  'T18: duplicate slug failure does not create extra workspace'
);

-- T14 accept_workspace_invitation extended return
SELECT tests.clear_auth();

DO $$
DECLARE
  v_invitee uuid;
  v_token text;
BEGIN
  v_invitee := tests.create_auth_user('accept-ext@test.local');

  PERFORM tests.authenticate_as(
    tests.fixture('owner')::uuid,
    'ctx-owner@test.local'
  );

  v_token := public.create_workspace_invitation(
    tests.fixture('workspace_a')::uuid,
    'accept-ext@test.local',
    'viewer'::public.app_member_role
  ) ->> 'token';

  INSERT INTO test_fixtures (key, value) VALUES
    ('accept_ext_user', v_invitee::text),
    ('accept_ext_token', v_token)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

SELECT tests.authenticate_as(
  tests.fixture('accept_ext_user')::uuid,
  'accept-ext@test.local'
);

SELECT ok(
  (
    SELECT (result ? 'workspace_id') AND (result ? 'slug')
    FROM (
      SELECT public.accept_workspace_invitation(tests.fixture('accept_ext_token')) AS result
    ) accepted
  ),
  'T14: accept returns workspace_id and slug'
);

-- T15 workspace_is_accessible rejects suspended
SELECT tests.authenticate_as(
  tests.fixture('owner')::uuid,
  'ctx-owner@test.local'
);

SELECT is(
  app_private.workspace_is_accessible(tests.fixture('workspace_b')::uuid),
  false,
  'T15: suspended workspace is not accessible'
);

-- T16 SECURITY DEFINER search_path
SELECT ok(
  (
    SELECT 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname = 'list_accessible_workspaces'
  ),
  'T16: list_accessible_workspaces has empty search_path'
);

SELECT * FROM finish();

ROLLBACK;
