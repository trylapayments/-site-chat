CREATE OR REPLACE FUNCTION public.platform_customer_usage(p_actor_id uuid, p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.platform_administrators WHERE user_id=p_actor_id AND enabled) THEN
   RAISE EXCEPTION 'Platform access required' USING ERRCODE='42501';
 END IF;
 RETURN (SELECT jsonb_build_object('conversations',count(*),'openConversations',count(*) FILTER (WHERE status='open'))
 FROM public.conversations WHERE workspace_id=p_workspace_id);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_customer_usage(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_customer_usage(uuid,uuid) TO service_role;
