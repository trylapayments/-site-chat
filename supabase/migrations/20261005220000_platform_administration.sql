-- Platform permissions are deliberately independent of tenant membership.
CREATE TABLE public.platform_administrators (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','support','finance','viewer')),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.workspace_admin_controls (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 access_mode text NOT NULL DEFAULT 'standard' CHECK(access_mode IN ('standard','pilot','trial')),
 trial_ends_at timestamptz,
 override_expires_at timestamptz,
 features jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(features)='object'),
 limits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(limits)='object'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 0,
 CHECK(access_mode<>'trial' OR trial_ends_at IS NOT NULL)
);
CREATE TABLE public.platform_audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL,
 workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
 action text NOT NULL, reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 2000),
 before_json jsonb, after_json jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_audit_workspace_time ON public.platform_audit_log(workspace_id,created_at DESC);
CREATE TABLE public.platform_customer_notes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 author_id uuid NOT NULL, body text NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['platform_administrators','workspace_admin_controls','platform_audit_log','platform_customer_notes']) LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
CREATE FUNCTION public.platform_admin_apply(p_actor_id uuid,p_workspace_id uuid,p_action text,p_payload jsonb,p_reason text,p_expected_version integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_role text; previous jsonb; next_state jsonb; w public.workspaces; ctl public.workspace_admin_controls; m public.workspace_members; k text; v jsonb; new_role public.app_member_role; new_status public.app_member_status;
BEGIN
 SELECT role INTO actor_role FROM public.platform_administrators WHERE user_id=p_actor_id AND enabled;
 IF actor_role IS NULL OR actor_role='viewer' OR actor_role='finance' THEN RAISE EXCEPTION 'Platform action denied' USING ERRCODE='42501'; END IF;
 IF actor_role<>'owner' AND p_action NOT IN ('note','trial') THEN RAISE EXCEPTION 'Platform action denied' USING ERRCODE='42501'; END IF;
 IF length(trim(p_reason)) NOT BETWEEN 3 AND 2000 OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR pg_column_size(p_payload)>16384 THEN RAISE EXCEPTION 'Invalid administration request'; END IF;
 SELECT * INTO w FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Workspace unavailable'; END IF;
 INSERT INTO public.workspace_admin_controls(workspace_id) VALUES(p_workspace_id) ON CONFLICT DO NOTHING;
 SELECT * INTO ctl FROM public.workspace_admin_controls WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF ctl.version<>p_expected_version THEN RAISE EXCEPTION 'Workspace changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 previous=jsonb_build_object('workspace',to_jsonb(w)-'settings_json'-'widget_public_key','controls',to_jsonb(ctl),'company',(SELECT profile FROM public.workspace_company_profiles WHERE workspace_id=p_workspace_id),'domains',(SELECT jsonb_agg(jsonb_build_object('domain',domain,'verified',verified)) FROM public.allowed_domains WHERE workspace_id=p_workspace_id));
 IF p_action='company' THEN
  FOR k,v IN SELECT * FROM jsonb_each(p_payload) LOOP
   IF k NOT IN ('name','legalName','website','email','phone','addressLine1','addressLine2','city','region','postalCode','country','taxId') OR jsonb_typeof(v)<>'string' OR length(v#>>'{}')>300 THEN RAISE EXCEPTION 'Invalid company field'; END IF;
  END LOOP;
  IF length(trim(COALESCE(p_payload->>'name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid company name'; END IF;
  UPDATE public.workspaces SET name=trim(p_payload->>'name'),updated_at=now() WHERE id=p_workspace_id;
  INSERT INTO public.workspace_company_profiles(workspace_id,profile) VALUES(p_workspace_id,p_payload-'name') ON CONFLICT(workspace_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=now();
 ELSIF p_action='access' THEN
  IF p_payload->>'access_mode' NOT IN ('standard','pilot') OR jsonb_typeof(p_payload->'features') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'limits') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid access'; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(p_payload->'features') LOOP
   IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION 'Invalid feature override'; END IF;
  END LOOP;
  UPDATE public.workspace_admin_controls SET access_mode=p_payload->>'access_mode',trial_ends_at=NULL,features=p_payload->'features',limits=p_payload->'limits',override_expires_at=NULLIF(p_payload->>'override_expires_at','')::timestamptz WHERE workspace_id=p_workspace_id;
 ELSIF p_action='trial' THEN
  IF (p_payload->>'trial_ends_at')::timestamptz<=now() THEN RAISE EXCEPTION 'Trial must end in the future'; END IF;
  IF ctl.access_mode='pilot' THEN RAISE EXCEPTION 'Pilot access must be changed explicitly before granting a trial'; END IF;
  IF EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts WHERE workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'Connected billing trial must be changed through Chargebee'; END IF;
  UPDATE public.workspace_admin_controls SET access_mode='trial',trial_ends_at=(p_payload->>'trial_ends_at')::timestamptz WHERE workspace_id=p_workspace_id;
 ELSIF p_action='status' THEN
  IF p_payload->>'status' NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Invalid workspace status'; END IF;
  UPDATE public.workspaces SET status=(p_payload->>'status')::public.app_workspace_status,updated_at=now() WHERE id=p_workspace_id;
 ELSIF p_action='note' THEN
  INSERT INTO public.platform_customer_notes(workspace_id,author_id,body) VALUES(p_workspace_id,p_actor_id,p_payload->>'body');
 ELSIF p_action='domain' THEN
  IF length(p_payload->>'domain') NOT BETWEEN 3 AND 253 OR p_payload->>'domain' !~ '^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$' THEN RAISE EXCEPTION 'Invalid domain'; END IF;
  IF p_payload->>'operation'='block' THEN
   UPDATE public.allowed_domains SET verified=false WHERE workspace_id=p_workspace_id AND domain=p_payload->>'domain';
  ELSIF p_payload->>'operation'='allow' THEN
   INSERT INTO public.allowed_domains(workspace_id,domain,verified) VALUES(p_workspace_id,p_payload->>'domain',true) ON CONFLICT(workspace_id,domain) DO UPDATE SET verified=true;
  ELSE RAISE EXCEPTION 'Invalid domain operation'; END IF;
 ELSIF p_action='member' THEN
  new_role=(p_payload->>'role')::public.app_member_role; new_status=(p_payload->>'status')::public.app_member_status;
  SELECT * INTO m FROM public.workspace_members WHERE id=(p_payload->>'member_id')::uuid AND workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member unavailable'; END IF;
  IF m.role='owner' AND m.status='active' AND (new_role<>'owner' OR new_status<>'active') AND (SELECT count(*) FROM public.workspace_members WHERE workspace_id=p_workspace_id AND role='owner' AND status='active')<=1 THEN RAISE EXCEPTION 'The last active owner cannot be removed'; END IF;
  previous=previous||jsonb_build_object('member',to_jsonb(m));
  UPDATE public.workspace_members SET role=new_role,status=new_status,updated_at=now() WHERE id=m.id;
 ELSE RAISE EXCEPTION 'Unknown administration action'; END IF;
 UPDATE public.workspace_admin_controls SET version=version+1,updated_at=now() WHERE workspace_id=p_workspace_id RETURNING * INTO ctl;
 SELECT jsonb_build_object('workspace',to_jsonb(x)-'settings_json'-'widget_public_key','controls',to_jsonb(ctl),'payload',p_payload,'company',(SELECT profile FROM public.workspace_company_profiles WHERE workspace_id=p_workspace_id),'domains',(SELECT jsonb_agg(jsonb_build_object('domain',domain,'verified',verified)) FROM public.allowed_domains WHERE workspace_id=p_workspace_id)) INTO next_state FROM public.workspaces x WHERE id=p_workspace_id;
 INSERT INTO public.platform_audit_log(actor_id,workspace_id,action,reason,before_json,after_json) VALUES(p_actor_id,p_workspace_id,p_action,trim(p_reason),previous,next_state);
 RETURN ctl.version;
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_apply(uuid,uuid,text,jsonb,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_apply(uuid,uuid,text,jsonb,text,integer) TO service_role;
