CREATE FUNCTION app_private.require_pre_chat_submission(p_workspace_id uuid, p_session public.visitor_sessions)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_session.pre_chat_submitted_at IS NULL AND p_session.operator_initiated_at IS NULL
    AND COALESCE((SELECT (config->>'enabled')::boolean FROM public.workspace_chat_settings WHERE workspace_id=p_workspace_id), false)
    AND NOT EXISTS (SELECT 1 FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=p_session.id)
  THEN RAISE EXCEPTION 'Pre-chat form required'; END IF;
END; $$;
REVOKE ALL ON FUNCTION app_private.require_pre_chat_submission(uuid, public.visitor_sessions) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.widget_submit_pre_chat(p_workspace_id uuid, p_session_token text, p_request_id uuid, p_snapshot jsonb, p_config_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.visitor_sessions; v_conversation public.conversations; v_existing public.pre_chat_submissions;
  v_config public.workspace_chat_settings; v_message_id uuid;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id,p_session_token);
  SELECT * INTO v_session FROM public.visitor_sessions WHERE id=v_session.id AND workspace_id=p_workspace_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.pre_chat_submissions WHERE visitor_session_id=v_session.id AND workspace_id=p_workspace_id;
  IF FOUND THEN RETURN jsonb_build_object('submitted',true,'hasConversation',true); END IF;
  SELECT * INTO v_config FROM public.workspace_chat_settings WHERE workspace_id=p_workspace_id FOR SHARE;
  IF NOT FOUND OR v_config.version<>p_config_version OR NOT COALESCE((v_config.config->>'enabled')::boolean,false)
    THEN RAISE EXCEPTION 'Form settings changed'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>200000 THEN RAISE EXCEPTION 'Invalid form submission'; END IF;
  PERFORM app_private.widget_identify_visitor(p_workspace_id,p_session_token,NULLIF(p_snapshot->>'name',''),NULLIF(p_snapshot->>'email',''),NULLIF(p_snapshot->>'phone',''),NULL,NULL);
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
REVOKE ALL ON FUNCTION public.widget_submit_pre_chat(uuid,text,uuid,jsonb,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_submit_pre_chat(uuid,text,uuid,jsonb,integer) TO service_role;

CREATE FUNCTION public.list_active_visitors(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),
      'url',vs.current_url,'title',vs.current_title,'browser',vs.browser_family,'device',vs.device_type,
      'startedAt',vs.created_at,'lastSeenAt',vs.last_seen_at,'conversationId',c.id,
      'status',CASE WHEN c.id IS NULL THEN 'browsing' WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='visitor') THEN CASE WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='agent') THEN 'chatting' ELSE 'waiting' END WHEN vs.pre_chat_submitted_at IS NOT NULL THEN 'waiting' ELSE 'invited' END) AS data
    FROM public.visitor_sessions vs LEFT JOIN public.contacts ct ON ct.id=vs.contact_id AND ct.workspace_id=p_workspace_id
    LEFT JOIN LATERAL (SELECT * FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=vs.id AND status IN ('open','pending') ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE vs.workspace_id=p_workspace_id AND vs.last_seen_at>now()-interval '90 seconds' AND vs.expires_at>now()
    ORDER BY vs.last_seen_at DESC LIMIT 200
  ) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.list_active_visitors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_visitors(uuid) TO authenticated;

