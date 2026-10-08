CREATE FUNCTION public.widget_end_conversation(p_workspace_id uuid,p_session_token text,p_conversation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE session public.visitor_sessions; conversation public.conversations;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 session:=app_private.resolve_visitor_session(p_workspace_id,p_session_token);
 PERFORM 1 FROM public.visitor_sessions WHERE id=session.id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND status='active' AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
 SELECT * INTO conversation FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id AND visitor_session_id=session.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Conversation unavailable'; END IF;
 UPDATE public.conversations SET status='closed',resolved_at=COALESCE(resolved_at,now()),updated_at=now() WHERE id=conversation.id AND workspace_id=p_workspace_id AND status<>'closed';
 RETURN jsonb_build_object('ended',true);
END $$;
REVOKE ALL ON FUNCTION public.widget_end_conversation(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.widget_end_conversation(uuid,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
