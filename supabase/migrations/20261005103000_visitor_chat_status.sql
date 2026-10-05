-- A submitted form is a chat request even before the visitor types a message.
CREATE OR REPLACE FUNCTION public.list_active_visitors(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),
      'url',vs.current_url,'title',vs.current_title,'browser',vs.browser_family,'device',vs.device_type,
      'startedAt',vs.created_at,'lastSeenAt',vs.last_seen_at,'conversationId',c.id,
      'status',CASE WHEN c.id IS NULL THEN 'browsing' WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='visitor') OR vs.pre_chat_submitted_at IS NOT NULL THEN CASE WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='agent') THEN 'chatting' ELSE 'waiting' END ELSE 'invited' END) AS data
    FROM public.visitor_sessions vs LEFT JOIN public.contacts ct ON ct.id=vs.contact_id AND ct.workspace_id=p_workspace_id
    LEFT JOIN LATERAL (SELECT * FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=vs.id AND status IN ('open','pending') ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE vs.workspace_id=p_workspace_id AND vs.last_seen_at>now()-interval '90 seconds' AND vs.expires_at>now()
    ORDER BY vs.last_seen_at DESC LIMIT 200
  ) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.list_active_visitors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_visitors(uuid) TO authenticated;

