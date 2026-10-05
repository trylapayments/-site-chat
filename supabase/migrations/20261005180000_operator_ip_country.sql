-- IP-derived location is distinct from the contact's editable country and
-- browser locale. Only the server may write the trusted edge-provided value.
ALTER TABLE public.visitor_sessions ADD COLUMN ip_country_code text
  CHECK (ip_country_code IS NULL OR ip_country_code ~ '^[A-Z]{2}$');

CREATE FUNCTION public.record_widget_ip_country(p_workspace_id uuid, p_session_token text, p_country text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.visitor_sessions;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  IF p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid country'; END IF;
  UPDATE public.visitor_sessions SET ip_country_code = p_country
    WHERE id = v_session.id AND workspace_id = p_workspace_id
      AND ip_country_code IS DISTINCT FROM p_country;
END; $$;
REVOKE ALL ON FUNCTION public.record_widget_ip_country(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_widget_ip_country(uuid, text, text) TO service_role;

CREATE FUNCTION public.conversation_ip_countries(p_workspace_id uuid, p_conversation_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  IF cardinality(p_conversation_ids) > 100 THEN RAISE EXCEPTION 'Too many conversations'; END IF;
  RETURN COALESCE((SELECT jsonb_object_agg(c.id::text, vs.ip_country_code)
    FROM public.conversations c JOIN public.visitor_sessions vs ON vs.id=c.visitor_session_id AND vs.workspace_id=c.workspace_id
    WHERE c.workspace_id=p_workspace_id AND c.id=ANY(p_conversation_ids)), '{}'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.conversation_ip_countries(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_ip_countries(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_active_visitors(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),'country',vs.ip_country_code,
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

