-- A durable, service-only queue removes personal avatars through the Storage API.
CREATE TABLE public.account_deletion_storage_cleanup (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 bucket text NOT NULL CHECK(bucket IN ('agent-avatars','attachments','widget-assets')),
 path text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(bucket,path)
);
ALTER TABLE public.account_deletion_storage_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_storage_cleanup FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.account_deletion_storage_cleanup TO service_role;
-- Account access is revoked immediately. Personal company data is purged in
-- bounded, retryable batches by the existing authenticated scheduler.
CREATE TABLE public.account_deletion_workspace_cleanup (
 workspace_id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_workspace_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_workspace_cleanup FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.account_deletion_workspace_cleanup TO service_role;
CREATE FUNCTION public.process_account_deletion_workspace() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE job public.account_deletion_workspace_cleanup; relation record; changed integer;
BEGIN
 SELECT * INTO job FROM public.account_deletion_workspace_cleanup ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('pending',false); END IF;
 -- A queue record alone must never authorize removal of an active company.
 IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=job.workspace_id AND (deleted_at IS NULL OR status<>'pending_deletion')) THEN RAISE EXCEPTION 'COMPANY_NOT_CLOSED'; END IF;
 INSERT INTO public.account_deletion_storage_cleanup(user_id,bucket,path)
 SELECT job.user_id,o.bucket_id,o.name FROM storage.objects o
 WHERE ((o.bucket_id IN ('attachments','agent-avatars') AND o.name LIKE job.workspace_id::text||'/%') OR (o.bucket_id='widget-assets' AND o.name LIKE 'workspaces/'||job.workspace_id::text||'/%'))
 AND NOT EXISTS(SELECT 1 FROM public.account_deletion_storage_cleanup q WHERE q.bucket=o.bucket_id AND q.path=o.name)
 LIMIT 500 ON CONFLICT(bucket,path) DO NOTHING;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN RETURN jsonb_build_object('pending',true,'queuedFiles',changed); END IF;
 -- Child tables with RESTRICT foreign keys are emptied before their parents.
 -- Each invocation commits at most 500 rows from one table; retries are safe.
 FOR relation IN
 SELECT DISTINCT n.nspname,c.relname,
 CASE c.relname WHEN 'message_attachments' THEN 1 WHEN 'attachment_uploads' THEN 2 WHEN 'conversation_member_reads' THEN 3 WHEN 'conversation_visitor_reads' THEN 4 WHEN 'customer_timeline_events' THEN 5 WHEN 'visitor_page_views' THEN 6 WHEN 'messages' THEN 7 WHEN 'conversations' THEN 8 WHEN 'visitor_sessions' THEN 9 WHEN 'contacts' THEN 10 WHEN 'workspace_invitations' THEN 11 WHEN 'workspace_members' THEN 100 ELSE 20 END priority
 FROM pg_catalog.pg_constraint f JOIN pg_catalog.pg_class c ON c.oid=f.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE f.contype='f' AND f.confrelid='public.workspaces'::regclass AND n.nspname='public' AND c.relname NOT IN ('platform_audit_log','user_preferences')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='workspace_id' AND a.attnum=ANY(f.conkey))
 ORDER BY priority,c.relname
 LOOP
 EXECUTE pg_catalog.format('DELETE FROM %I.%I WHERE ctid IN (SELECT ctid FROM %I.%I WHERE workspace_id=$1 LIMIT 500)',relation.nspname,relation.relname,relation.nspname,relation.relname) USING job.workspace_id;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN RETURN jsonb_build_object('pending',true,'deletedRows',changed); END IF;
 END LOOP;
 DELETE FROM public.workspaces WHERE id=job.workspace_id;
 DELETE FROM public.account_deletion_workspace_cleanup WHERE workspace_id=job.workspace_id;
 RETURN jsonb_build_object('pending',EXISTS(SELECT 1 FROM public.account_deletion_workspace_cleanup));
