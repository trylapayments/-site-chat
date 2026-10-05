\ir helpers/000_helpers.psql
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(16);
TRUNCATE tests.fixtures;
DO $$
DECLARE owner_id uuid; viewer_id uuid; wid uuid; result jsonb; sid uuid;
BEGIN
 owner_id:=tests.create_auth_user('engagement-owner@test.local');viewer_id:=tests.create_auth_user('engagement-viewer@test.local');
 PERFORM tests.authenticate_as(owner_id,'engagement-owner@test.local');
 wid:=(public.create_workspace('Engagement test','engagement-test')->>'workspace_id')::uuid;
 PERFORM tests.clear_auth();
 INSERT INTO public.workspace_members(workspace_id,user_id,role,status) VALUES(wid,viewer_id,'viewer','active');
 INSERT INTO public.workspace_chat_settings(workspace_id,config) VALUES(wid,'{"enabled":true}');
 result:=public.widget_create_or_resume_visitor_session(p_workspace_id=>wid,p_locale=>'en');
 SELECT id INTO sid FROM public.visitor_sessions WHERE workspace_id=wid ORDER BY created_at DESC LIMIT 1;
 INSERT INTO tests.fixtures VALUES('workspace',wid::text),('session',sid::text),('token',result->>'session_token'),('owner',owner_id::text),('viewer',viewer_id::text);
END; $$;
SELECT ok(NOT has_table_privilege('anon','public.pre_chat_submissions','SELECT'),'Visitors cannot list pre-chat answers');
SELECT ok(NOT has_table_privilege('authenticated','public.workspace_chat_settings','UPDATE'),'Form settings cannot be forged through direct client writes');
SELECT ok(NOT has_function_privilege('anon','public.widget_submit_pre_chat(uuid,text,uuid,jsonb,integer)','EXECUTE'),'Anonymous clients cannot invoke service-only form RPC');
SELECT ok(NOT has_function_privilege('authenticated','public.widget_engagement_heartbeat(uuid,text,text)','EXECUTE'),'Operators cannot use visitor capabilities through raw RPC');
SELECT throws_ok(format('SELECT public.widget_send_visitor_message(%L::uuid,%L,%L)',tests.fixture('workspace'),tests.fixture('token'),'Bypass attempt'),'P0001','Pre-chat form required','Visitor text cannot bypass required form');
SELECT throws_ok(format('SELECT public.widget_ensure_conversation_for_attachments(%L::uuid,%L)',tests.fixture('workspace'),tests.fixture('token')),'P0001','Pre-chat form required','Visitor attachments cannot bypass required form');
SELECT is((SELECT count(*)::integer FROM public.conversations WHERE visitor_session_id=tests.fixture('session')::uuid),0,'Opening form does not create a conversation');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE workspace_id=tests.fixture('workspace')::uuid),0,'Opening form does not notify the team');
DO $$ BEGIN
 PERFORM public.widget_submit_pre_chat(tests.fixture('workspace')::uuid,tests.fixture('token'),'11111111-1111-4111-8111-111111111111','{"name":"Visitor","email":"visitor@example.com","phone":"","fields":[{"id":"company","label":"Company","type":"text","value":"Original company"}]}',1);
 PERFORM public.widget_submit_pre_chat(tests.fixture('workspace')::uuid,tests.fixture('token'),'11111111-1111-4111-8111-111111111111','{"name":"Changed"}',1);
 INSERT INTO tests.fixtures SELECT 'conversation',conversation_id::text FROM public.pre_chat_submissions WHERE visitor_session_id=tests.fixture('session')::uuid;
END; $$;
SELECT is((SELECT count(*)::integer FROM public.messages WHERE conversation_id=tests.fixture('conversation')::uuid),1,'Submission retries create one durable request');
SELECT ok((SELECT count(*)>0 FROM public.notifications WHERE conversation_id=tests.fixture('conversation')::uuid),'Submitted form notifies the team');
SELECT is((SELECT snapshot->'fields'->0->>'label' FROM public.pre_chat_submissions WHERE visitor_session_id=tests.fixture('session')::uuid),'Company','Snapshot preserves submitted field labels');
SELECT tests.authenticate_as(tests.fixture('owner')::uuid,'engagement-owner@test.local');
SELECT is((SELECT item->>'status' FROM jsonb_array_elements(public.list_active_visitors(tests.fixture('workspace')::uuid)) item WHERE item->>'id'=tests.fixture('session')),'waiting','Submitted form waits for an operator before a visitor message');
SELECT public.start_visitor_chat(tests.fixture('workspace')::uuid,tests.fixture('session')::uuid,'Welcome',gen_random_uuid());
SELECT is((SELECT item->>'status' FROM jsonb_array_elements(public.list_active_visitors(tests.fixture('workspace')::uuid)) item WHERE item->>'id'=tests.fixture('session')),'chatting','Operator reply starts chatting after a form submission');
SELECT tests.clear_auth();
SELECT lives_ok(format('SELECT public.widget_send_visitor_message(%L::uuid,%L,%L)',tests.fixture('workspace'),tests.fixture('token'),'After form'),'Visitor can reply after submission');
SELECT tests.authenticate_as(tests.fixture('viewer')::uuid,'engagement-viewer@test.local');
SELECT throws_ok(format('SELECT public.start_visitor_chat(%L::uuid,%L::uuid,%L,gen_random_uuid())',tests.fixture('workspace'),tests.fixture('session'),'Hello'),'P0001','Insufficient permissions','Viewer cannot initiate chats');
SELECT throws_ok('SELECT public.list_active_visitors(''00000000-0000-4000-8000-000000000000''::uuid)','P0001','Workspace not accessible','Visitors list cannot expose another workspace');
SELECT tests.clear_auth();
SELECT * FROM finish();
ROLLBACK;
