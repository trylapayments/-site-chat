\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);
TRUNCATE tests.fixtures;
DO $$ DECLARE owner_id uuid; tenant_id uuid; support_id uuid; viewer_id uuid; w uuid; BEGIN
 owner_id=tests.create_auth_user('platform-owner@test.local');tenant_id=tests.create_auth_user('platform-tenant@test.local');support_id=tests.create_auth_user('platform-support@test.local');viewer_id=tests.create_auth_user('platform-viewer@test.local');
 PERFORM tests.authenticate_as(tenant_id,'platform-tenant@test.local');w=(public.create_workspace('Platform fixture','platform-fixture')->>'workspace_id')::uuid;PERFORM tests.clear_auth();
 INSERT INTO public.platform_administrators(user_id,role) VALUES(owner_id,'owner'),(support_id,'support'),(viewer_id,'viewer');
 INSERT INTO tests.fixtures VALUES('owner',owner_id::text),('tenant',tenant_id::text),('support',support_id::text),('viewer',viewer_id::text),('workspace',w::text);
END $$;
SELECT ok(NOT has_table_privilege('authenticated','public.platform_administrators','SELECT'),'Tenant users cannot read platform administrators');
SELECT ok(NOT has_function_privilege('authenticated','public.platform_admin_apply(uuid,uuid,text,jsonb,text,integer)','EXECUTE'),'Tenant users cannot invoke platform mutations');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''note'',''{"body":"Denied"}'',''Test reason'',0)',tests.fixture('tenant'),tests.fixture('workspace')),'42501','Platform action denied','Tenant owner cannot act as platform owner');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''note'',''{"body":"Denied"}'',''Test reason'',0)',tests.fixture('viewer'),tests.fixture('workspace')),'42501','Platform action denied','Read-only platform user cannot mutate');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''status'',''{"status":"suspended"}'',''Test reason'',0)',tests.fixture('support'),tests.fixture('workspace')),'42501','Platform action denied','Support cannot suspend a company');
SELECT is(public.platform_admin_apply(tests.fixture('support')::uuid,tests.fixture('workspace')::uuid,'note','{"body":"Support note"}','Customer support',0),1,'Support can add an audited note');
SELECT is((SELECT count(*)::integer FROM public.platform_audit_log WHERE workspace_id=tests.fixture('workspace')::uuid),1,'Audit and mutation are committed together');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''note'',''{"body":"Stale"}'',''Test reason'',0)',tests.fixture('owner'),tests.fixture('workspace')),'40001','Workspace changed. Refresh before saving.','Stale writes are rejected');
SELECT is((SELECT count(*)::integer FROM public.platform_customer_notes WHERE workspace_id=tests.fixture('workspace')::uuid),1,'Stale write leaves no partial note');
SELECT is(public.platform_admin_apply(tests.fixture('owner')::uuid,tests.fixture('workspace')::uuid,'status','{"status":"suspended"}','Suspend for testing',1),2,'Owner can suspend company');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''member'',%L,''Ownership test'',2)',tests.fixture('owner'),tests.fixture('workspace'),(SELECT jsonb_build_object('member_id',id,'role','viewer','status','deactivated')::text FROM public.workspace_members WHERE workspace_id=tests.fixture('workspace')::uuid AND role='owner')),'P0001','The last active owner cannot be removed','Last owner protection holds inside transaction');
SELECT ok((SELECT NOT (before_json->'workspace' ? 'settings_json') FROM public.platform_audit_log WHERE workspace_id=tests.fixture('workspace')::uuid LIMIT 1),'Audit does not expose arbitrary workspace settings');
SELECT throws_ok(format('SELECT public.platform_admin_set_administrator(%L,%L,''owner'',true,''Grant test'')',tests.fixture('tenant'),tests.fixture('viewer')),'42501','Platform action denied','Tenant cannot grant platform permissions');
SELECT lives_ok(format('SELECT public.platform_admin_set_administrator(%L,%L,''owner'',true,''Grant test'')',tests.fixture('owner'),tests.fixture('viewer')),'Owner can grant confirmed account platform access');
SELECT lives_ok(format('SELECT public.platform_admin_set_administrator(%L,%L,''support'',true,''Transfer ownership test'')',tests.fixture('owner'),tests.fixture('owner')),'Owner can step down after another owner is present');
SELECT throws_ok(format('SELECT public.platform_admin_set_administrator(%L,%L,''viewer'',false,''Disable test'')',tests.fixture('viewer'),tests.fixture('viewer')),'P0001','The last platform owner cannot be removed','Last platform owner cannot disable themselves');
SELECT * FROM finish();ROLLBACK;
