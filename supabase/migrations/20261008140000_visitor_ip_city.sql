-- Approved IP-derived visitor city; trusted server writes only.
ALTER TABLE public.visitor_sessions ADD COLUMN ip_city text CHECK (ip_city IS NULL OR length(ip_city) <= 128);
CREATE FUNCTION public.record_widget_ip_location(p_workspace_id uuid, p_session_token text, p_country text, p_city text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.visitor_sessions;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  IF p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid country'; END IF;
  IF p_city IS NOT NULL AND (length(p_city)>128 OR p_city ~ '[[:cntrl:]]') THEN RAISE EXCEPTION 'Invalid city'; END IF;
  UPDATE public.visitor_sessions SET ip_country_code=p_country, ip_city=p_city
  WHERE id=v_session.id AND workspace_id=p_workspace_id
    AND (ip_country_code IS DISTINCT FROM p_country OR ip_city IS DISTINCT FROM p_city);
END; $$;
REVOKE ALL ON FUNCTION public.record_widget_ip_location(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_widget_ip_location(uuid,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.list_active_visitors(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),'country',vs.ip_country_code,'city',vs.ip_city,
      'url',vs.current_url,'title',vs.current_title,'browser',vs.browser_family,'device',vs.device_type,
      'startedAt',vs.current_visit_started_at,'lastSeenAt',vs.last_seen_at,'conversationId',c.id,
      'status',CASE WHEN c.id IS NULL THEN 'browsing' WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='visitor') OR vs.pre_chat_submitted_at IS NOT NULL THEN CASE WHEN EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id=c.id AND m.sender_type='agent') THEN 'chatting' ELSE 'waiting' END ELSE 'invited' END) AS data
    FROM public.visitor_sessions vs LEFT JOIN public.contacts ct ON ct.id=vs.contact_id AND ct.workspace_id=p_workspace_id
    LEFT JOIN LATERAL (SELECT * FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=vs.id AND status IN ('open','pending') ORDER BY created_at DESC LIMIT 1) c ON true
    WHERE vs.workspace_id=p_workspace_id AND vs.last_seen_at>now()-interval '90 seconds' AND vs.expires_at>now()
    ORDER BY vs.last_seen_at DESC LIMIT 200
  ) x),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.list_active_visitors(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_visitors(uuid) TO authenticated;



CREATE OR REPLACE FUNCTION public.list_all_active_visitors(p_workspace_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('workspace',jsonb_build_object('id',w.id,'name',w.name,'slug',w.slug),'id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),'country',vs.ip_country_code,'city',vs.ip_city,
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
