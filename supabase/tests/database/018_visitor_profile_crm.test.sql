\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Schema(18) + privileges(28) + profile RBAC(6) + cross-workspace profile(4)
-- + workspace B seed lives_ok(4) + tags(16) + companies(12) + custom fields(28)
-- + soft-delete field + noop/timeline(8) + company/tag soft-delete + removed-member
-- + company search(4) + search(6) + realtime(4) = 154
SELECT plan(154);

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
  v_owner_member_a uuid;
  v_agent_member_a uuid;
  v_contact_a uuid;
  v_contact_b uuid;
BEGIN
  v_owner_a := tests.create_auth_user('crm-owner-a@test.local');
  v_admin_a := tests.create_auth_user('crm-admin-a@test.local');
  v_agent_a := tests.create_auth_user('crm-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('crm-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('crm-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'crm-owner-a@test.local');
  v_workspace_a := (
    public.create_workspace('CRM Workspace A', 'crm-workspace-a')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'crm-owner-b@test.local');
  v_workspace_b := (
    public.create_workspace('CRM Workspace B', 'crm-workspace-b')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_admin_a, 'admin', 'active'),
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  SELECT id INTO v_owner_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_owner_a;
  SELECT id INTO v_agent_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_a,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'crm-contact-a@test.local',
    'CRM Contact A'
  )
  RETURNING id INTO v_contact_a;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_b,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'crm-contact-b@test.local',
    'CRM Contact B'
  )
  RETURNING id INTO v_contact_b;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_a', v_owner_a::text),
    ('admin_a', v_admin_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('owner_member_a', v_owner_member_a::text),
    ('agent_member_a', v_agent_member_a::text),
    ('contact_a', v_contact_a::text),
    ('contact_b', v_contact_b::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema shape
-- ---------------------------------------------------------------------------

SELECT has_table('public', 'companies', 'companies exists');
SELECT has_table('public', 'contact_tags', 'contact_tags exists');
SELECT has_table('public', 'contact_tag_assignments', 'contact_tag_assignments exists');
SELECT has_table('public', 'custom_field_definitions', 'custom_field_definitions exists');
SELECT has_table('public', 'custom_field_values', 'custom_field_values exists');

SELECT has_enum('public', 'app_custom_field_type', 'app_custom_field_type enum exists');

SELECT has_column('public', 'contacts', 'company_id', 'contacts.company_id exists');
SELECT has_column('public', 'contacts', 'job_title', 'contacts.job_title exists');
SELECT has_column('public', 'contacts', 'locale', 'contacts.locale exists');
SELECT has_column('public', 'contacts', 'country_code', 'contacts.country_code exists');
SELECT has_column('public', 'contacts', 'search_vector', 'contacts.search_vector exists');

SELECT has_index('public', 'companies', 'uq_companies_workspace_domain_active',
  'company domain unique index exists');
SELECT has_index('public', 'contact_tags', 'uq_contact_tags_workspace_lower_name_active',
  'tag name unique index exists');
SELECT has_index('public', 'contacts', 'idx_contacts_search_vector',
  'contact search_vector GIN exists');
SELECT has_index('public', 'custom_field_definitions', 'uq_custom_field_definitions_workspace_key_active',
  'custom field key unique index exists');

SELECT is(
  (SELECT count(*)::int FROM pg_class
   WHERE relname IN (
     'companies', 'contact_tags', 'contact_tag_assignments',
     'custom_field_definitions', 'custom_field_values'
   )
     AND relkind = 'r'
     AND relreplident = 'f'),
  5,
  'all CRM tables use REPLICA IDENTITY FULL'
);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'companies'),
  'companies has FORCE RLS'
);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'custom_field_values'),
  'custom_field_values has FORCE RLS'
);

