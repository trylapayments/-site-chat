-- Mobile visitor push preferences and private durable queue.
-- Approved and applied individually to production on 2026-10-07.

ALTER TABLE public.mobile_push_devices
 ADD COLUMN push_new_chat boolean NOT NULL DEFAULT true,
 ADD COLUMN push_new_visitor boolean NOT NULL DEFAULT false,
 ADD COLUMN push_messages boolean NOT NULL DEFAULT true;
DROP FUNCTION public.register_mobile_push(uuid,uuid,uuid,uuid,text,text);
CREATE FUNCTION public.register_mobile_push(p_user_id uuid, p_member_id uuid,
  p_workspace_id uuid, p_installation_id uuid, p_token text, p_sound_mode text DEFAULT 'mill',
  p_push_new_chat boolean DEFAULT NULL, p_push_new_visitor boolean DEFAULT NULL, p_push_messages boolean DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_installation_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_token, 1));
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members
    WHERE id=p_member_id AND workspace_id=p_workspace_id AND user_id=p_user_id
      AND status='active' AND role::text <> 'viewer') THEN
    RAISE EXCEPTION 'Workspace access denied' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.mobile_push_devices
    WHERE ((installation_id=p_installation_id OR token=p_token) AND user_id<>p_user_id)
       OR (token=p_token AND installation_id<>p_installation_id);
  INSERT INTO public.mobile_push_devices(user_id,member_id,workspace_id,installation_id,token,sound_mode,push_new_chat,push_new_visitor,push_messages)
    VALUES(p_user_id,p_member_id,p_workspace_id,p_installation_id,p_token,p_sound_mode,
      COALESCE(p_push_new_chat,(SELECT push_new_chat FROM public.mobile_push_devices WHERE installation_id=p_installation_id AND workspace_id=p_workspace_id),true),
      COALESCE(p_push_new_visitor,(SELECT push_new_visitor FROM public.mobile_push_devices WHERE installation_id=p_installation_id AND workspace_id=p_workspace_id),false),
      COALESCE(p_push_messages,(SELECT push_messages FROM public.mobile_push_devices WHERE installation_id=p_installation_id AND workspace_id=p_workspace_id),true))
    ON CONFLICT(installation_id,workspace_id) DO UPDATE SET
      user_id=EXCLUDED.user_id,member_id=EXCLUDED.member_id,token=EXCLUDED.token,sound_mode=EXCLUDED.sound_mode,push_new_chat=EXCLUDED.push_new_chat,push_new_visitor=EXCLUDED.push_new_visitor,push_messages=EXCLUDED.push_messages,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.register_mobile_push(uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_mobile_push(uuid,uuid,uuid,uuid,text,text,boolean,boolean,boolean) TO service_role;

CREATE TABLE public.mobile_push_visitor_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 visitor_session_id uuid NOT NULL REFERENCES public.visitor_sessions(id) ON DELETE CASCADE,
 device_id uuid NOT NULL REFERENCES public.mobile_push_devices(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','skipped','failed')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 claimed_at timestamptz,
 ticket_id text,
 receipt_checked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(visitor_session_id,device_id)
);
ALTER TABLE public.mobile_push_visitor_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_push_visitor_outbox FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mobile_push_visitor_outbox TO service_role;
CREATE INDEX mobile_visitor_push_pending ON public.mobile_push_visitor_outbox(next_attempt_at) WHERE status IN ('pending','sending');
CREATE FUNCTION app_private.enqueue_mobile_visitor_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.mobile_push_visitor_outbox(visitor_session_id,device_id)
 SELECT NEW.id,d.id FROM public.mobile_push_devices d
 JOIN public.workspace_members m ON m.id=d.member_id AND m.workspace_id=d.workspace_id AND m.user_id=d.user_id
 WHERE d.workspace_id=NEW.workspace_id AND d.push_new_visitor AND m.status='active' AND m.role::text<>'viewer'
 ON CONFLICT DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING 'Mobile visitor push enqueue failed (%)', SQLSTATE;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.enqueue_mobile_visitor_push() FROM PUBLIC;
CREATE TRIGGER enqueue_mobile_visitor_push AFTER INSERT ON public.visitor_sessions FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_mobile_visitor_push();
CREATE FUNCTION public.claim_mobile_visitor_push(p_limit integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 UPDATE public.mobile_push_visitor_outbox SET status='failed',claimed_at=NULL WHERE status IN ('pending','sending') AND attempts>=8 AND (claimed_at IS NULL OR claimed_at<now()-interval '2 minutes');
 WITH candidates AS (
 SELECT id FROM public.mobile_push_visitor_outbox WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND claimed_at<now()-interval '2 minutes')
 ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10)
 ), claimed AS (
 UPDATE public.mobile_push_visitor_outbox o SET status='sending',claimed_at=now(),attempts=attempts+1 FROM candidates c WHERE o.id=c.id RETURNING o.*
 ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO result FROM claimed;
 RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_mobile_visitor_push(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_visitor_push(integer) TO service_role;

NOTIFY pgrst, 'reload schema';

