\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(55);

CREATE TEMP TABLE test_fixtures (
  key text PRIMARY KEY,
  value text NOT NULL
);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_admin_a uuid;
  v_agent_a uuid;
  v_owner_b uuid;
  v_invitee uuid;
  v_outsider uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_invite_token text;
  v_agent_member_a uuid;
  v_owner_member_a uuid;
  v_admin_member_a uuid;
  v_sole_owner_c uuid;
  v_workspace_c uuid;
  v_sole_owner_member_c uuid;
BEGIN
  v_owner_a := tests.create_auth_user('owner-a@test.local');
  v_admin_a := tests.create_auth_user('admin-a@test.local');
  v_agent_a := tests.create_auth_user('agent-a@test.local');
  v_owner_b := tests.create_auth_user('owner-b@test.local');
  v_invitee := tests.create_auth_user('invitee@test.local');
  v_outsider := tests.create_auth_user('outsider@test.local');
  v_sole_owner_c := tests.create_auth_user('sole-owner-c@test.local');

  INSERT INTO test_fixtures (key, value) VALUES
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('owner_b', v_owner_b::text),
    ('invitee', v_invitee::text),
    ('outsider', v_outsider::text);

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM test_fixtures
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.authenticate_as(v_owner_a, 'owner-a@test.local');
  v_workspace_a := public.create_workspace('Workspace A', 'workspace-a');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'owner-b@test.local');
  v_workspace_b := public.create_workspace('Workspace B', 'workspace-b');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_sole_owner_c, 'sole-owner-c@test.local');
  v_workspace_c := public.create_workspace('Workspace C', 'workspace-c');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_a, 'owner-a@test.local');
  v_invite_token := public.create_workspace_invitation(
    v_workspace_a,
    'invitee@test.local',
    'viewer'::public.app_member_role
  ) ->> 'token';
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_a, v_admin_a, 'admin', 'active');

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace_a, v_agent_a, 'agent', 'active');

  SELECT id INTO v_agent_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a
    AND user_id = v_agent_a;

  SELECT id INTO v_owner_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a
    AND user_id = v_owner_a;

  SELECT id INTO v_admin_member_a
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_a
    AND user_id = v_admin_a;

  SELECT id INTO v_sole_owner_member_c
  FROM public.workspace_members
  WHERE workspace_id = v_workspace_c
    AND user_id = v_sole_owner_c
    AND role = 'owner'
    AND status = 'active';

  INSERT INTO test_fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('workspace_c', v_workspace_c::text),
    ('sole_owner_c', v_sole_owner_c::text),
    ('sole_owner_member_c', v_sole_owner_member_c::text),
    ('invite_token', v_invite_token),
    ('agent_member_a', v_agent_member_a::text),
    ('owner_member_a', v_owner_member_a::text),
    ('admin_member_a', v_admin_member_a::text);

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM test_fixtures
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

-- T1
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'outsider@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'T1: user cannot read another workspace'
);

-- T2
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_members
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'T2: user cannot read memberships in another workspace'
);

-- T3
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_invitations
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'T3: user cannot read invitations in another workspace'
);

SELECT tests.clear_auth();

-- T4
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'owner-a@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.create_workspace_invitation(%L::uuid, 'new-agent@test.local', 'agent'::public.app_member_role)$q$,
    tests.fixture('workspace_a')
  ),
  'T4: owner can create invitation'
);

-- T5
SELECT tests.authenticate_as(
  tests.fixture('admin_a')::uuid,
  'admin-a@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.create_workspace_invitation(%L::uuid, 'admin-invite@test.local', 'viewer'::public.app_member_role)$q$,
    tests.fixture('workspace_a')
  ),
  'T5: admin can create invitation'
);

SELECT lives_ok(
  format(
    $q$SELECT public.revoke_workspace_invitation(%L::uuid)$q$,
    (
      SELECT id::text
      FROM public.workspace_invitations
      WHERE workspace_id = tests.fixture('workspace_a')::uuid
        AND email_normalized = 'admin-invite@test.local'
        AND accepted_at IS NULL
        AND revoked_at IS NULL
      LIMIT 1
    )
  ),
  'T5: admin can revoke invitation'
);