CREATE FUNCTION public.start_visitor_chat(p_workspace_id uuid,p_visitor_session_id uuid,p_body text,p_client_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.visitor_sessions; v_conversation public.conversations; v_result jsonb;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  IF p_client_message_id IS NULL THEN RAISE EXCEPTION 'Request ID required'; END IF;
  SELECT * INTO v_session FROM public.visitor_sessions WHERE id=p_visitor_session_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND OR v_session.last_seen_at<now()-interval '90 seconds' OR v_session.expires_at<=now() THEN RAISE EXCEPTION 'Visitor is no longer online'; END IF;
  UPDATE public.visitor_sessions SET operator_initiated_at=COALESCE(operator_initiated_at,now()) WHERE id=v_session.id;
  v_conversation:=app_private.widget_get_or_create_conversation_for_send(p_workspace_id,v_session.id,v_session.locale,v_session.current_url,v_session.referrer);
  UPDATE public.conversations SET assigned_to=COALESCE(assigned_to,app_private.get_caller_member_id(p_workspace_id)) WHERE id=v_conversation.id;
  v_result:=app_private.send_operator_message(p_workspace_id,v_conversation.id,p_body,p_client_message_id);
  RETURN jsonb_build_object('conversationId',v_conversation.id,'message',v_result->'message');
END; $$;
REVOKE ALL ON FUNCTION public.start_visitor_chat(uuid,uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_visitor_chat(uuid,uuid,text,uuid) TO authenticated;

CREATE FUNCTION public.get_conversation_engagement(p_workspace_id uuid,p_conversation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN (SELECT jsonb_build_object('ip',host(vs.ip_address),'submission',s.snapshot)
    FROM public.conversations c JOIN public.visitor_sessions vs ON vs.id=c.visitor_session_id AND vs.workspace_id=p_workspace_id
    LEFT JOIN public.pre_chat_submissions s ON s.conversation_id=c.id AND s.workspace_id=p_workspace_id
    WHERE c.id=p_conversation_id AND c.workspace_id=p_workspace_id);
END; $$;
REVOKE ALL ON FUNCTION public.get_conversation_engagement(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_conversation_engagement(uuid,uuid) TO authenticated;

-- Guard both visitor text and attachment conversation creation.
CREATE OR REPLACE FUNCTION app_private.widget_get_or_create_conversation_for_send(
  p_workspace_id uuid,
  p_visitor_session_id uuid,
  p_locale text,
  p_source_url text,
  p_referrer text
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation public.conversations;
  v_session public.visitor_sessions;
  v_contact_id uuid;
  v_reopen_hours integer;
  v_conversation_id uuid;
  v_topic_key text;
  v_source_url text;
  v_referrer text;
BEGIN
  v_source_url := app_private.sanitize_page_url(p_source_url);
  v_referrer := app_private.sanitize_page_url(p_referrer);

  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = p_visitor_session_id
    AND vs.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor session not found';
  END IF;

  PERFORM app_private.require_pre_chat_submission(p_workspace_id,v_session);
  v_contact_id := v_session.contact_id;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status IN ('open', 'pending')
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_conversation.contact_id IS NULL AND v_contact_id IS NOT NULL THEN
      UPDATE public.conversations c
      SET contact_id = v_contact_id, updated_at = now()
      WHERE c.id = v_conversation.id
      RETURNING * INTO v_conversation;
    END IF;
    RETURN v_conversation;
  END IF;

  v_reopen_hours := app_private.widget_reopen_window_hours(p_workspace_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status = 'resolved'
    AND c.resolved_at IS NOT NULL
    AND c.resolved_at > now() - make_interval(hours => v_reopen_hours)
  ORDER BY c.resolved_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.conversations c
    SET
      status = 'open',
      resolved_at = NULL,
      resolved_by = NULL,
      locale = COALESCE(c.locale, p_locale),
      contact_id = COALESCE(c.contact_id, v_contact_id),
      updated_at = now()
    WHERE c.id = v_conversation.id
    RETURNING * INTO v_conversation;

    RETURN v_conversation;
  END IF;

  v_topic_key := app_private.generate_visitor_realtime_topic_key();

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
    status,
    channel_type,
    source_url,
    referrer,
    locale,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    p_workspace_id,
    p_visitor_session_id,
    v_contact_id,
    'open',
    'widget',
    v_source_url,
    v_referrer,
    p_locale,
    1,
    v_topic_key
  )
  RETURNING id INTO v_conversation_id;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation_id;

  RETURN v_conversation;
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_conversation
    FROM public.conversations c
    WHERE c.workspace_id = p_workspace_id
      AND c.visitor_session_id = p_visitor_session_id
      AND c.status IN ('open', 'pending')
    ORDER BY c.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    IF v_conversation.contact_id IS NULL AND v_contact_id IS NOT NULL THEN
      UPDATE public.conversations c
      SET contact_id = v_contact_id, updated_at = now()
      WHERE c.id = v_conversation.id
      RETURNING * INTO v_conversation;
    END IF;

    RETURN v_conversation;
END;
$$;
