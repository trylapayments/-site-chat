-- Run after the proposed migration inside BEGIN / ROLLBACK. No outbound provider calls.
SET LOCAL request.jwt.claim.role = 'service_role';
UPDATE public.conversation_email_bridge_config SET enabled=true;
DO $$
DECLARE w uuid; a uuid; s uuid; c uuid; msg uuid; t public.conversation_email_threads; claim jsonb; event uuid:=gen_random_uuid(); before_count integer;
BEGIN
  SELECT workspace_id,id INTO w,a FROM public.workspace_members WHERE status='active' AND role='owner' LIMIT 1;
  IF w IS NULL THEN RAISE EXCEPTION 'Local fixture workspace missing'; END IF;
  INSERT INTO public.visitor_sessions(workspace_id,session_token_hash,expires_at) VALUES(w,encode(extensions.gen_random_bytes(32),'hex'),now()+interval '1 day') RETURNING id INTO s;
  INSERT INTO public.conversations(workspace_id,visitor_session_id,status) VALUES(w,s,'resolved') RETURNING id INTO c;
  INSERT INTO public.pre_chat_submissions(id,workspace_id,visitor_session_id,conversation_id,snapshot) VALUES(gen_random_uuid(),w,s,c,'{"email":"customer@example.test","name":"Email test"}');
  INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,agent_member_id,body,is_internal) VALUES(w,c,1,'agent',a,'Public answer',false) RETURNING id INTO msg;
  INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,agent_member_id,body,is_internal) VALUES(w,c,2,'agent',a,'Private note',true);
  UPDATE public.conversations SET next_message_sequence=3,message_count=2 WHERE id=c;
  IF (SELECT count(*) FROM public.conversation_email_outbox WHERE message_id IN(SELECT id FROM public.messages WHERE conversation_id=c))<>1 THEN RAISE EXCEPTION 'Private note queued'; END IF;
  SELECT * INTO t FROM public.conversation_email_threads WHERE conversation_id=c;
  IF t.recipient_email<>'customer@example.test' THEN RAISE EXCEPTION 'Prechat email fallback lost'; END IF;
  UPDATE public.conversation_email_outbox SET next_attempt_at=now()-interval '1 second' WHERE message_id=msg;
  claim:=public.claim_conversation_email_outbox(10);
  IF jsonb_array_length(claim)<>1 THEN RAISE EXCEPTION 'Claim failed'; END IF;
  IF jsonb_array_length(public.claim_conversation_email_outbox(10))<>0 THEN RAISE EXCEPTION 'Double claim'; END IF;
  IF public.finalize_conversation_email_outbox((claim->0->>'id')::uuid,gen_random_uuid(),'sent') THEN RAISE EXCEPTION 'Wrong lease accepted'; END IF;
  IF NOT public.finalize_conversation_email_outbox((claim->0->>'id')::uuid,(claim->0->>'lease')::uuid,'sent','test-id') THEN RAISE EXCEPTION 'Owner lease rejected'; END IF;
  IF public.receive_conversation_email(event,t.reply_token,'stranger@example.test','Spoof')<>'ignored' THEN RAISE EXCEPTION 'Wrong sender accepted'; END IF;
  IF public.receive_conversation_email(event,repeat('0',64),t.recipient_email,'Wrong token')<>'ignored' THEN RAISE EXCEPTION 'Wrong token accepted'; END IF;
  SELECT count(*) INTO before_count FROM public.messages WHERE conversation_id=c;
  IF public.receive_conversation_email(event,t.reply_token,t.recipient_email,'Customer reply')<>'received' THEN RAISE EXCEPTION 'Reply rejected'; END IF;
  IF public.receive_conversation_email(event,t.reply_token,t.recipient_email,'Customer reply')<>'duplicate' THEN RAISE EXCEPTION 'Retry duplicated'; END IF;
  IF (SELECT count(*) FROM public.messages WHERE conversation_id=c)<>before_count+1 THEN RAISE EXCEPTION 'Message count mismatch'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=c AND sequence_number=3 AND sender_type='visitor' AND body='Customer reply') THEN RAISE EXCEPTION 'Reply in wrong conversation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=c AND status='open' AND next_message_sequence=4 AND message_count=3) THEN RAISE EXCEPTION 'Reopen/counters failed'; END IF;
  INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,agent_member_id,body,is_internal) VALUES(w,c,4,'agent',a,'Read answer',false) RETURNING id INTO msg;
  INSERT INTO public.conversation_visitor_reads(workspace_id,conversation_id,visitor_session_id,last_read_sequence,last_delivered_sequence) VALUES(w,c,s,4,4);
  UPDATE public.conversation_email_outbox SET next_attempt_at=now()-interval '1 second' WHERE message_id=msg;
  PERFORM public.claim_conversation_email_outbox(10);
  IF NOT EXISTS(SELECT 1 FROM public.conversation_email_outbox WHERE message_id=msg AND status='skipped') THEN RAISE EXCEPTION 'Read reply emailed'; END IF;
  RAISE NOTICE 'PASS public-only queue, snapshot address, lease ownership, sender/token checks, idempotent same-thread reply, reopening, read suppression';
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.claim_conversation_email_outbox(1); RAISE EXCEPTION 'Unauthorized RPC allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM reply_token FROM public.conversation_email_threads; RAISE EXCEPTION 'Token visible to operator'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS service-only RPC and token privacy';
END $$;
RESET ROLE;