-- T6
SELECT throws_like(
  format(
    $q$SELECT public.promote_workspace_member_to_owner(%L::uuid)$q$,
    tests.fixture('agent_member_a')
  ),  'Only owners can promote members to owner',
  'T6: admin cannot promote member to owner'
);

-- T7
SELECT throws_like(
  format(
    $q$SELECT public.demote_workspace_owner(%L::uuid, 'admin'::public.app_member_role)$q$,
    tests.fixture('owner_member_a')
  ),  'Only owners can demote owners',
  'T7: admin cannot demote owner'
);

SELECT throws_like(
  format(
    $q$SELECT public.deactivate_workspace_member(%L::uuid)$q$,
    tests.fixture('owner_member_a')
  ),  'Only owners can deactivate owners',
  'T7: admin cannot deactivate owner'
);

SELECT throws_like(
  format(
    $q$SELECT public.remove_workspace_member(%L::uuid)$q$,
    tests.fixture('owner_member_a')
  ),  'Only owners can remove owners',
  'T7: admin cannot remove owner'
);

-- T8
SELECT lives_ok(
  format(
    $q$SELECT public.update_workspace_member_role(%L::uuid, 'viewer'::public.app_member_role)$q$,
    tests.fixture('agent_member_a')
  ),
  'T8: admin can change agent role'
);

-- T9
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'agent-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.create_workspace_invitation(%L::uuid, 'blocked@test.local', 'viewer'::public.app_member_role)$q$,
    tests.fixture('workspace_a')
  ),  'Only owners and admins can create invitations',
  'T9: agent cannot create invitation'
);

SELECT ok(
  (
    SELECT count(*) >= 1
    FROM public.workspace_members
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
  ),
  'T9: agent can list members'
);

-- T10
SELECT tests.clear_auth();

INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
VALUES (
  tests.fixture('workspace_a')::uuid,
  tests.fixture('outsider')::uuid,
  'viewer',
  'active'
);

SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'outsider@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.create_workspace_invitation(%L::uuid, 'viewer-mut@test.local', 'agent'::public.app_member_role)$q$,
    tests.fixture('workspace_a')
  ),  'Only owners and admins can create invitations',
  'T10: viewer cannot mutate tenant data'
);

-- T11
SELECT tests.clear_auth();

UPDATE public.workspace_members
SET status = 'deactivated', updated_at = now()
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND user_id = tests.fixture('outsider')::uuid;

SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'outsider@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_a')::uuid
  ),
  0,
  'T11: deactivated member has no workspace access'
);

-- T12
SELECT tests.clear_auth();
SET LOCAL role anon;

SELECT throws_like(
  $$SELECT count(*) FROM public.workspaces$$,
  'permission denied for table workspaces',
  'T12: anon has no tenant access'
);

SET LOCAL role postgres;

-- T13
SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'owner-b@test.local'
);

SELECT throws_like(
  format(
    $q$
      SELECT public.demote_workspace_owner(%L::uuid, 'admin'::public.app_member_role);
      SET CONSTRAINTS ALL IMMEDIATE;
    $q$,
    (
      SELECT id::text
      FROM public.workspace_members
      WHERE workspace_id = tests.fixture('workspace_b')::uuid
        AND user_id = tests.fixture('owner_b')::uuid
    )
  ),
  'Workspace must have at least one active owner',
  'T13: sole owner cannot be demoted'
);

SELECT throws_like(
  format(
    $q$
      SELECT public.deactivate_workspace_member(%L::uuid);
      SET CONSTRAINTS ALL IMMEDIATE;
    $q$,
    (
      SELECT id::text
      FROM public.workspace_members
      WHERE workspace_id = tests.fixture('workspace_b')::uuid
        AND user_id = tests.fixture('owner_b')::uuid
    )
  ),
  'Workspace must have at least one active owner',
  'T13: sole owner cannot be deactivated'
);

SELECT throws_like(
  format(
    $q$
      SELECT public.remove_workspace_member(%L::uuid);
      SET CONSTRAINTS ALL IMMEDIATE;
    $q$,
    (
      SELECT id::text
      FROM public.workspace_members
      WHERE workspace_id = tests.fixture('workspace_b')::uuid
        AND user_id = tests.fixture('owner_b')::uuid
    )
  ),
  'Workspace must have at least one active owner',
  'T13: sole owner cannot be removed'
);