-- ---------------------------------------------------------------------------
-- Privilege matrix
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege('authenticated', 'public.get_contact_profile(uuid, uuid)', 'execute'),
  'authenticated can execute get_contact_profile'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.list_contacts(uuid, jsonb)', 'execute'),
  'authenticated can execute list_contacts'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.update_contact_profile(uuid, uuid, jsonb)', 'execute'),
  'authenticated can execute update_contact_profile'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.create_contact_tag(uuid, text, text)', 'execute'),
  'authenticated can execute create_contact_tag'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.assign_contact_tag(uuid, uuid, uuid)', 'execute'),
  'authenticated can execute assign_contact_tag'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.unassign_contact_tag(uuid, uuid, uuid)', 'execute'),
  'authenticated can execute unassign_contact_tag'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.create_company(uuid, text, text, text, text, text)', 'execute'),
  'authenticated can execute create_company'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.link_contact_company(uuid, uuid, uuid)', 'execute'),
  'authenticated can execute link_contact_company'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.unlink_contact_company(uuid, uuid)', 'execute'),
  'authenticated can execute unlink_contact_company'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean)',
    'execute'
  ),
  'authenticated can execute create_custom_field_definition'
);
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.set_contact_custom_field_value(uuid, uuid, uuid, jsonb)',
    'execute'
  ),
  'authenticated can execute set_contact_custom_field_value'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.update_visitor_profile(uuid, uuid, jsonb)', 'execute'),
  'authenticated can execute update_visitor_profile'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_contact_profile(uuid, uuid)', 'execute'),
  'anon cannot execute get_contact_profile'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.update_contact_profile(uuid, uuid, jsonb)', 'execute'),
  'anon cannot execute update_contact_profile'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_company(uuid, text, text, text, text, text)', 'execute'),
  'anon cannot execute create_company'
);
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean)',
    'execute'
  ),
  'anon cannot execute create_custom_field_definition'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.get_contact_profile(uuid, uuid)', 'execute'),
  'authenticated cannot execute app_private.get_contact_profile'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.update_contact_profile(uuid, uuid, jsonb)', 'execute'),
  'authenticated cannot execute app_private.update_contact_profile'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.create_contact_tag(uuid, text, text)', 'execute'),
  'authenticated cannot execute app_private.create_contact_tag'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'app_private.create_company(uuid, text, text, text, text, text)', 'execute'),
  'authenticated cannot execute app_private.create_company'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean)',
    'execute'
  ),
  'authenticated cannot execute app_private.create_custom_field_definition'
);
SELECT ok(
  NOT has_function_privilege('anon', 'app_private.require_crm_write_access(uuid)', 'execute'),
  'anon cannot execute app_private.require_crm_write_access'
);

SELECT ok(
  has_function_privilege('authenticated', 'app_private.workspace_is_accessible(uuid)', 'execute'),
  'authenticated retains workspace_is_accessible after CRM hardening'
);
SELECT ok(
  has_function_privilege('authenticated', 'app_private.get_caller_member_id(uuid)', 'execute'),
  'authenticated retains get_caller_member_id after CRM hardening'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.companies', 'select'),
  'authenticated can SELECT companies'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.companies', 'insert'),
  'authenticated cannot INSERT companies'
);
SELECT ok(
  has_table_privilege('authenticated', 'public.custom_field_definitions', 'select'),
  'authenticated can SELECT custom_field_definitions'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.custom_field_definitions', 'update'),
  'authenticated cannot UPDATE custom_field_definitions'
);

-- ---------------------------------------------------------------------------
-- Profile edit: agent allow, viewer deny
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent A'
);

SELECT is(
  public.update_contact_profile(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('contact_a')::uuid,
    jsonb_build_object(
      'job_title', 'Support Lead',
      'locale', 'en-US',
      'country_code', 'US'
    )
  ) ->> 'job_title',
  'Support Lead',
  'agent can update contact profile CRM fields'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('viewer_a')::uuid, 'crm-viewer-a@test.local'); $$,
  'authenticate viewer A'
);

SELECT throws_like(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object('job_title', 'Nope')
    );
  $$,
  '%Insufficient permissions%',
  'viewer cannot update contact profile'
);

SELECT is(
  (public.get_contact_profile(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('contact_a')::uuid
  ) ->> 'job_title'),
  'Support Lead',
  'viewer can still read contact profile'
);

