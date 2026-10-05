\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);
TRUNCATE tests.fixtures;
DO $$
DECLARE uid uuid;wid uuid;other uuid;r jsonb;sid uuid;cid uuid;
BEGIN
  uid:=tests.create_auth_user('geo-owner@test.local');
  PERFORM tests.authenticate_as(uid,'geo-owner@test.local');
  wid:=(public.create_workspace('Geo test','geo-test')->>'workspace_id')::uuid;
  other:=(public.create_workspace('Other geo','other-geo-test')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();
  r:=public.widget_create_or_resume_visitor_session(p_workspace_id=>wid,p_locale=>'ru');
  SELECT id INTO sid FROM public.visitor_sessions WHERE workspace_id=wid LIMIT 1;
  INSERT INTO public.conversations(workspace_id,visitor_session_id,status) VALUES(wid,sid,'open') RETURNING id INTO cid;
  INSERT INTO tests.fixtures VALUES('user',uid::text),('workspace',wid::text),('other',other::text),('token',r->>'session_token'),('conversation',cid::text),('session',sid::text);
END; $$;
SELECT ok(NOT has_function_privilege('authenticated','public.record_widget_ip_country(uuid,text,text)','EXECUTE'),'Operators cannot forge IP country');
SELECT ok(NOT has_function_privilege('anon','public.conversation_ip_countries(uuid,uuid[])','EXECUTE'),'Visitors cannot enumerate location');
SELECT public.record_widget_ip_country(tests.fixture('workspace')::uuid,tests.fixture('token'),'GB');
SELECT is((SELECT ip_country_code FROM public.visitor_sessions WHERE id=tests.fixture('session')::uuid),'GB','Trusted IP country saved independently of Russian locale');
SELECT throws_ok(format('SELECT public.record_widget_ip_country(%L::uuid,%L,%L)',tests.fixture('workspace'),tests.fixture('token'),'USA'),'P0001','Invalid country','Malformed country rejected');
SELECT tests.authenticate_as(tests.fixture('user')::uuid,'geo-owner@test.local');
SELECT is(public.conversation_ip_countries(tests.fixture('workspace')::uuid,ARRAY[tests.fixture('conversation')::uuid])->>tests.fixture('conversation'),'GB','Authorized operator sees stored country');
SELECT is(public.conversation_ip_countries(tests.fixture('other')::uuid,ARRAY[tests.fixture('conversation')::uuid]),'{}'::jsonb,'Other workspace cannot expose country');
SELECT tests.clear_auth();
SELECT public.record_widget_ip_country(tests.fixture('workspace')::uuid,tests.fixture('token'),NULL);
SELECT ok((SELECT ip_country_code IS NULL FROM public.visitor_sessions WHERE id=tests.fixture('session')::uuid),'Unknown country clears stale flag');
SELECT ok(has_function_privilege('service_role','public.record_widget_ip_country(uuid,text,text)','EXECUTE'),'Server may record edge country');
SELECT * FROM finish();
ROLLBACK;