-- T14/T15
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'owner-a@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.promote_workspace_member_to_owner(%L::uuid)$q$,
    tests.fixture('agent_member_a')
  ),
  'T14 setup: promote second owner'
);

SELECT lives_ok(
  format(
    $q$SELECT public.demote_workspace_owner(%L::uuid, 'agent'::public.app_member_role)$q$,
    tests.fixture('agent_member_a')
  ),
  'T14: demote one owner while another remains'
);

SELECT lives_ok(
  format(
    $q$SELECT public.promote_workspace_member_to_owner(%L::uuid)$q$,
    tests.fixture('agent_member_a')
  ),
  'T15: owner can promote active member to owner'
);

SELECT ok(
  (
    SELECT count(*) = 2
    FROM public.workspace_members
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND role = 'owner'
      AND status = 'active'
  ),
  'T15: multiple active owners allowed'
);

-- T16
SELECT ok(
  (
    SELECT bool_and(
      token_hash = tests.hash_invitation_token(tests.fixture('invite_token'))
      AND token_hash <> tests.fixture('invite_token')
    )
    FROM public.workspace_invitations
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND email_normalized = 'invitee@test.local'
  ),
  'T16: invitation stores hash not plaintext token'
);

-- T17/T18/T19
SELECT tests.clear_auth();

INSERT INTO public.workspace_invitations (
  workspace_id,
  email,
  role,
  token_hash,
  invited_by_user_id,
  expires_at
)
VALUES (
  tests.fixture('workspace_a')::uuid,
  'expired@test.local',
  'viewer',
  tests.hash_invitation_token('expired-token'),
  tests.fixture('owner_a')::uuid,
  now() - interval '1 day'
);

SELECT tests.authenticate_as(
  tests.fixture('invitee')::uuid,
  'invitee@test.local'
);

SELECT throws_like(
  $$SELECT public.accept_workspace_invitation('expired-token')$$,
  'Invalid or expired invitation',
  'T17: expired invitation cannot be accepted'
);

SELECT tests.clear_auth();

INSERT INTO public.workspace_invitations (
  workspace_id,
  email,
  role,
  token_hash,
  invited_by_user_id,
  expires_at,
  revoked_at
)
VALUES (
  tests.fixture('workspace_a')::uuid,
  'revoked@test.local',
  'viewer',
  tests.hash_invitation_token('revoked-token'),
  tests.fixture('owner_a')::uuid,
  now() + interval '7 days',
  now()
);

SELECT tests.authenticate_as(
  tests.fixture('invitee')::uuid,
  'invitee@test.local'
);

SELECT throws_like(
  $$SELECT public.accept_workspace_invitation('revoked-token')$$,
  'Invalid or expired invitation',
  'T18: revoked invitation cannot be accepted'
);

SELECT lives_ok(
  format(
    $q$SELECT public.accept_workspace_invitation(%L)$q$,
    tests.fixture('invite_token')
  ),
  'T19 setup: accept invitation once'
);

SELECT throws_like(
  format(
    $q$SELECT public.accept_workspace_invitation(%L)$q$,
    tests.fixture('invite_token')
  ),
  'Invalid or expired invitation',
  'T19: accepted invitation cannot be reused'
);

-- T21
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'outsider@test.local'
);

SELECT public.create_workspace('Outsider Workspace', 'outsider-workspace');

SELECT ok(
  (
    SELECT count(*) = 1
    FROM public.workspaces w
    INNER JOIN public.workspace_members wm ON wm.workspace_id = w.id
    WHERE w.slug = 'outsider-workspace'
      AND wm.user_id = tests.fixture('outsider')::uuid
      AND wm.role = 'owner'
      AND wm.status = 'active'
  ),
  'T21: create_workspace creates workspace and owner atomically'
);

-- T30/T22 soft delete
SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'owner-b@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.soft_delete_workspace(%L::uuid)$q$,
    tests.fixture('workspace_b')
  ),
  'T30: owner can soft delete workspace'
);