SELECT throws_like(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_a')::uuid, 'ViewerTag', '#64748B');
  $$,
  '%Insufficient permissions%',
  'viewer cannot create tags'
);

-- ---------------------------------------------------------------------------
-- Cross-workspace denial (profile)
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  're-authenticate agent A for cross-workspace'
);

SELECT throws_like(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_b')::uuid,
      tests.fixture('contact_b')::uuid,
      jsonb_build_object('name', 'Hijack')
    );
  $$,
  '%Workspace not accessible%',
  'workspace A agent cannot update workspace B contact'
);

SELECT throws_like(
  $$
    SELECT public.get_contact_profile(
      tests.fixture('workspace_b')::uuid,
      tests.fixture('contact_b')::uuid
    );
  $$,
  '%Workspace not accessible%',
  'workspace A agent cannot read workspace B contact'
);

SELECT throws_like(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_b')::uuid,
      jsonb_build_object('name', 'Cross')
    );
  $$,
  '%CONTACT_NOT_FOUND%',
  'cannot patch foreign-workspace contact id inside workspace A'
);

-- ---------------------------------------------------------------------------
-- Workspace B CRM entities (for cross-workspace entity rejection later)
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_b')::uuid, 'crm-owner-b@test.local'); $$,
  'authenticate owner B for foreign CRM entities'
);

SELECT lives_ok(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_b')::uuid, 'WorkspaceBTag', '#111111'
    );
  $$,
  'owner B creates tag in workspace B'
);

SELECT lives_ok(
  $$
    SELECT public.create_company(
      tests.fixture('workspace_b')::uuid,
      'Beta Co',
      'beta.example',
      NULL, NULL, NULL
    );
  $$,
  'owner B creates company in workspace B'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_b')::uuid,
      'b_plan',
      'B Plan',
      'select',
      '["basic"]'::jsonb,
      0,
      false
    );
  $$,
  'owner B creates custom field in workspace B'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_b', id::text
FROM public.contact_tags
WHERE workspace_id = tests.fixture('workspace_b')::uuid
  AND lower(name) = 'workspacebtag'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO tests.fixtures (key, value)
SELECT 'company_b', id::text
FROM public.companies
WHERE workspace_id = tests.fixture('workspace_b')::uuid
  AND lower(name) = 'beta co'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO tests.fixtures (key, value)
SELECT 'field_b', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_b')::uuid
  AND key = 'b_plan'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ---------------------------------------------------------------------------
-- Tags: create, dedupe, assign, no-op assign, unassign
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for tags'
);

SELECT lives_ok(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_a')::uuid, '  VIP  ', '#FF0000'
    );
  $$,
  'agent creates VIP tag'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_vip', id::text
FROM public.contact_tags
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND lower(name) = 'vip'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.contact_tags
    WHERE id = tests.fixture('tag_vip')::uuid
      AND workspace_id = tests.fixture('workspace_a')::uuid
      AND deleted_at IS NULL
  ),
  'tag fixture persisted after create'
);

SELECT is(
  (SELECT name FROM public.contact_tags WHERE id = tests.fixture('tag_vip')::uuid),
  'VIP',
  'tag name is trimmed/normalized'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  're-authenticate agent after tag fixture'
);

SELECT throws_like(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_a')::uuid, 'vip', '#00FF00');
  $$,
  '%TAG_NAME_TAKEN%',
  'duplicate tag name is rejected (case-insensitive)'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_added_before', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'tag_added'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local');
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  'assign VIP tag'
);

SELECT lives_ok(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  're-assign VIP tag is idempotent (no error)'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_added_after', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'tag_added'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT is(
  tests.fixture('tag_added_after')::int,
  tests.fixture('tag_added_before')::int + 1,
  'assign emits tag_added once'
);

SELECT is(
  (SELECT count(*)::int
   FROM public.contact_tag_assignments
   WHERE workspace_id = tests.fixture('workspace_a')::uuid
     AND contact_id = tests.fixture('contact_a')::uuid
     AND tag_id = tests.fixture('tag_vip')::uuid),
  1,
  'assign twice yields a single assignment row'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for profile/tag reads'
);

