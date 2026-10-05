\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);
TRUNCATE tests.fixtures;
DO $$ DECLARE uid uuid; aid uuid; wid uuid; BEGIN
 uid:=tests.create_auth_user('company-owner@test.local');aid:=tests.create_auth_user('company-agent@test.local');
 PERFORM tests.authenticate_as(uid,'company-owner@test.local');
 wid:=(public.create_workspace('Company original','company-launcher-test')->>'workspace_id')::uuid;
 PERFORM tests.clear_auth();
 INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(wid,aid,'agent','active');
 INSERT INTO tests.fixtures VALUES('owner',uid::text),('agent',aid::text),('workspace',wid::text);
END; $$;
SELECT tests.authenticate_as(tests.fixture('owner')::uuid,'company-owner@test.local');
SELECT lives_ok(format('SELECT public.update_workspace_company(%L::uuid,%L::jsonb)',tests.fixture('workspace'),'{"name":"Company renamed","legalName":"Company LLC","country":"US"}'),'Owner edits company');
SELECT is(public.get_workspace_company(tests.fixture('workspace')::uuid)->>'name','Company renamed','Company name saved');
SELECT is((SELECT slug FROM public.workspaces WHERE id=tests.fixture('workspace')::uuid),'company-launcher-test','Rename preserves installation URL');
SELECT tests.authenticate_as(tests.fixture('agent')::uuid,'company-agent@test.local');
SELECT is(public.get_workspace_company(tests.fixture('workspace')::uuid)->>'legalName','Company LLC','Agent can read company');
SELECT throws_ok(format('SELECT public.update_workspace_company(%L::uuid,%L::jsonb)',tests.fixture('workspace'),'{"name":"Hijack"}'),NULL,NULL,'Agent cannot edit company');
SELECT throws_ok('SELECT * FROM public.workspace_billing_accounts', '42501', NULL,'Client cannot read Stripe customer references');
SELECT tests.clear_auth();
SELECT is(app_private.widget_public_config_payload(app_private.widget_appearance_defaults(),0,'null'::jsonb)->>'launcherText','Online chat','Legacy appearance has safe launcher label');
SELECT lives_ok($q$SELECT app_private.validate_widget_appearance(app_private.widget_appearance_defaults() || '{"launcherShape":"rectangle","launcherWidth":220,"mobileLauncher":{"launcherShape":"circle","launcherSize":"sm","launcherText":"Chat","launcherWidth":180,"launcherColor":"#123456","launcherPosition":"bottom-left","launcherOffsetX":8,"launcherOffsetY":8}}'::jsonb)$q$,'Valid desktop rectangle and mobile circle');
SELECT throws_ok($q$SELECT app_private.validate_widget_appearance(app_private.widget_appearance_defaults() || '{"launcherWidth":900}'::jsonb)$q$,NULL,NULL,'Reject oversized launcher');
SELECT * FROM finish();
ROLLBACK;
