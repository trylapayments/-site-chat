-- Run after migration inside a rollback transaction; no provider calls.
DO $$
DECLARE w uuid; s uuid; c uuid; sys uuid; first_msg uuid; second_msg uuid; notified integer;
BEGIN
 SELECT workspace_id INTO w FROM public.workspace_members WHERE status='active' AND role='owner' LIMIT 1;
 IF w IS NULL THEN RAISE EXCEPTION 'Missing local fixture'; END IF;
 INSERT INTO public.visitor_sessions(workspace_id,session_token_hash,expires_at)
 VALUES(w,encode(extensions.gen_random_bytes(32),'hex'),now()+interval '1 day') RETURNING id INTO s;
 INSERT INTO public.conversations(workspace_id,visitor_session_id,status) VALUES(w,s,'open') RETURNING id INTO c;
 INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,body,is_internal)
 VALUES(w,c,1,'system','Chat request submitted.',false) RETURNING id INTO sys;
 PERFORM app_private.notify_visitor_message_event(w,c,sys,true,'Chat request submitted.');
 IF EXISTS(SELECT 1 FROM public.notifications WHERE conversation_id=c) THEN RAISE EXCEPTION 'Form notified operator'; END IF;
 INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,body,is_internal,visitor_session_id)
 VALUES(w,c,2,'visitor','Bonjour, pouvez-vous aider?',false,s) RETURNING id INTO first_msg;
 PERFORM app_private.notify_visitor_message_event(w,c,first_msg,false,'Bonjour, pouvez-vous aider?');
 SELECT count(*) INTO notified FROM public.notifications WHERE conversation_id=c AND type='conversation_new';
 IF notified=0 THEN RAISE EXCEPTION 'First visitor message did not notify'; END IF;
 PERFORM app_private.notify_visitor_message_event(w,c,first_msg,true,'Retry');
 IF (SELECT count(*) FROM public.notifications WHERE conversation_id=c AND type='conversation_new')<>notified THEN RAISE EXCEPTION 'Retry duplicated new-chat notification'; END IF;
 INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,body,is_internal,visitor_session_id)
 VALUES(w,c,3,'visitor','More details',false,s) RETURNING id INTO second_msg;
 PERFORM app_private.notify_visitor_message_event(w,c,second_msg,true,'More details');
 IF (SELECT count(*) FROM public.notifications WHERE conversation_id=c AND type='conversation_new')<>notified THEN RAISE EXCEPTION 'Second message became new chat'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE conversation_id=c AND type='visitor_message') THEN RAISE EXCEPTION 'Subsequent message notification lost'; END IF;
 RAISE NOTICE 'PASS: pre-chat silent, first visitor notifies, retry idempotent, later messages preserved';
END $$;
