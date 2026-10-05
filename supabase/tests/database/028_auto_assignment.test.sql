\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);
TRUNCATE tests.fixtures;
DO $$
DECLARE uid uuid;other uuid;wid uuid;sid uuid;cid uuid;r jsonb;
BEGIN
 uid:=tests.create_auth_user('auto-owner@test.local');
 other:=tests.create_auth_user('auto-agent@test.local');
 PERFORM tests.authenticate_as(uid,'auto-owner@test.local');
 wid:=(public.create_workspace('Auto assignment','auto-assignment')->>'workspace_id')::uuid;
 PERFORM tests.clear_auth();
 INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(wid,other,'agent','active');
 PERFORM tests.clear_auth();
 r:=public.widget_create_or_resume_visitor_session(p_workspace_id=>wid);
 SELECT id INTO sid FROM public.visitor_sessions WHERE workspace_id=wid LIMIT 1;
 INSERT INTO public.conversations(workspace_id,visitor_session_id,status) VALUES(wid,sid,'open') RETURNING id INTO cid;
 INSERT INTO tests.fixtures VALUES ('user',uid::text),('other',other::text),('workspace',wid::text),('conversation',cid::text),('member',(SELECT id::text FROM public.workspace_members WHERE workspace_id=wid AND user_id=uid));
END; $$;
SELECT tests.authenticate_as(tests.fixture('user')::uuid,'auto-owner@test.local');
SELECT public.send_operator_message(tests.fixture('workspace')::uuid,tests.fixture('conversation')::uuid,'First reply','00000000-0000-4000-8000-000000000028');
SELECT is((SELECT assigned_to::text FROM public.conversations WHERE id=tests.fixture('conversation')::uuid),tests.fixture('member'),'First reply claims unassigned chat');
SELECT is((SELECT assignment_version FROM public.conversations WHERE id=tests.fixture('conversation')::uuid),1::bigint,'Claim advances revision once');
SELECT public.send_operator_message(tests.fixture('workspace')::uuid,tests.fixture('conversation')::uuid,'First reply','00000000-0000-4000-8000-000000000028');
SELECT is((SELECT assignment_version FROM public.conversations WHERE id=tests.fixture('conversation')::uuid),1::bigint,'Retry does not claim twice');
SELECT tests.authenticate_as(tests.fixture('other')::uuid,'auto-agent@test.local');
SELECT public.send_operator_message(tests.fixture('workspace')::uuid,tests.fixture('conversation')::uuid,'Second operator reply');
SELECT is((SELECT assigned_to::text FROM public.conversations WHERE id=tests.fixture('conversation')::uuid),tests.fixture('member'),'Other operator reply does not steal assignment');
SELECT is((SELECT assignment_version FROM public.conversations WHERE id=tests.fixture('conversation')::uuid),1::bigint,'Existing assignment revision stays stable');
SELECT * FROM finish();
ROLLBACK;