SELECT is(
  (public.get_contact_profile(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('contact_a')::uuid
  ) -> 'tags' -> 0 ->> 'name'),
  'VIP',
  'profile includes assigned tag'
);

SELECT lives_ok(
  $$
    SELECT public.unassign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  'unassign VIP tag'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND event_type = 'tag_removed'
  ),
  'unassign emits tag_removed'
);

SELECT lives_ok(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  're-assign VIP for later soft-delete coverage'
);

SELECT throws_like(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_b')::uuid
    );
  $$,
  '%TAG_NOT_FOUND%',
  'cannot assign workspace B tag to workspace A contact'
);

-- ---------------------------------------------------------------------------
-- Companies: create, domain uniqueness (no auto-merge), link/unlink
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.create_company(
      tests.fixture('workspace_a')::uuid,
      'Acme Corp',
      'Acme.com',
      NULL,
      'Software',
      '11-50'
    );
  $$,
  'agent creates Acme company'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'company_acme', id::text
FROM public.companies
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND lower(name) = 'acme corp'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.companies
    WHERE id = tests.fixture('company_acme')::uuid
      AND workspace_id = tests.fixture('workspace_a')::uuid
      AND deleted_at IS NULL
  ),
  'company fixture persisted after create'
);

SELECT is(
  (SELECT domain FROM public.companies WHERE id = tests.fixture('company_acme')::uuid),
  'acme.com',
  'company domain is lowercased'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  're-authenticate agent for company ops'
);

SELECT throws_like(
  $$
    SELECT public.create_company(
      tests.fixture('workspace_a')::uuid,
      'Acme Twin',
      'acme.com',
      NULL, NULL, NULL
    );
  $$,
  '%COMPANY_DOMAIN_TAKEN%',
  'second company with same domain is rejected (no auto-merge)'
);

SELECT lives_ok(
  $$
    SELECT public.link_contact_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('company_acme')::uuid
    );
  $$,
  'link contact to Acme'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND event_type = 'company_linked'
  ),
  'link emits company_linked'
);

SELECT is(
  (public.get_contact_profile(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('contact_a')::uuid
  ) -> 'company' ->> 'name'),
  'Acme Corp',
  'profile includes linked company'
);

SELECT lives_ok(
  $$
    SELECT public.unlink_contact_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid
    );
  $$,
  'unlink company'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND event_type = 'company_unlinked'
  ),
  'unlink emits company_unlinked'
);

SELECT lives_ok(
  $$
    SELECT public.link_contact_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('company_acme')::uuid
    );
  $$,
  're-link company for soft-delete coverage'
);

SELECT throws_like(
  $$
    SELECT public.link_contact_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('company_b')::uuid
    );
  $$,
  '%COMPANY_NOT_FOUND%',
  'cannot link workspace B company to workspace A contact'
);

-- ---------------------------------------------------------------------------
-- Custom fields: owner/admin defs; agent values; typed validation
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for custom field denial'
);

SELECT throws_like(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'plan',
      'Plan',
      'select',
      '["free","pro"]'::jsonb,
      0,
      false
    );
  $$,
  '%FORBIDDEN%',
  'agent cannot create custom field definitions'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'crm-owner-a@test.local'); $$,
  'authenticate owner for custom field defs'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'plan',
      'Plan',
      'select',
      '["free","pro"]'::jsonb,
      0,
      false
    );
  $$,
  'owner creates select custom field'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'seat_count',
      'Seat count',
      'number',
      '[]'::jsonb,
      1,
      false
    );
  $$,
  'owner creates number custom field'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'renewal_date',
      'Renewal date',
      'date',
      '[]'::jsonb,
      3,
      false
    );
  $$,
  'owner creates date custom field'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'tier',
      'Tier',
      'select',
      '["alpha","beta"]'::jsonb,
      4,
      false
    );
  $$,
  'owner creates tier select field for option-shrink search'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'field_plan', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'plan'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO tests.fixtures (key, value)
