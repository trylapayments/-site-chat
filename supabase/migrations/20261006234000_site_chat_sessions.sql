-- Site identity comes from the verified embed origin, never visitor-supplied page URLs.
ALTER TABLE public.visitor_sessions ADD COLUMN site_domain text;
CREATE FUNCTION public.bind_widget_session_site(p_workspace_id uuid,p_session_token text,p_origin text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.visitor_sessions; d text:=regexp_replace(app_private.normalize_origin_host(p_origin),'^www\.','');
BEGIN
 s:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO s FROM public.visitor_sessions WHERE id=s.id FOR UPDATE;
 IF d IS NULL OR d='' THEN RAISE EXCEPTION 'Invalid website'; END IF;
 IF s.site_domain IS NOT NULL AND s.site_domain<>d THEN RAISE EXCEPTION 'Session belongs to another website'; END IF;
 UPDATE public.visitor_sessions SET site_domain=d WHERE id=s.id AND workspace_id=p_workspace_id;
END $$;
REVOKE ALL ON FUNCTION public.bind_widget_session_site(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bind_widget_session_site(uuid,text,text) TO service_role;
CREATE FUNCTION app_private.session_chat_settings(w uuid,s public.visitor_sessions)
RETURNS public.workspace_chat_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.workspace_chat_settings; site public.site_chat_settings;
BEGIN
 SELECT * INTO r FROM public.workspace_chat_settings WHERE workspace_id=w;
 SELECT * INTO site FROM public.site_chat_settings WHERE workspace_id=w AND domain=s.site_domain;
 IF FOUND THEN r.workspace_id:=w; r.config:=site.config; r.version:=site.version; r.updated_at:=site.updated_at; END IF;
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION app_private.session_chat_settings(uuid,public.visitor_sessions) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION app_private.require_pre_chat_submission(p_workspace_id uuid,p_session public.visitor_sessions)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE settings public.workspace_chat_settings;
BEGIN
 settings:=app_private.session_chat_settings(p_workspace_id,p_session);
 IF p_session.pre_chat_submitted_at IS NULL AND p_session.operator_initiated_at IS NULL
 AND COALESCE((settings.config->>'enabled')::boolean,false)
 AND NOT EXISTS(SELECT 1 FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=p_session.id)
 THEN RAISE EXCEPTION 'Pre-chat form required'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.widget_submit_pre_chat(p_workspace_id uuid, p_session_token text, p_request_id uuid, p_snapshot jsonb, p_config_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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

CREATE OR REPLACE FUNCTION public.widget_rate_conversation(p_workspace_id uuid,p_session_token text,p_conversation_id uuid,p_score integer,p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.visitor_sessions; c public.conversations; v_rating public.conversation_ratings;
BEGIN
 s:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND visitor_session_id=s.id FOR UPDATE;
 IF c.id IS NULL OR c.status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'Conversation is not complete'; END IF;
 IF COALESCE((app_private.session_chat_settings(p_workspace_id,s)).config->>'ratingEnabled','false')<>'true' THEN RAISE EXCEPTION 'Ratings are disabled'; END IF;
 INSERT INTO public.conversation_ratings(conversation_id,workspace_id,score,comment) VALUES(c.id,p_workspace_id,p_score,trim(p_comment)) ON CONFLICT(conversation_id) DO NOTHING;
 SELECT * INTO v_rating FROM public.conversation_ratings WHERE conversation_id=c.id;
 RETURN jsonb_build_object('score',v_rating.score,'comment',v_rating.comment);
END; $$;
REVOKE ALL ON FUNCTION public.widget_rate_conversation(uuid,text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_rate_conversation(uuid,text,uuid,integer,text) TO service_role;