END $$;
REVOKE ALL ON FUNCTION public.process_account_deletion_workspace() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_account_deletion_workspace() TO service_role;
-- Authenticated, account-scoped deletion. No caller-supplied target user.
CREATE FUNCTION app_private.own_account_deletion_state(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target auth.users; personal uuid[]; result jsonb;
BEGIN
 SELECT * INTO target FROM auth.users WHERE id=p_user_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE'; END IF;
 SELECT COALESCE(array_agg(m.workspace_id),'{}'::uuid[]) INTO personal
 FROM public.workspace_members m WHERE m.user_id=p_user_id AND m.role='owner'
 AND NOT EXISTS(SELECT 1 FROM public.workspace_members o WHERE o.workspace_id=m.workspace_id AND o.user_id IS NOT NULL AND o.user_id<>p_user_id);
 SELECT jsonb_build_object('email',target.email,
 'personalCompanies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)) FROM public.workspaces w WHERE w.id=ANY(personal) AND w.deleted_at IS NULL),'[]'::jsonb),
 'sharedCompanies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',w.id,'name',w.name)) FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id WHERE m.user_id=p_user_id AND NOT w.id=ANY(personal) AND w.deleted_at IS NULL),'[]'::jsonb),
 'blockers',COALESCE((SELECT jsonb_agg(b.item) FROM (
 SELECT jsonb_build_object('code','PROTECTED_ACCOUNT','message','Contact Mill support to manage a Mill administrator account.') item WHERE EXISTS(SELECT 1 FROM public.platform_administrators WHERE user_id=p_user_id AND enabled)
 UNION ALL SELECT jsonb_build_object('code','TRANSFER_OWNERSHIP','workspaceId',w.id,'message','Assign another owner to '||w.name||' before deleting your account.') FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id WHERE m.user_id=p_user_id AND m.role='owner' AND m.status='active' AND w.deleted_at IS NULL AND NOT w.id=ANY(personal) AND NOT EXISTS(SELECT 1 FROM public.workspace_members o WHERE o.workspace_id=w.id AND o.user_id<>p_user_id AND o.role='owner' AND o.status='active')
 UNION ALL SELECT jsonb_build_object('code','CLOSE_BILLING','workspaceId',w.id,'message','Cancel automatic renewal or verify subscriptions for '||w.name||' before deleting your account.') FROM public.workspaces w WHERE w.id=ANY(personal) AND (EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts a WHERE a.workspace_id=w.id AND (a.synced_at IS NULL OR a.synced_at<now()-interval '5 minutes' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(a.snapshot->'subscriptions','[]'::jsonb)) s WHERE COALESCE(s->>'status','') NOT IN ('cancelled','non_renewing')))) OR EXISTS(SELECT 1 FROM public.workspace_billing_accounts a WHERE a.workspace_id=w.id AND NOT EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts c WHERE c.workspace_id=w.id)))
 ) b),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION app_private.own_account_deletion_state(uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.own_account_deletion_preview() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 RETURN app_private.own_account_deletion_state(auth.uid());
END $$;
CREATE FUNCTION public.delete_own_account(p_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid:=auth.uid(); target auth.users; state jsonb; personal uuid[];
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE='42501'; END IF;
 -- Deletion requires a newly authenticated password session, not only an old bearer token.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(auth.jwt()->'amr','[]'::jsonb)) a WHERE a->>'method'='password' AND CASE WHEN (a->>'timestamp') ~ '^[0-9]{1,12}$' THEN (a->>'timestamp')::bigint BETWEEN extract(epoch FROM now())::bigint-300 AND extract(epoch FROM now())::bigint+30 ELSE false END) THEN RAISE EXCEPTION 'REAUTHENTICATION_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO target FROM auth.users WHERE id=actor FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_UNAVAILABLE'; END IF;
 IF p_confirmation IS DISTINCT FROM target.email THEN RAISE EXCEPTION 'CONFIRMATION_REQUIRED'; END IF;
 PERFORM w.id FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id WHERE m.user_id=actor ORDER BY w.id FOR UPDATE OF w;
 state:=app_private.own_account_deletion_state(actor);
 IF jsonb_array_length(state->'blockers')>0 THEN RETURN jsonb_build_object('deleted',false,'preview',state); END IF;
 SELECT COALESCE(array_agg(m.workspace_id),'{}'::uuid[]) INTO personal FROM public.workspace_members m WHERE m.user_id=actor AND m.role='owner' AND NOT EXISTS(SELECT 1 FROM public.workspace_members o WHERE o.workspace_id=m.workspace_id AND o.user_id IS NOT NULL AND o.user_id<>actor);
 UPDATE public.workspaces SET status='pending_deletion',deleted_at=COALESCE(deleted_at,now()),updated_at=now() WHERE id=ANY(personal);
 INSERT INTO public.account_deletion_workspace_cleanup(workspace_id,user_id) SELECT unnest(personal),actor ON CONFLICT(workspace_id) DO NOTHING;
 INSERT INTO public.account_deletion_storage_cleanup(user_id,bucket,path) SELECT actor,'agent-avatars',avatar_path FROM public.agent_profiles WHERE member_id IN(SELECT id FROM public.workspace_members WHERE user_id=actor) AND avatar_path IS NOT NULL ON CONFLICT(bucket,path) DO NOTHING;
 DELETE FROM public.agent_profiles WHERE member_id IN(SELECT id FROM public.workspace_members WHERE user_id=actor);
 UPDATE public.workspace_members SET status='deactivated' WHERE user_id=actor;
 UPDATE public.workspace_invitations SET revoked_at=now() WHERE (invited_by_user_id=actor OR workspace_id=ANY(personal) OR email_normalized=lower(target.email)) AND accepted_at IS NULL AND revoked_at IS NULL;
 UPDATE storage.objects SET owner=NULL,owner_id=NULL WHERE owner=actor OR owner_id=actor::text;
 INSERT INTO public.platform_audit_log(actor_id,action,reason,before_json,after_json) VALUES(actor,'self_account_delete','Account holder confirmed account deletion',NULL,jsonb_build_object('personal_company_count',cardinality(personal)));
 DELETE FROM auth.users WHERE id=actor;
 RETURN jsonb_build_object('deleted',true);
END $$;
REVOKE ALL ON FUNCTION public.own_account_deletion_preview(),public.delete_own_account(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.own_account_deletion_preview(),public.delete_own_account(text) TO authenticated;
NOTIFY pgrst,'reload schema';