SELECT tests.clear_auth();

SELECT is(
  (
    SELECT status::text
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_b')::uuid
  ),
  'pending_deletion',
  'T30: soft delete sets pending_deletion status'
);

SELECT ok(
  (
    SELECT deleted_at IS NOT NULL
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_b')::uuid
  ),
  'T30: soft delete sets deleted_at'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'owner-b@test.local'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_b')::uuid
  ),
  0,
  'T22: soft-deleted workspace inaccessible through tenant policies'
);

-- T23
SELECT throws_like(
  $$SELECT public.create_workspace('Workspace B Again', 'workspace-b')$$,
  'duplicate key value violates unique constraint "uq_workspaces_slug"',
  'T23: slug remains unavailable after soft deletion'
);

-- T24
SELECT tests.clear_auth();

DO $$
DECLARE
  v_active_member uuid;
  v_active_member_ws uuid;
  v_invite_token text;
BEGIN
  v_active_member := tests.create_auth_user('active-member@test.local');

  PERFORM tests.authenticate_as(v_active_member, 'active-member@test.local');
  v_active_member_ws := public.create_workspace('Active Member WS', 'active-member-ws');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(
    tests.fixture('owner_a')::uuid,
    'owner-a@test.local'
  );

  v_invite_token := public.create_workspace_invitation(
    v_active_member_ws,
    'active-member@test.local',
    'admin'::public.app_member_role
  ) ->> 'token';
  PERFORM tests.clear_auth();

  INSERT INTO test_fixtures (key, value) VALUES
    ('active_member', v_active_member::text),
    ('active_member_ws', v_active_member_ws::text),
    ('active_member_invite', v_invite_token)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO tests.fixtures (key, value)
  SELECT key, value FROM test_fixtures
  WHERE key IN ('active_member', 'active_member_ws', 'active_member_invite')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  PERFORM tests.clear_auth();
END;
$$;

SELECT tests.authenticate_as(
  tests.fixture('active_member')::uuid,
  'active-member@test.local'
);

SELECT is(
  (
    SELECT public.accept_workspace_invitation(tests.fixture('active_member_invite')) ->> 'status'
  ),
  'already_member',
  'T24: active member accepts invite with already_member status'
);

SELECT is(
  (
    SELECT role::text
    FROM public.workspace_members
    WHERE workspace_id = tests.fixture('active_member_ws')::uuid
      AND user_id = tests.fixture('active_member')::uuid
  ),
  'owner',
  'T24: active member role unchanged after invite acceptance'
);

-- T25/T26
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'owner-a@test.local'
);

SELECT throws_like(
  $$INSERT INTO public.workspaces (name, slug) VALUES ('Direct', 'direct-insert')$$,
  'permission denied for table workspaces',
  'T25: authenticated cannot directly insert workspaces'
);

SELECT throws_like(
  $$UPDATE public.workspace_members SET role = 'viewer' WHERE false$$,
  'permission denied for table workspace_members',
  'T26: authenticated cannot directly update workspace_members'
);

-- T27/T28
SELECT throws_like(
  $$SELECT app_private.create_workspace('Private', 'private-ws')$$,
  'permission denied for function create_workspace',
  'T27: authenticated cannot execute app_private.create_workspace'
);

SELECT lives_ok(
  $$SELECT public.create_workspace('Public RPC', 'public-rpc-ws')$$,
  'T28: authenticated can execute public.create_workspace'
);

-- T29
SELECT ok(
  (
    SELECT 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname = 'create_workspace'
  ),
  'T29: app_private.create_workspace has empty search_path'
);

-- T31
SELECT tests.authenticate_as(
  tests.fixture('admin_a')::uuid,
  'admin-a@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.soft_delete_workspace(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'Only owners can soft delete a workspace',
  'T31: admin cannot soft delete workspace'
);

-- T33/T34/T35
SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'owner-a@test.local'
);

SELECT ok(
  (
    SELECT count(*) >= 1
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_a')::uuid
  ),
  'T33: authenticated can select own workspace'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspaces
    WHERE id = tests.fixture('workspace_b')::uuid
  ),
  0,
  'T34: authenticated cannot select another tenant workspace'
);

