-- Preserve shared conversation history when an auth account is permanently removed.
ALTER TABLE public.workspace_members ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.workspace_members DROP CONSTRAINT workspace_members_user_id_fkey;
ALTER TABLE public.workspace_members ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY(user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.workspace_invitations ALTER COLUMN invited_by_user_id DROP NOT NULL;
ALTER TABLE public.workspace_invitations DROP CONSTRAINT workspace_invitations_invited_by_user_id_fkey;
ALTER TABLE public.workspace_invitations ADD CONSTRAINT workspace_invitations_invited_by_user_id_fkey FOREIGN KEY(invited_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE FUNCTION public.platform_admin_list_accounts(p_actor_id uuid,p_query text DEFAULT '',p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_administrators WHERE user_id=p_actor_id AND role='owner' AND enabled) THEN RAISE EXCEPTION 'Platform action denied' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('count',(SELECT count(*) FROM auth.users WHERE email ILIKE '%'||left(p_query,100)||'%'),'users',COALESCE(jsonb_agg(x.data),'[]'::jsonb)) INTO result
 FROM(SELECT jsonb_build_object('id',u.id,'email',u.email,'createdAt',u.created_at,'lastSignIn',u.last_sign_in_at,'confirmed',u.email_confirmed_at IS NOT NULL,'workspaces',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name,'role',m.role,'personal',m.role='owner' AND NOT EXISTS(SELECT 1 FROM public.workspace_members other WHERE other.workspace_id=w.id AND other.user_id IS NOT NULL AND other.user_id<>u.id))) FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id WHERE m.user_id=u.id AND w.deleted_at IS NULL),'[]'::jsonb)) AS data FROM auth.users u WHERE u.email ILIKE '%'||left(p_query,100)||'%' ORDER BY u.created_at DESC,u.id LIMIT 25 OFFSET (LEAST(GREATEST(p_page,1),10000)-1)*25)x;
 RETURN result;
END; $$;
CREATE FUNCTION public.platform_admin_delete_account(p_actor_id uuid,p_user_id uuid,p_expected_email text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target auth.users; personal uuid[]; company_names jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.platform_administrators WHERE user_id=p_actor_id AND role='owner' AND enabled) THEN RAISE EXCEPTION 'Platform action denied' USING ERRCODE='42501'; END IF;
 IF p_actor_id=p_user_id OR EXISTS(SELECT 1 FROM public.platform_administrators WHERE user_id=p_user_id AND enabled) THEN RAISE EXCEPTION 'Protected platform account'; END IF;
 IF length(trim(p_reason)) NOT BETWEEN 3 AND 2000 THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO target FROM auth.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR lower(target.email)<>lower(trim(p_expected_email)) THEN RAISE EXCEPTION 'Account changed'; END IF;
 -- Lock affected companies before checking personal/shared ownership.
 PERFORM w.id FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id WHERE m.user_id=p_user_id ORDER BY w.id FOR UPDATE OF w;
 SELECT COALESCE(array_agg(m.workspace_id),'{}'::uuid[]) INTO personal FROM public.workspace_members m WHERE m.user_id=p_user_id AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM public.workspace_members other WHERE other.workspace_id=m.workspace_id AND other.user_id IS NOT NULL AND other.user_id<>p_user_id);
 IF EXISTS(SELECT 1 FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id WHERE m.user_id=p_user_id AND m.role='owner' AND m.status='active' AND w.deleted_at IS NULL AND NOT m.workspace_id=ANY(personal) AND NOT EXISTS(SELECT 1 FROM public.workspace_members other WHERE other.workspace_id=m.workspace_id AND other.user_id<>p_user_id AND other.role='owner' AND other.status='active')) THEN RAISE EXCEPTION 'Transfer shared company ownership first'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts WHERE workspace_id=ANY(personal) AND (synced_at IS NULL OR synced_at<now()-interval '5 minutes' OR jsonb_path_exists(snapshot,'$.subscriptions[*] ? (@.status != "cancelled")'))) THEN RAISE EXCEPTION 'Close connected subscriptions first'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_billing_accounts b WHERE b.workspace_id=ANY(personal) AND NOT EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts c WHERE c.workspace_id=b.workspace_id)) THEN RAISE EXCEPTION 'Close connected subscriptions first'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]'::jsonb) INTO company_names FROM public.workspaces WHERE id=ANY(personal);
 UPDATE public.workspaces SET status='pending_deletion',deleted_at=COALESCE(deleted_at,now()),updated_at=now() WHERE id=ANY(personal);
 UPDATE public.workspace_members SET status='deactivated' WHERE user_id=p_user_id;
 UPDATE public.workspace_invitations SET revoked_at=now() WHERE (invited_by_user_id=p_user_id OR (workspace_id=ANY(personal)) OR email_normalized=lower(trim(target.email))) AND accepted_at IS NULL AND revoked_at IS NULL;
 -- Retain workspace-owned files and business records; remove account ownership so auth deletion is possible.
 UPDATE storage.objects SET owner=NULL,owner_id=NULL WHERE owner=p_user_id OR owner_id=p_user_id::text;
 INSERT INTO public.platform_audit_log(actor_id,action,reason,before_json,after_json) VALUES(p_actor_id,'account_delete',trim(p_reason),jsonb_build_object('user_id',p_user_id,'email',target.email),jsonb_build_object('deleted_user_id',p_user_id,'deleted_personal_companies',company_names));
 DELETE FROM auth.users WHERE id=p_user_id;
END; $$;
REVOKE ALL ON FUNCTION public.platform_admin_list_accounts(uuid,text,integer),public.platform_admin_delete_account(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_admin_list_accounts(uuid,text,integer),public.platform_admin_delete_account(uuid,uuid,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
