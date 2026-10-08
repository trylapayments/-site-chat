-- Accept repeat-email pre-chat requests without merging unsigned visitor identities.
CREATE OR REPLACE FUNCTION "public"."widget_submit_pre_chat"("p_workspace_id" "uuid", "p_session_token" "text", "p_request_id" "uuid", "p_snapshot" "jsonb", "p_config_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_session public.visitor_sessions; v_conversation public.conversations; v_existing public.pre_chat_submissions;
  v_config public.workspace_chat_settings; v_message_id uuid;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id,p_session_token);
  SELECT * INTO v_session FROM public.visitor_sessions WHERE id=v_session.id AND workspace_id=p_workspace_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.pre_chat_submissions WHERE visitor_session_id=v_session.id AND workspace_id=p_workspace_id;
  IF FOUND THEN RETURN jsonb_build_object('submitted',true,'hasConversation',true); END IF;
  v_config:=app_private.session_chat_settings(p_workspace_id,v_session);
  IF v_config.workspace_id IS NULL OR v_config.version<>p_config_version OR NOT COALESCE((v_config.config->>'enabled')::boolean,false)
    THEN RAISE EXCEPTION 'Form settings changed'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>200000 THEN RAISE EXCEPTION 'Invalid form submission'; END IF;
  -- A submitted email is contact information, not proof of ownership of another contact.
  -- Keep this session isolated; the operator can read the submitted email from its snapshot.
  BEGIN
    PERFORM app_private.widget_identify_visitor(p_workspace_id,p_session_token,NULLIF(p_snapshot->>'name',''),NULLIF(p_snapshot->>'email',''),NULLIF(p_snapshot->>'phone',''),NULL,NULL);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Email already belongs to another visitor in this workspace' THEN RAISE; END IF;
    PERFORM app_private.widget_identify_visitor(p_workspace_id,p_session_token,NULLIF(p_snapshot->>'name',''),NULL,NULLIF(p_snapshot->>'phone',''),NULL,NULL);
  END;
  UPDATE public.visitor_sessions SET pre_chat_submitted_at=now() WHERE id=v_session.id RETURNING * INTO v_session;
  v_conversation := app_private.widget_get_or_create_conversation_for_send(p_workspace_id,v_session.id,v_session.locale,v_session.current_url,v_session.referrer);
  INSERT INTO public.pre_chat_submissions(id,workspace_id,visitor_session_id,conversation_id,snapshot)
    VALUES(p_request_id,p_workspace_id,v_session.id,v_conversation.id,p_snapshot);
  -- A system event requests help without pretending that the visitor typed it.
  INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,body,is_internal)
    VALUES(p_workspace_id,v_conversation.id,v_conversation.next_message_sequence,'system','Chat request submitted.',false) RETURNING id INTO v_message_id;
  UPDATE public.conversations SET next_message_sequence=next_message_sequence+1,message_count=message_count+1,last_message_at=now(),last_message_preview='Chat request submitted.',updated_at=now() WHERE id=v_conversation.id;
  PERFORM app_private.notify_visitor_message_event(p_workspace_id,v_conversation.id,v_message_id,true,'Chat request submitted.');
  RETURN jsonb_build_object('submitted',true,'hasConversation',true);
END; $$;

