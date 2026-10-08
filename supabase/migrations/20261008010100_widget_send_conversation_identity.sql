-- Return authoritative conversation identity without an extra read on the send path.
DO $migration$
DECLARE f record; definition text; patched text; n integer:=0;
BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
 WHERE s.nspname='app_private' AND p.proname IN ('widget_send_visitor_message','finalize_visitor_attachment_message') LOOP
  SELECT pg_get_functiondef(f.oid) INTO definition;
  patched:=replace(definition, '''conversation_status'', v_conversation.status', '''conversation_id'', v_conversation.id, ''conversation_status'', v_conversation.status');
  IF patched=definition THEN RAISE EXCEPTION 'Send function changed; review identity patch'; END IF;
  EXECUTE patched;
  n:=n+1;
 END LOOP;
 IF n<>2 THEN RAISE EXCEPTION 'Expected exactly two visitor send functions'; END IF;
END $migration$;