SELECT 'field_seats', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'seat_count'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO tests.fixtures (key, value)
SELECT 'field_date', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'renewal_date'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO tests.fixtures (key, value)
SELECT 'field_tier', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'tier'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.custom_field_definitions
    WHERE id = tests.fixture('field_plan')::uuid
      AND workspace_id = tests.fixture('workspace_a')::uuid
      AND deleted_at IS NULL
  ),
  'custom field fixture persisted after create'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('admin_a')::uuid, 'crm-admin-a@test.local'); $$,
  'authenticate admin'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'account_note',
      'Account note',
      'text',
      '[]'::jsonb,
      2,
      false
    );
  $$,
  'admin can create custom field definitions'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'field_notes', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'account_note'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for custom field values'
);

SELECT lives_ok(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_plan')::uuid,
      '"pro"'::jsonb
    );
  $$,
  'agent can set custom field value'
);

SELECT throws_like(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_seats')::uuid,
      '"not-a-number"'::jsonb
    );
  $$,
  '%INVALID_FIELD_VALUE%',
  'wrong type for number field is rejected'
);

SELECT throws_like(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_plan')::uuid,
      '"enterprise"'::jsonb
    );
  $$,
  '%INVALID_FIELD_VALUE%',
  'select value outside options is rejected'
);

SELECT throws_like(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_b')::uuid,
      '"basic"'::jsonb
    );
  $$,
  '%FIELD_NOT_FOUND%',
  'cannot set workspace B custom field on workspace A contact'
);

SELECT throws_like(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_date')::uuid,
      '"today"'::jsonb
    );
  $$,
  '%INVALID_FIELD_VALUE%',
  'strict date rejects relative token today'
);

SELECT throws_like(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_date')::uuid,
      '"2024-02-31"'::jsonb
    );
  $$,
  '%INVALID_FIELD_VALUE%',
  'strict date rejects impossible calendar date 2024-02-31'
);

SELECT lives_ok(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_date')::uuid,
      '"2024-03-15"'::jsonb
    );
  $$,
  'strict date accepts YYYY-MM-DD 2024-03-15'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND event_type = 'custom_field_updated'
  ),
  'set custom field emits custom_field_updated'
);

-- Field type immutability (owner/admin manage defs)
SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'crm-owner-a@test.local'); $$,
  'authenticate owner for field type immutability'
);

SELECT throws_like(
  $$
    SELECT public.update_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('field_plan')::uuid,
      jsonb_build_object('field_type', 'text')
    );
  $$,
  '%FIELD_TYPE_IMMUTABLE%',
  'update field_type is rejected'
);

-- Option removal refreshes search_vector
SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for tier value'
);

SELECT lives_ok(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_tier')::uuid,
      '"alpha"'::jsonb
    );
  $$,
  'assign select option alpha to contact'
);

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'alpha')
    FROM public.contacts
    WHERE id = tests.fixture('contact_a')::uuid
  ),
  'option alpha appears in contacts.search_vector'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'crm-owner-a@test.local'); $$,
  'authenticate owner to shrink select options'
);

SELECT lives_ok(
  $$
    SELECT public.update_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('field_tier')::uuid,
      jsonb_build_object('options', '["beta"]'::jsonb)
    );
  $$,
  'remove option alpha via update_custom_field_definition'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.custom_field_values
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND field_id = tests.fixture('field_tier')::uuid
  ),
  'orphaned select value row is removed after option shrink'
);

SELECT ok(
  NOT (
    SELECT search_vector @@ plainto_tsquery('english', 'alpha')
    FROM public.contacts
    WHERE id = tests.fixture('contact_a')::uuid
  ),
  'option alpha no longer appears in search_vector after shrink'
);

-- Soft-delete custom field definition clears values (no per-contact timeline required)
SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent to set notes value before soft-delete'
);

SELECT lives_ok(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_notes')::uuid,
      '"keep me"'::jsonb
    );
  $$,
  'set text value on field_notes before soft-delete'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'crm-owner-a@test.local'); $$,
  'authenticate owner to soft-delete custom field'
);

