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
    JOIN public.workspace_members m ON m.id=d.member_id AND m.workspace_id=d.workspace_id AND m.user_id=d.user_id AND m.status='active'
    WHERE d.workspace_id=NEW.workspace_id AND d.member_id=NEW.recipient_id
    ON CONFLICT DO NOTHING;
  END IF;
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
