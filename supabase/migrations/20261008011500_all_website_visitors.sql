CREATE OR REPLACE FUNCTION public.list_all_active_visitors(p_workspace_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug),'id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),'country',vs.ip_country_code,
      'url',vs.current_url,'title',vs.current_title,'browser',vs.browser_family,'device',vs.device_type,
      'startedAt',vs.current_visit_started_at,'lastSeenAt',vs.last_seen_at,'conversationId',c.id,
      'status',CASE WHEN c.id IS NULL THEN 'browsing' WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='visitor') OR vs.pre_chat_submitted_at IS NOT NULL THEN CASE WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='agent') THEN 'chatting' ELSE 'waiting' END ELSE 'invited' END) AS data
    FROM public.visitor_sessions vs LEFT JOIN public.contacts ct ON ct.id=vs.contact_id AND ct.workspace_id=vs.workspace_id
    LEFT JOIN LATERAL (SELECT * FROM public.conversations WHERE workspace_id=vs.workspace_id AND visitor_session_id=vs.id AND status IN ('open','pending') ORDER BY created_at DESC LIMIT 1) c ON true
    JOIN public.workspaces w ON w.id=vs.workspace_id AND w.deleted_at IS NULL AND w.status='active'
    JOIN public.workspace_members wm ON wm.workspace_id=vs.workspace_id AND wm.user_id=auth.uid() AND wm.status='active'
    WHERE vs.workspace_id=ANY(p_workspace_ids) AND vs.last_seen_at>now()-interval '90 seconds' AND vs.expires_at>now()
    ORDER BY vs.last_seen_at DESC LIMIT 200
  ) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.list_all_active_visitors(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_all_active_visitors(uuid[]) TO authenticated;


NOTIFY pgrst, 'reload schema';
