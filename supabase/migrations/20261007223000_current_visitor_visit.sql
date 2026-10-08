-- A visit is a continuous online period, distinct from the 30-day visitor identity.
ALTER TABLE public.visitor_sessions ADD COLUMN current_visit_started_at timestamptz;
-- Previous visit boundaries were not stored. Existing rows start from their last activity.
UPDATE public.visitor_sessions SET current_visit_started_at = last_seen_at;
ALTER TABLE public.visitor_sessions ALTER COLUMN current_visit_started_at SET DEFAULT now(), ALTER COLUMN current_visit_started_at SET NOT NULL;
CREATE FUNCTION app_private.track_current_visitor_visit() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.current_visit_started_at := NEW.last_seen_at;
  ELSIF NEW.last_seen_at > OLD.last_seen_at + interval '90 seconds' THEN
    NEW.current_visit_started_at := NEW.last_seen_at;
  ELSE
    NEW.current_visit_started_at := OLD.current_visit_started_at;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.track_current_visitor_visit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER track_current_visitor_visit BEFORE INSERT OR UPDATE OF last_seen_at
ON public.visitor_sessions FOR EACH ROW EXECUTE FUNCTION app_private.track_current_visitor_visit();

CREATE OR REPLACE FUNCTION public.list_active_visitors(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  RETURN COALESCE((SELECT jsonb_agg(x.data ORDER BY x.last_seen_at DESC) FROM (
    SELECT vs.last_seen_at, jsonb_build_object('id',vs.id,'name',ct.name,'email',ct.email,'ip',host(vs.ip_address),'country',vs.ip_country_code,
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


NOTIFY pgrst, 'reload schema';
