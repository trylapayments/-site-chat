CREATE FUNCTION public.platform_admin_set_administrator(p_actor_id uuid,p_user_id uuid,p_role text,p_enabled boolean,p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('mill-platform-administrators'));
 IF NOT EXISTS(SELECT 1 FROM public.platform_administrators WHERE user_id=p_actor_id AND role='owner' AND enabled) THEN RAISE EXCEPTION 'Platform action denied' USING ERRCODE='42501'; END IF;
 IF p_role NOT IN ('owner','support','finance','viewer') OR length(trim(p_reason)) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Invalid platform permission request'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id AND email_confirmed_at IS NOT NULL AND deleted_at IS NULL) THEN RAISE EXCEPTION 'A confirmed Mill account is required'; END IF;
 SELECT to_jsonb(a) INTO previous FROM public.platform_administrators a WHERE user_id=p_user_id;
 IF (previous->>'role')='owner' AND (previous->>'enabled')::boolean AND (p_role<>'owner' OR NOT p_enabled) AND (SELECT count(*) FROM public.platform_administrators WHERE role='owner' AND enabled)<=1 THEN RAISE EXCEPTION 'The last platform owner cannot be removed'; END IF;
 INSERT INTO public.platform_administrators(user_id,role,enabled) VALUES(p_user_id,p_role,p_enabled) ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role,enabled=EXCLUDED.enabled;
 INSERT INTO public.platform_audit_log(actor_id,action,reason,before_json,after_json) VALUES(p_actor_id,'platform_permission',trim(p_reason),previous,jsonb_build_object('user_id',p_user_id,'role',p_role,'enabled',p_enabled));
END $$;
REVOKE ALL ON FUNCTION public.platform_admin_set_administrator(uuid,uuid,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_set_administrator(uuid,uuid,text,boolean,text) TO service_role;
