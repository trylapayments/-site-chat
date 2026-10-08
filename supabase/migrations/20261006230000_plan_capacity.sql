-- Capacity is checked in the database, including service-role mutations.
CREATE OR REPLACE FUNCTION app_private.workspace_capacity(w uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.workspace_admin_controls; s jsonb; p text := 'business'; seats int; sites int; active_override boolean;
BEGIN
 SELECT * INTO c FROM public.workspace_admin_controls WHERE workspace_id=w;
 active_override := c.override_expires_at IS NULL OR c.override_expires_at>now();
 SELECT payload INTO s FROM public.billing_resource_snapshots WHERE workspace_id=w AND kind='subscription' AND resource_id='mill_'||w::text ORDER BY updated_at DESC LIMIT 1;
 IF c.access_mode='pilot' AND active_override THEN p:='business';
 ELSIF c.plan_id IN ('starter','essential','growth','business') AND active_override THEN p:=c.plan_id;
 ELSIF c.access_mode='trial' AND c.trial_ends_at>now() THEN p:='business';
 ELSIF s IS NOT NULL THEN p:=split_part(s->'subscription_items'->0->>'item_price_id','-',2);
 END IF;
 seats:=CASE p WHEN 'starter' THEN 3 WHEN 'essential' THEN 5 WHEN 'growth' THEN 10 ELSE 20 END;
 sites:=CASE p WHEN 'starter' THEN 1 WHEN 'essential' THEN 2 WHEN 'growth' THEN 3 ELSE 10 END;
 IF active_override THEN
  IF c.limits->>'operator_seats' ~ '^[0-9]{1,6}$' THEN seats:=(c.limits->>'operator_seats')::int; END IF;
  IF c.limits->>'websites' ~ '^[0-9]{1,6}$' THEN sites:=(c.limits->>'websites')::int; END IF;
 END IF;
 RETURN jsonb_build_object('operators',seats,'sites',sites,'plan',p);
END $$;
REVOKE ALL ON FUNCTION app_private.workspace_capacity(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.workspace_plan_capacity(p_workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF auth.role()<>'service_role' AND app_private.user_workspace_role(p_workspace_id) IS NULL THEN RAISE EXCEPTION 'Forbidden'; END IF;
 RETURN app_private.workspace_capacity(p_workspace_id);
END $$;
REVOKE ALL ON FUNCTION public.workspace_plan_capacity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_plan_capacity(uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION app_private.check_plan_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE capacity jsonb; used int; seat_email text;
BEGIN
 IF TG_TABLE_NAME='allowed_domains' THEN
  IF NOT NEW.verified THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.verified AND OLD.domain=NEW.domain AND OLD.workspace_id=NEW.workspace_id THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='workspace_members' THEN
  IF NEW.status<>'active' OR NEW.role='viewer' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status='active' AND OLD.role<>'viewer' AND OLD.workspace_id=NEW.workspace_id THEN RETURN NEW; END IF;
 ELSE
  IF NEW.role='viewer' OR NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.expires_at<=now() THEN RETURN NEW; END IF;
 END IF;
 -- Serialize capacity changes for the tenant; no deleting data on downgrade.
 PERFORM 1 FROM public.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 capacity:=app_private.workspace_capacity(NEW.workspace_id);
 IF TG_TABLE_NAME='allowed_domains' THEN
  SELECT count(*) INTO used FROM (SELECT DISTINCT regexp_replace(lower(domain),'^www\.','') FROM public.allowed_domains WHERE workspace_id=NEW.workspace_id AND verified AND id<>NEW.id UNION SELECT regexp_replace(lower(NEW.domain),'^www\.','')) hosts;
  IF used>(capacity->>'sites')::int THEN RAISE EXCEPTION 'PLAN_SITE_LIMIT: Your website limit is reached. Disable another website or upgrade your plan.'; END IF;
 ELSE
  IF TG_TABLE_NAME='workspace_members' THEN SELECT lower(u.email) INTO seat_email FROM auth.users u WHERE u.id=NEW.user_id; ELSE seat_email:=lower(trim(NEW.email)); END IF;
  SELECT count(*) INTO used FROM public.workspace_members m WHERE m.workspace_id=NEW.workspace_id AND m.status='active' AND m.role<>'viewer' AND (TG_TABLE_NAME<>'workspace_members' OR m.id<>NEW.id);
  used:=used+(SELECT count(*) FROM public.workspace_invitations i WHERE i.workspace_id=NEW.workspace_id AND i.role<>'viewer' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND i.email_normalized IS DISTINCT FROM seat_email);
  IF used+1>(capacity->>'operators')::int THEN RAISE EXCEPTION 'PLAN_OPERATOR_LIMIT: Your operator limit is reached. Deactivate an operator, revoke a pending invitation, or upgrade your plan.'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.check_plan_capacity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER plan_capacity_members BEFORE INSERT OR UPDATE ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.check_plan_capacity();
CREATE TRIGGER plan_capacity_invitations BEFORE INSERT OR UPDATE ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.check_plan_capacity();
CREATE TRIGGER plan_capacity_sites BEFORE INSERT OR UPDATE ON public.allowed_domains FOR EACH ROW EXECUTE FUNCTION app_private.check_plan_capacity();