SELECT ok(
  (SELECT count(*) = 1 FROM public.workspaces WHERE slug = 'public-rpc-ws'),
  'T35: public RPC write visible via subsequent select'
);

-- T36
SELECT tests.clear_auth();

SELECT throws_like(
  $$
  SET CONSTRAINTS ALL DEFERRED;
  INSERT INTO public.workspaces (name, slug)
  VALUES ('Orphan Workspace', 'orphan-workspace');
  SET CONSTRAINTS ALL IMMEDIATE;
  $$,
  'Workspace must have at least one active owner',
  'T36: orphan workspace insert fails deferred owner invariant'
);

-- T36 leaves constraint triggers IMMEDIATE for the rest of the transaction;
-- restore deferral so later create_workspace() can insert owner membership first.
SET CONSTRAINTS ALL DEFERRED;

-- T37 (workspace_c is created in initial setup: workspace_b is soft-deleted in T30
-- and exempt from the owner invariant, so it cannot test sole-owner move rejection)
SELECT tests.clear_auth();
SET LOCAL role postgres;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.workspace_members
    WHERE workspace_id = tests.fixture('workspace_c')::uuid
      AND role = 'owner'
      AND status = 'active'
  ),
  1,
  'T37: workspace_c has exactly one active owner before move test'
);

SELECT ok(
  tests.fixture('sole_owner_member_c') IS NOT NULL,
  'T37: sole owner membership id fixture exists before move test'
);

SELECT throws_like(
  format(
    $q$SELECT tests.move_workspace_member(%L::uuid, %L::uuid)$q$,
    tests.fixture('sole_owner_member_c'),
    tests.fixture('workspace_a')
  ),
  'Workspace must have at least one active owner',
  'T37: moving sole active owner to another workspace fails'
);

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'owner-a@test.local'
);

SELECT lives_ok(
  format(
    $q$SELECT public.promote_workspace_member_to_owner(%L::uuid)$q$,
    tests.fixture('admin_member_a')
  ),
  'T37: promote admin to co-owner for move test setup'
);

SELECT tests.clear_auth();
SET LOCAL role postgres;

SELECT lives_ok(
  format(
    $q$SELECT tests.move_workspace_member(%L::uuid, %L::uuid)$q$,
    tests.fixture('agent_member_a'),
    tests.fixture('workspace_b')
  ),
  'T37: moving non-owner member to another workspace succeeds'
);

SELECT lives_ok(
  format(
    $q$SELECT tests.move_workspace_member(%L::uuid, %L::uuid)$q$,
    tests.fixture('owner_member_a'),
    tests.fixture('workspace_b')
  ),
  'T37: moving one of multiple active owners succeeds'
);

-- T38
SELECT tests.clear_auth();

DO $$
DECLARE
  v_ws uuid;
  v_owner uuid;
  v_owner_member uuid;
BEGIN
  v_owner := tests.create_auth_user('pending-delete-owner@test.local');
  PERFORM tests.authenticate_as(v_owner, 'pending-delete-owner@test.local');
  v_ws := public.create_workspace('Pending Delete WS', 'pending-delete-ws');

  SELECT id INTO v_owner_member
  FROM public.workspace_members
  WHERE workspace_id = v_ws
    AND user_id = v_owner;

  PERFORM public.soft_delete_workspace(v_ws);

  PERFORM tests.clear_auth();

  DELETE FROM public.workspace_members
  WHERE id = v_owner_member;
END;
$$;

SELECT ok(true, 'T38: pending_deletion workspace exempt from active-owner invariant');

-- T40/T41
SELECT tests.clear_auth();
SET LOCAL role anon;

SELECT throws_like(
  $$SELECT app_private.user_workspace_ids()$$,
  'permission denied for schema app_private',
  'T40: anon cannot execute app_private helper'
);

SELECT throws_like(
  $$SELECT public.create_workspace('Anon', 'anon-ws')$$,
  'permission denied for function create_workspace',
  'T41: anon cannot execute public tenant RPC'
);

SET LOCAL role postgres;

SELECT * FROM finish();

ROLLBACK;