SELECT lives_ok(
  $$
    SELECT public.soft_delete_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('field_notes')::uuid
    );
  $$,
  'soft-delete custom field definition'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.custom_field_values
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND field_id = tests.fixture('field_notes')::uuid
  ),
  'soft-delete custom field definition clears values'
);

-- ---------------------------------------------------------------------------
-- No-op profile update emits no timeline; real update does
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'profile_noop_before', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'visitor_profile_updated'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local');
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object(
        'job_title', 'Support Lead',
        'locale', 'en-US',
        'country_code', 'US'
      )
    );
  $$,
  'no-op profile update (same CRM fields)'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'profile_noop_after', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'visitor_profile_updated'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local');
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object('job_title', 'Principal Support')
    );
  $$,
  'real profile update changes job_title'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'profile_real_after', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'visitor_profile_updated'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT is(
  tests.fixture('profile_noop_after')::int,
  tests.fixture('profile_noop_before')::int,
  'no-op profile update emits no visitor_profile_updated'
);

SELECT is(
  tests.fixture('profile_real_after')::int,
  tests.fixture('profile_noop_before')::int + 1,
  'real profile update emits visitor_profile_updated'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for company_id validation'
);

SELECT throws_like(
  $$
    SELECT public.update_visitor_profile(
      tests.fixture('workspace_a')::uuid,
      '00000000-0000-4000-8000-000000000001'::uuid,
      jsonb_build_object('company_id', 'not-a-uuid')
    );
  $$,
  '%Conversation not found%',
  'update_visitor_profile still requires a real conversation (prefix path covered below via contact RPC)'
);

SELECT throws_like(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object('company_id', 'not-a-uuid')
    );
  $$,
  '%INVALID_COMPANY_ID%',
  'invalid company_id raises INVALID_COMPANY_ID'
);

-- ---------------------------------------------------------------------------
-- Soft-deleted tag + company soft-delete (no bulk company_unlinked)
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'company_unlink_before_soft', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'company_unlinked'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local');
    SELECT public.soft_delete_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('company_acme')::uuid
    );
  $$,
  'soft-delete Acme company'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'company_unlink_after_soft', count(*)::text
FROM public.customer_timeline_events
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND contact_id = tests.fixture('contact_a')::uuid
  AND event_type = 'company_unlinked'
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT is(
  tests.fixture('company_unlink_after_soft')::int,
  tests.fixture('company_unlink_before_soft')::int,
  'company soft-delete does not emit per-contact company_unlinked'
);

SELECT is(
  (SELECT company_id FROM public.contacts WHERE id = tests.fixture('contact_a')::uuid),
  NULL,
  'company soft-delete clears contact.company_id'
);

-- Company picker search must use substring match (not loose trigram) so
-- similarly named companies do not bury the typed exact hit past the page limit.
SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for company search'
);

SELECT lives_ok(
  $$
    DO $body$
    BEGIN
      PERFORM public.create_company(
        tests.fixture('workspace_a')::uuid,
        'Bulk Co 001',
        'bulk-search-001.test',
        NULL,
        NULL,
        NULL
      );
      PERFORM public.create_company(
        tests.fixture('workspace_a')::uuid,
        'Bulk Co 050',
        'bulk-search-050.test',
        NULL,
        NULL,
        NULL
      );
      PERFORM public.create_company(
        tests.fixture('workspace_a')::uuid,
        'Bulk Co 101',
        'bulk-search-101.test',
        NULL,
        NULL,
        NULL
      );
    END
    $body$;
  $$,
  'seed similarly named companies for picker search'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM jsonb_array_elements(
      public.list_companies(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'Bulk Co 101', 'limit', 100)
      ) -> 'items'
    ) AS item(value)
  ),
  1,
  'company search q=Bulk Co 101 returns only substring matches'
);

