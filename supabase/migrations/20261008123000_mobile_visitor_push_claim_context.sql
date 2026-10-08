-- Supply minimal visitor context through the existing service-only claim RPC.
-- Do not grant direct SELECT on visitor_sessions or add a client-callable API.
CREATE OR REPLACE FUNCTION public.claim_mobile_visitor_push(p_limit integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 UPDATE public.mobile_push_visitor_outbox SET status='failed',claimed_at=NULL WHERE status IN ('pending','sending') AND attempts>=8 AND (claimed_at IS NULL OR claimed_at<now()-interval '2 minutes');
 WITH candidates AS (
 SELECT id FROM public.mobile_push_visitor_outbox WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND claimed_at<now()-interval '2 minutes')
 ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10)
 ), claimed AS (
 UPDATE public.mobile_push_visitor_outbox o SET status='sending',claimed_at=now(),attempts=attempts+1 FROM candidates c WHERE o.id=c.id RETURNING o.*
 ) SELECT COALESCE(jsonb_agg(to_jsonb(c) || jsonb_build_object('visitor', (
   SELECT jsonb_build_object('id',s.id,'workspace_id',s.workspace_id,'created_at',s.created_at,'current_visit_started_at',s.current_visit_started_at,'last_seen_at',s.last_seen_at,'expires_at',s.expires_at)
   FROM public.visitor_sessions s
   JOIN public.mobile_push_devices d ON d.id=c.device_id AND d.workspace_id=s.workspace_id
   JOIN public.workspace_members m ON m.id=d.member_id AND m.workspace_id=d.workspace_id AND m.user_id=d.user_id
   WHERE s.id=c.visitor_session_id AND m.status='active' AND m.role::text<>'viewer'
 ))),'[]'::jsonb) INTO result FROM claimed c;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_mobile_visitor_push(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_visitor_push(integer) TO service_role;
NOTIFY pgrst, 'reload schema';
