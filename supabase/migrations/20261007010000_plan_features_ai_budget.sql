-- Capacity is checked in the database, including service-role mutations.
CREATE OR REPLACE FUNCTION app_private.workspace_capacity(w uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.workspace_admin_controls; s jsonb; p text := 'business'; seats int; sites int; active_override boolean;
BEGIN
 SELECT * INTO c FROM public.workspace_admin_controls WHERE workspace_id=w;
 IF FOUND THEN p:='starter'; END IF;
 active_override := c.override_expires_at IS NULL OR c.override_expires_at>now();
 SELECT payload INTO s FROM public.billing_resource_snapshots WHERE workspace_id=w AND kind='subscription' AND resource_id='mill_'||w::text ORDER BY updated_at DESC LIMIT 1;
 IF c.access_mode='pilot' AND active_override THEN p:='business';
 ELSIF c.plan_id IN ('starter','essential','growth','business') AND active_override THEN p:=c.plan_id;
 ELSIF c.access_mode='trial' AND c.trial_ends_at>now() THEN p:='business';
 ELSIF s IS NOT NULL THEN p:=split_part(s->'subscription_items'->0->>'item_price_id','-',2);
 END IF;
 IF p NOT IN ('starter','essential','growth','business') OR p IS NULL THEN p:='starter'; END IF;
 seats:=CASE p WHEN 'starter' THEN 3 WHEN 'essential' THEN 5 WHEN 'growth' THEN 10 ELSE 20 END;
 sites:=CASE p WHEN 'starter' THEN 1 WHEN 'essential' THEN 2 WHEN 'growth' THEN 3 ELSE 10 END;
 IF active_override THEN
  IF c.limits->>'operator_seats' ~ '^[0-9]{1,6}$' THEN seats:=(c.limits->>'operator_seats')::int; END IF;
  IF c.limits->>'websites' ~ '^[0-9]{1,6}$' THEN sites:=(c.limits->>'websites')::int; END IF;
 END IF;
 RETURN jsonb_build_object('operators',seats,'sites',sites,'plan',p);
END $$;

-- Plan restrictions and conversation metering are enforced below the UI.
CREATE FUNCTION app_private.plan_hide_branding(w uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.workspace_admin_controls; allowed boolean;
BEGIN
 allowed := app_private.workspace_capacity(w)->>'plan' IN ('essential','growth','business');
 SELECT * INTO c FROM public.workspace_admin_controls WHERE workspace_id=w;
 IF (c.override_expires_at IS NULL OR c.override_expires_at>now()) AND jsonb_typeof(c.features->'hide_powered_by')='boolean' THEN
 allowed := (c.features->>'hide_powered_by')::boolean;
 END IF;
 RETURN allowed;
END $$;
REVOKE ALL ON FUNCTION app_private.plan_hide_branding(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.enforce_plan_branding() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT app_private.plan_hide_branding(NEW.workspace_id) THEN
 NEW.draft_json:=jsonb_set(NEW.draft_json,'{showPoweredBy}','true');
 NEW.published_json:=jsonb_set(NEW.published_json,'{showPoweredBy}','true');
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.enforce_plan_branding() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER plan_branding BEFORE INSERT OR UPDATE ON public.widget_configs FOR EACH ROW EXECUTE FUNCTION app_private.enforce_plan_branding();
CREATE TRIGGER plan_site_branding BEFORE INSERT OR UPDATE ON public.widget_site_configs FOR EACH ROW EXECUTE FUNCTION app_private.enforce_plan_branding();

CREATE TABLE public.ai_conversation_credits (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 period_start timestamptz NOT NULL,
 conversation_id uuid NOT NULL,
 request_id uuid NOT NULL,
 status text NOT NULL CHECK(status IN ('reserved','success')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,period_start,conversation_id),
 FOREIGN KEY(conversation_id,workspace_id) REFERENCES public.conversations(id,workspace_id) ON DELETE CASCADE
);
ALTER TABLE public.ai_conversation_credits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_conversation_credits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.ai_conversation_credits TO service_role;
CREATE FUNCTION app_private.ai_credit_period(w uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor timestamptz; start_at timestamptz; end_at timestamptz; s jsonb; months int; p text; budget int; c public.workspace_admin_controls;
BEGIN
 SELECT created_at INTO anchor FROM public.workspaces WHERE id=w;
 IF anchor IS NULL THEN RAISE EXCEPTION 'Workspace not found'; END IF;
 SELECT payload INTO s FROM public.billing_resource_snapshots WHERE workspace_id=w AND kind='subscription' AND resource_id='mill_'||w::text ORDER BY updated_at DESC LIMIT 1;
 IF s->>'current_term_start' ~ '^[0-9]{1,12}$' THEN anchor:=to_timestamp((s->>'current_term_start')::bigint); END IF;
 -- Add months to the ORIGINAL anniversary: Jan 31 -> Feb 28 -> Mar 31.
 months := greatest(0,(extract(year FROM now() AT TIME ZONE 'UTC')::int-extract(year FROM anchor AT TIME ZONE 'UTC')::int)*12+extract(month FROM now() AT TIME ZONE 'UTC')::int-extract(month FROM anchor AT TIME ZONE 'UTC')::int);
 start_at := (anchor AT TIME ZONE 'UTC' + make_interval(months=>months)) AT TIME ZONE 'UTC';
 IF start_at>now() AND months>0 THEN months:=months-1; start_at:=(anchor AT TIME ZONE 'UTC'+make_interval(months=>months)) AT TIME ZONE 'UTC'; END IF;
 end_at := (anchor AT TIME ZONE 'UTC'+make_interval(months=>months+1)) AT TIME ZONE 'UTC';
 p:=app_private.workspace_capacity(w)->>'plan';
 budget:=CASE p WHEN 'starter' THEN 0 WHEN 'essential' THEN 100 WHEN 'growth' THEN 500 WHEN 'business' THEN 1000 ELSE 0 END;
 SELECT * INTO c FROM public.workspace_admin_controls WHERE workspace_id=w;
 IF (c.override_expires_at IS NULL OR c.override_expires_at>now()) AND c.limits->>'monthly_ai_requests' ~ '^[0-9]{1,9}$' THEN budget:=(c.limits->>'monthly_ai_requests')::int; END IF;
 RETURN jsonb_build_object('start',start_at,'end',end_at,'limit',budget);
END $$;
REVOKE ALL ON FUNCTION app_private.ai_credit_period(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.workspace_ai_credit_balance(p_workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE period jsonb; used int;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' AND app_private.user_workspace_role(p_workspace_id) IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 period:=app_private.ai_credit_period(p_workspace_id);
 SELECT count(*) INTO used FROM public.ai_conversation_credits WHERE workspace_id=p_workspace_id AND period_start=(period->>'start')::timestamptz AND status='success';
 RETURN period||jsonb_build_object('used',used,'remaining',greatest(0,(period->>'limit')::int-used));
END $$;
REVOKE ALL ON FUNCTION public.workspace_ai_credit_balance(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_ai_credit_balance(uuid) TO authenticated,service_role;
CREATE FUNCTION public.reserve_ai_conversation_credit(p_workspace_id uuid,p_conversation_id uuid,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE period jsonb; credit public.ai_conversation_credits; used int;
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'Conversation not found'; END IF;
 period:=app_private.ai_credit_period(p_workspace_id);
 SELECT * INTO credit FROM public.ai_conversation_credits WHERE workspace_id=p_workspace_id AND period_start=(period->>'start')::timestamptz AND conversation_id=p_conversation_id;
 IF credit.status='success' THEN RETURN period||jsonb_build_object('alreadyCounted',true); END IF;
 IF credit.status='reserved' AND credit.updated_at>now()-interval '2 minutes' THEN RAISE EXCEPTION 'AI_BUSY: An AI reply is already being prepared for this conversation'; END IF;
 SELECT count(*) INTO used FROM public.ai_conversation_credits WHERE workspace_id=p_workspace_id AND period_start=(period->>'start')::timestamptz AND (status='success' OR updated_at>now()-interval '2 minutes');
 IF used>=(period->>'limit')::int THEN RAISE EXCEPTION 'AI_QUOTA_EXHAUSTED: Your included AI conversations are used up. Live chat remains available.'; END IF;
 INSERT INTO public.ai_conversation_credits(workspace_id,period_start,conversation_id,request_id,status) VALUES(p_workspace_id,(period->>'start')::timestamptz,p_conversation_id,p_request_id,'reserved') ON CONFLICT(workspace_id,period_start,conversation_id) DO UPDATE SET request_id=excluded.request_id,status='reserved',updated_at=now();
 RETURN period||jsonb_build_object('alreadyCounted',false);
END $$;
REVOKE ALL ON FUNCTION public.reserve_ai_conversation_credit(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_conversation_credit(uuid,uuid,uuid) TO service_role;
CREATE FUNCTION public.finish_ai_conversation_credit(p_workspace_id uuid,p_request_id uuid,p_success boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM public.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF p_success THEN UPDATE public.ai_conversation_credits SET status='success',updated_at=now() WHERE workspace_id=p_workspace_id AND request_id=p_request_id AND status='reserved';
 ELSE DELETE FROM public.ai_conversation_credits WHERE workspace_id=p_workspace_id AND request_id=p_request_id AND status='reserved'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.finish_ai_conversation_credit(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ai_conversation_credit(uuid,uuid,boolean) TO service_role;
