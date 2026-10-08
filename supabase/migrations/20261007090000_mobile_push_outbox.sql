-- REVIEW ONLY: do not apply to production without approval.
-- Reuses existing per-member notification routing and quiet-hours rules.
CREATE TABLE public.mobile_push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  token text NOT NULL CHECK (token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sound_mode text NOT NULL DEFAULT 'mill' CHECK (sound_mode IN ('mill','voice','silent','system')),
  UNIQUE (installation_id, workspace_id),
  FOREIGN KEY (member_id, workspace_id) REFERENCES public.workspace_members(id, workspace_id) ON DELETE CASCADE
);
CREATE TABLE public.mobile_push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.mobile_push_devices(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','skipped','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  ticket_id text,
  receipt_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notification_id,device_id)
);
ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_push_devices, public.mobile_push_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mobile_push_devices, public.mobile_push_outbox TO service_role;
CREATE INDEX mobile_push_pending ON public.mobile_push_outbox(next_attempt_at) WHERE status IN ('pending','sending');

CREATE FUNCTION app_private.enqueue_mobile_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL AND NEW.type::text IN ('conversation_new','visitor_message','conversation_assigned','conversation_transferred','mention') THEN
    INSERT INTO public.mobile_push_outbox(notification_id,device_id)
    SELECT NEW.id,d.id FROM public.mobile_push_devices d
    JOIN public.workspace_members m ON m.id=d.member_id AND m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.status='active' AND m.role::text<>'viewer'
    WHERE d.workspace_id=NEW.workspace_id AND d.member_id=NEW.recipient_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- An optional delivery channel must never roll back a visitor message/notification.
  RAISE WARNING 'Mobile push enqueue failed (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.enqueue_mobile_push() FROM PUBLIC;
CREATE TRIGGER enqueue_mobile_push AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_mobile_push();

CREATE FUNCTION public.claim_mobile_push(p_limit integer DEFAULT 10) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  UPDATE public.mobile_push_outbox SET status='failed',claimed_at=NULL
    WHERE status IN ('pending','sending') AND attempts>=8
      AND (claimed_at IS NULL OR claimed_at<now()-interval '2 minutes');
  WITH candidates AS (
    SELECT id FROM public.mobile_push_outbox
    WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND claimed_at<now()-interval '2 minutes')
    ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(p_limit,1),10)
  ), claimed AS (
    UPDATE public.mobile_push_outbox o SET status='sending',claimed_at=now(),attempts=attempts+1
    FROM candidates c WHERE o.id=c.id RETURNING o.*
  ) SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_result FROM claimed;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_mobile_push(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_mobile_push(integer) TO service_role;

-- Registration is atomic across workspaces and account switches on the same installation/token.
CREATE FUNCTION public.register_mobile_push(p_user_id uuid, p_member_id uuid,
  p_workspace_id uuid, p_installation_id uuid, p_token text, p_sound_mode text DEFAULT 'mill') RETURNS void
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
  INSERT INTO public.mobile_push_devices(user_id,member_id,workspace_id,installation_id,token,sound_mode)
    VALUES(p_user_id,p_member_id,p_workspace_id,p_installation_id,p_token,p_sound_mode)
    ON CONFLICT(installation_id,workspace_id) DO UPDATE SET
      user_id=EXCLUDED.user_id,member_id=EXCLUDED.member_id,token=EXCLUDED.token,sound_mode=EXCLUDED.sound_mode,updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.register_mobile_push(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_mobile_push(uuid,uuid,uuid,uuid,text,text) TO service_role;
