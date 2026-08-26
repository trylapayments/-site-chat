\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_admin_a uuid;
  v_agent_a uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_outsider uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
BEGIN
  v_owner_a := tests.create_auth_user('team-owner-a@test.local');
  v_admin_a := tests.create_auth_user('team-admin-a@test.local');
  v_agent_a := tests.create_auth_user('team-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('team-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('team-owner-b@test.local');
  v_outsider := tests.create_auth_user('team-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'team-owner-a@test.local');
  PERFORM public.create_workspace('Team Workspace A', 'team-workspace-a');
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'team-owner-b@test.local');
  PERFORM public.create_workspace('Team Workspace B', 'team-workspace-b');
  PERFORM tests.clear_auth();

  SELECT id INTO v_workspace_a FROM public.workspaces WHERE slug = 'team-workspace-a';
  SELECT id INTO v_workspace_b FROM public.workspaces WHERE slug = 'team-workspace-b';

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_admin_a, 'admin', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  PERFORM tests.authenticate_as(v_owner_a, 'team-owner-a@test.local');
  PERFORM public.create_workspace_invitation(
    v_workspace_a,
    'team-invitee@test.local',
    'agent'::public.app_member_role
  );
  PERFORM tests.clear_auth();

  INSERT INTO tests.fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('outsider', v_outsider::text);
END;
$$;

SELECT tests.authenticate_as(
  tests.fixture('owner_a')::uuid,
  'team-owner-a@test.local'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'members'),
  4,
  'owner lists all workspace members'
);

SELECT ok(
  (
    SELECT bool_and(member->>'email' LIKE '%@test.local')
    FROM jsonb_array_elements(
      public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'members'
    ) AS member
  ),
  'owner list includes member emails'
);

SELECT ok(
  (
    SELECT bool_and(member ? 'assigned_conversation_count')
    FROM jsonb_array_elements(
      public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'members'
    ) AS member
  ),
  'member rows include assigned_conversation_count'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'invitations'),
  1,
  'owner sees pending invitations'
);

SELECT is(
  public.list_workspace_team(tests.fixture('workspace_a')::uuid)
    -> 'invitations' -> 0 ->> 'email',
  'team-invitee@test.local',
  'pending invitation email is visible to owner'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('admin_a')::uuid,
  'team-admin-a@test.local'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'invitations'),
  1,
  'admin sees pending invitations'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('agent_a')::uuid,
  'team-agent-a@test.local'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'members'),
  4,
  'agent can list members'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'invitations'),
  0,
  'agent does not receive pending invitations'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('viewer_a')::uuid,
  'team-viewer-a@test.local'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'members'),
  4,
  'viewer can list members'
);

SELECT is(
  jsonb_array_length(public.list_workspace_team(tests.fixture('workspace_a')::uuid) -> 'invitations'),
  0,
  'viewer does not receive pending invitations'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('owner_b')::uuid,
  'team-owner-b@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.list_workspace_team(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'Workspace not accessible',
  'cross-workspace owner cannot list another workspace team'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as(
  tests.fixture('outsider')::uuid,
  'team-outsider@test.local'
);

SELECT throws_like(
  format(
    $q$SELECT public.list_workspace_team(%L::uuid)$q$,
    tests.fixture('workspace_a')
  ),
  'Workspace not accessible',
  'non-member cannot list workspace team'
);

SELECT tests.clear_auth();

SELECT ok(
  has_function_privilege('authenticated', 'public.list_workspace_team(uuid)', 'execute'),
  'authenticated can execute list_workspace_team'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.list_workspace_team(uuid)',
    'execute'
  ),
  'authenticated cannot execute app_private.list_workspace_team'
);

SELECT * FROM finish();

ROLLBACK;
