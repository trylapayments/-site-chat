-- Personal identities are scoped to an active membership; browser clients cannot write them.
CREATE TABLE public.agent_profiles (
 member_id uuid PRIMARY KEY REFERENCES public.workspace_members(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 100),
 avatar_path text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_profiles FROM anon, authenticated;
GRANT ALL ON public.agent_profiles TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('agent-avatars','agent-avatars',false,2097152,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO NOTHING;
CREATE OR REPLACE FUNCTION app_private.member_display_label(p_member_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE(ap.display_name,u.email,'Unknown member') FROM public.workspace_members wm
 JOIN auth.users u ON u.id=wm.user_id LEFT JOIN public.agent_profiles ap ON ap.member_id=wm.id AND ap.workspace_id=wm.workspace_id
 WHERE wm.id=p_member_id;
$$;
CREATE TABLE public.conversation_ratings (
 conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 score smallint NOT NULL CHECK(score BETWEEN 1 AND 5),
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_ratings FROM anon,authenticated;
GRANT ALL ON public.conversation_ratings TO service_role;
CREATE TABLE public.conversation_transcript_requests (
 id uuid PRIMARY KEY,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
 recipient text NOT NULL CHECK(length(recipient)<=254),
 status text NOT NULL DEFAULT 'sending' CHECK(status IN ('sending','sent','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_transcript_rate_idx ON public.conversation_transcript_requests(conversation_id,created_at DESC);
ALTER TABLE public.conversation_transcript_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_transcript_requests FROM anon,authenticated;
GRANT ALL ON public.conversation_transcript_requests TO service_role;
-- Only the current conversation and its public messages are exposed to its visitor.
CREATE FUNCTION public.widget_conversation_context(p_workspace_id uuid,p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.visitor_sessions; c public.conversations;
BEGIN
 s:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO c FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=s.id
 ORDER BY created_at DESC,id DESC LIMIT 1;
 RETURN jsonb_build_object('conversationId',c.id,'conversationStatus',c.status,
 'rating',(SELECT jsonb_build_object('score',score,'comment',comment) FROM public.conversation_ratings WHERE conversation_id=c.id AND workspace_id=p_workspace_id),
 'messageAgents',COALESCE((SELECT jsonb_object_agg(m.id, jsonb_build_object('name',COALESCE(ap.display_name,'Agent'),'avatarPath',ap.avatar_path))
 FROM public.messages m LEFT JOIN public.agent_profiles ap ON ap.member_id=m.agent_member_id AND ap.workspace_id=m.workspace_id
 WHERE m.conversation_id=c.id AND m.workspace_id=p_workspace_id AND m.sender_type='agent' AND NOT m.is_internal),'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.widget_conversation_context(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_conversation_context(uuid,text) TO service_role;
CREATE FUNCTION public.widget_rate_conversation(p_workspace_id uuid,p_session_token text,p_conversation_id uuid,p_score integer,p_comment text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.visitor_sessions; c public.conversations; v_rating public.conversation_ratings;
BEGIN
 s:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND visitor_session_id=s.id FOR UPDATE;
 IF c.id IS NULL OR c.status NOT IN ('resolved','closed') THEN RAISE EXCEPTION 'Conversation is not complete'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_chat_settings WHERE workspace_id=p_workspace_id AND config->>'ratingEnabled'='true') THEN RAISE EXCEPTION 'Ratings are disabled'; END IF;
 INSERT INTO public.conversation_ratings(conversation_id,workspace_id,score,comment) VALUES(c.id,p_workspace_id,p_score,trim(p_comment)) ON CONFLICT(conversation_id) DO NOTHING;
 SELECT * INTO v_rating FROM public.conversation_ratings WHERE conversation_id=c.id;
 RETURN jsonb_build_object('score',v_rating.score,'comment',v_rating.comment);
END; $$;
REVOKE ALL ON FUNCTION public.widget_rate_conversation(uuid,text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_rate_conversation(uuid,text,uuid,integer,text) TO service_role;
-- Serializes rate limits and gives the provider a durable, scoped idempotency key.
CREATE FUNCTION public.claim_conversation_transcript(p_workspace_id uuid,p_conversation_id uuid,p_request_id uuid,p_recipient text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conversations; previous public.conversation_transcript_requests;
BEGIN
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 SELECT * INTO previous FROM public.conversation_transcript_requests WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.workspace_id<>p_workspace_id OR previous.conversation_id<>p_conversation_id OR previous.recipient<>p_recipient THEN RAISE EXCEPTION 'Request mismatch'; END IF;
  IF previous.status='sent' THEN RETURN 'sent'; END IF;
  IF previous.status='sending' AND previous.updated_at>now()-interval '1 minute' THEN RETURN 'busy'; END IF;
  IF previous.created_at<now()-interval '23 hours' THEN RAISE EXCEPTION 'Request expired'; END IF;
  UPDATE public.conversation_transcript_requests SET status='sending',updated_at=now() WHERE id=p_request_id;
  RETURN 'claimed';
 END IF;
 IF (SELECT count(*) FROM public.conversation_transcript_requests WHERE conversation_id=c.id AND created_at>now()-interval '1 hour')>=3 THEN RETURN 'limited'; END IF;
 INSERT INTO public.conversation_transcript_requests(id,workspace_id,conversation_id,recipient) VALUES(p_request_id,p_workspace_id,c.id,p_recipient);
 RETURN 'claimed';
END; $$;
REVOKE ALL ON FUNCTION public.claim_conversation_transcript(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_transcript(uuid,uuid,uuid,text) TO service_role;
