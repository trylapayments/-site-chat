\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);
TRUNCATE tests.fixtures;
DO $$ DECLARE o uuid; t uuid; s uuid; w uuid; BEGIN
 o=tests.create_auth_user('independent-owner@test.local');t=tests.create_auth_user('independent-tenant@test.local');s=tests.create_auth_user('independent-support@test.local');
 PERFORM tests.authenticate_as(t,'independent-tenant@test.local');w=(public.create_workspace('Independent fixture','independent-fixture')->>'workspace_id')::uuid;PERFORM tests.clear_auth();
 INSERT INTO public.platform_administrators(user_id,role) VALUES(o,'owner'),(s,'support');
 INSERT INTO tests.fixtures VALUES('owner',o::text),('support',s::text),('workspace',w::text);
 INSERT INTO public.workspace_chargebee_accounts(workspace_id,site,customer_id) VALUES(w,'millchat-test','independent-test-customer');
END $$;
SELECT ok((SELECT access_mode='trial' AND trial_ends_at>now()+interval '13 days' AND trial_ends_at<=now()+interval '14 days' FROM public.workspace_admin_controls WHERE workspace_id=tests.fixture('workspace')::uuid),'New workspace receives finite fourteen day trial');
SELECT is(public.platform_admin_apply(tests.fixture('owner')::uuid,tests.fixture('workspace')::uuid,'plan','{"plan_id":"business","expires_at":null}','Complimentary grant',0),1,'Owner grants complimentary plan with connected billing');
SELECT is((SELECT plan_id FROM public.workspace_admin_controls WHERE workspace_id=tests.fixture('workspace')::uuid),'business','Grant persists');
SELECT throws_ok(format('SELECT public.platform_admin_apply(%L,%L,''plan'',''{"plan_id":"business","expires_at":null}'',''Denied grant'',1)',tests.fixture('support'),tests.fixture('workspace')),'42501','Platform action denied','Support cannot grant paid plan');
SELECT is(public.platform_admin_apply(tests.fixture('support')::uuid,tests.fixture('workspace')::uuid,'trial',jsonb_build_object('trial_ends_at',now()+interval '30 days'),'Extend independently',1),2,'Trial can be extended despite connected billing');
SELECT ok((SELECT access_mode='trial' AND plan_id IS NULL FROM public.workspace_admin_controls WHERE workspace_id=tests.fixture('workspace')::uuid),'Trial replaces complimentary grant');
SELECT is(public.platform_admin_apply(tests.fixture('owner')::uuid,tests.fixture('workspace')::uuid,'plan','{"plan_id":null,"expires_at":null}','Return to billing',2),3,'Owner revokes manual access');
SELECT ok((SELECT access_mode='standard' AND trial_ends_at IS NULL AND plan_id IS NULL FROM public.workspace_admin_controls WHERE workspace_id=tests.fixture('workspace')::uuid),'Revocation restores billing defaults');
SELECT is((SELECT customer_id FROM public.workspace_chargebee_accounts WHERE workspace_id=tests.fixture('workspace')::uuid),'independent-test-customer','Manual operations preserve provider account');
SELECT is((SELECT count(*)::integer FROM public.platform_audit_log WHERE workspace_id=tests.fixture('workspace')::uuid),3,'Each successful change audited once');
SELECT * FROM finish();ROLLBACK;
