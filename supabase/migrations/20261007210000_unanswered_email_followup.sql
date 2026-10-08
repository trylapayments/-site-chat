CREATE TABLE public.conversation_reply_contacts (
 conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 visitor_session_id uuid NOT NULL REFERENCES public.visitor_sessions(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(length(email)<=254),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_reply_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_reply_contacts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.conversation_reply_contacts TO service_role;
CREATE FUNCTION public.widget_save_reply_email(p_workspace_id uuid,p_session_token text,p_email text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_session public.visitor_sessions; v_context jsonb; v_config public.workspace_chat_settings; v_id uuid;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 v_session:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO v_session FROM public.visitor_sessions WHERE id=v_session.id AND workspace_id=p_workspace_id FOR UPDATE;
 v_context:=public.widget_conversation_context(p_workspace_id,p_session_token);
 v_id:=NULLIF(v_context->>'conversationId','')::uuid;
 IF v_id IS NULL THEN RETURN false; END IF;
 IF p_email IS NULL THEN RETURN EXISTS(SELECT 1 FROM public.conversation_reply_contacts WHERE conversation_id=v_id AND workspace_id=p_workspace_id AND visitor_session_id=v_session.id); END IF;
 v_config:=app_private.session_chat_settings(p_workspace_id,v_session);
 IF NOT coalesce((v_config.config->>'unansweredEmailEnabled')::boolean,true) THEN RAISE EXCEPTION 'Email follow-up disabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
 IF length(p_email)>254 OR p_email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' THEN RAISE EXCEPTION 'Invalid email'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=v_id AND workspace_id=p_workspace_id AND visitor_session_id=v_session.id AND status IN ('open','pending')) THEN RAISE EXCEPTION 'Conversation unavailable'; END IF;
 INSERT INTO public.conversation_reply_contacts(conversation_id,workspace_id,visitor_session_id,email)
 VALUES(v_id,p_workspace_id,v_session.id,lower(trim(p_email)))
 ON CONFLICT(conversation_id) DO UPDATE SET email=EXCLUDED.email,updated_at=now()
 WHERE conversation_reply_contacts.workspace_id=p_workspace_id AND conversation_reply_contacts.visitor_session_id=v_session.id;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.widget_save_reply_email(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_save_reply_email(uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.queue_customer_reply_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_thread uuid;
BEGIN
  IF NEW.sender_type <> 'agent' OR NEW.is_internal OR NOT EXISTS(SELECT 1 FROM public.conversation_email_bridge_config WHERE enabled) THEN RETURN NEW; END IF;
  SELECT lower(trim(coalesce(f.email,nullif(p.snapshot->>'email',''),ct.email))) INTO v_email
  FROM public.conversations c LEFT JOIN public.conversation_reply_contacts f ON f.conversation_id=c.id AND f.workspace_id=c.workspace_id LEFT JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
  LEFT JOIN LATERAL (SELECT snapshot FROM public.pre_chat_submissions WHERE conversation_id=c.id AND workspace_id=c.workspace_id ORDER BY created_at DESC LIMIT 1) p ON true
  WHERE c.id=NEW.conversation_id AND c.workspace_id=NEW.workspace_id;
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' THEN RETURN NEW; END IF;
  INSERT INTO public.conversation_email_threads(workspace_id,conversation_id,recipient_email)
  VALUES(NEW.workspace_id,NEW.conversation_id,v_email)
  ON CONFLICT(conversation_id,recipient_email) DO UPDATE SET expires_at=now()+interval '90 days'
  RETURNING id INTO v_thread;
  INSERT INTO public.conversation_email_outbox(thread_id,message_id,body,sender_label)
  VALUES(v_thread,NEW.id,NEW.body,coalesce(app_private.member_display_label(NEW.agent_member_id),'Mill team')) ON CONFLICT(message_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.queue_customer_reply_email() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.widget_conversation_context(p_workspace_id uuid,p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.visitor_sessions; c public.conversations;
BEGIN
 s:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO c FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=s.id
 ORDER BY created_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('replyEmailSaved',EXISTS(SELECT 1 FROM public.conversation_reply_contacts WHERE conversation_id=c.id AND workspace_id=p_workspace_id AND visitor_session_id=s.id) OR EXISTS(SELECT 1 FROM public.pre_chat_submissions WHERE conversation_id=c.id AND workspace_id=p_workspace_id AND NULLIF(snapshot->>'email','') IS NOT NULL) OR EXISTS(SELECT 1 FROM public.contacts WHERE id=c.contact_id AND workspace_id=p_workspace_id AND NULLIF(email,'') IS NOT NULL),'conversationId',c.id,'conversationStatus',c.status,
 'rating',(SELECT jsonb_build_object('score',score,'comment',comment) FROM public.conversation_ratings WHERE conversation_id=c.id AND workspace_id=p_workspace_id),
 'messageAgents',COALESCE((SELECT jsonb_object_agg(m.id, jsonb_build_object('name',COALESCE(ap.display_name,'Agent'),'avatarPath',ap.avatar_path))
 FROM public.messages m LEFT JOIN public.agent_profiles ap ON ap.member_id=m.agent_member_id AND ap.workspace_id=m.workspace_id
 WHERE m.conversation_id=c.id AND m.workspace_id=p_workspace_id AND m.sender_type='agent' AND NOT m.is_internal),'{}'::jsonb));
END; $$;