SELECT is(
  (
    SELECT value ->> 'name'
    FROM jsonb_array_elements(
      public.list_companies(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'Bulk Co 101', 'limit', 100)
      ) -> 'items'
    ) AS item(value)
    LIMIT 1
  ),
  'Bulk Co 101',
  'company search surfaces exact Bulk Co 101'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('agent_a')::uuid, 'crm-agent-a@test.local'); $$,
  'authenticate agent for tag soft-delete'
);

SELECT lives_ok(
  $$
    SELECT public.soft_delete_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  'soft-delete VIP tag'
);

SELECT throws_like(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_vip')::uuid
    );
  $$,
  '%TAG_NOT_FOUND%',
  'soft-deleted tag cannot be assigned'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.customer_timeline_events
    WHERE workspace_id = tests.fixture('workspace_a')::uuid
      AND contact_id = tests.fixture('contact_a')::uuid
      AND event_type = 'tag_removed'
      AND metadata_json ->> 'source' = 'tag_deleted'
  ),
  'tag soft-delete emits tag_removed with source=tag_deleted'
);

-- Removed member: created_by SET NULL; tag still usable
SELECT lives_ok(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_a')::uuid, 'OrphanTag', '#112233'
    );
  $$,
  'create tag owned by agent before member removal'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_orphan', id::text
FROM public.contact_tags
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND lower(name) = 'orphantag'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    DELETE FROM public.workspace_members
    WHERE id = tests.fixture('agent_member_a')::uuid;
  $$,
  'remove agent membership (ON DELETE SET NULL on created_by)'
);

SELECT is(
  (SELECT created_by FROM public.contact_tags WHERE id = tests.fixture('tag_orphan')::uuid),
  NULL,
  'removed member nulls tag created_by without deleting the tag'
);

SELECT lives_ok(
  $$ SELECT tests.authenticate_as(tests.fixture('owner_a')::uuid, 'crm-owner-a@test.local'); $$,
  'authenticate owner after agent removal'
);

SELECT lives_ok(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_orphan')::uuid
    );
  $$,
  'tag with null created_by remains assignable'
);

-- ---------------------------------------------------------------------------
-- Search readiness
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object('name', 'Searchable Ada Lovelace')
    );
  $$,
  'set searchable contact name'
);

SELECT ok(
  (SELECT search_vector IS NOT NULL
   FROM public.contacts
   WHERE id = tests.fixture('contact_a')::uuid),
  'search_vector is non-null after profile with name'
);

SELECT ok(
  (
    public.list_contacts(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', 'Lovelace', 'limit', 20)
    ) -> 'items' -> 0 ->> 'id'
  ) = tests.fixture('contact_a'),
  'list_contacts q filter finds contact by name'
);

SELECT ok(
  jsonb_array_length(
    public.list_contacts(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', 'zzznomatchzzz', 'limit', 20)
    ) -> 'items'
  ) = 0,
  'list_contacts q returns empty for non-matching query'
);

SELECT is(
  (SELECT count(*)::int
   FROM public.contacts
   WHERE workspace_id = tests.fixture('workspace_a')::uuid
     AND search_vector IS NOT NULL),
  1,
  'workspace A has searchable contact vector after name update'
);

SELECT ok(
  (SELECT to_tsvector('english', 'Searchable Ada Lovelace') @@ plainto_tsquery('english', 'Ada')),
  'baseline FTS matching sanity for name tokens'
);

-- ---------------------------------------------------------------------------
-- Realtime publication presence
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::int FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename IN (
       'companies', 'contact_tags', 'contact_tag_assignments',
       'custom_field_definitions', 'custom_field_values'
     )),
  5,
  'all CRM tables are in supabase_realtime'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'companies'
      AND policyname = 'companies_select_authenticated'
  ),
  'companies SELECT RLS policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'contact_tags'
      AND policyname = 'contact_tags_select_authenticated'
  ),
  'contact_tags SELECT RLS policy exists'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'custom_field_values'
      AND policyname = 'custom_field_values_select_authenticated'
  ),
  'custom_field_values SELECT RLS policy exists'
);

SELECT * FROM finish();
ROLLBACK;
