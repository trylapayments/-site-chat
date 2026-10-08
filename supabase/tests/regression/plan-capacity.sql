BEGIN;
DO $$
DECLARE w uuid; u uuid; u2 uuid; e text; failed boolean;
BEGIN
 SELECT id INTO u FROM auth.users LIMIT 1;
 SELECT id,email INTO u2,e FROM auth.users WHERE id<>u LIMIT 1;
 INSERT INTO public.workspaces(name,slug,widget_public_key) VALUES('Capacity regression','capacity-regression-'||substr(gen_random_uuid()::text,1,8),'wk_'||replace(gen_random_uuid()::text,'-','')) RETURNING id INTO w;
 UPDATE public.workspace_admin_controls SET access_mode='standard',plan_id='starter',limits='{"operator_seats":2}' WHERE workspace_id=w;
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,u,'owner');
 INSERT INTO public.workspace_invitations(workspace_id,email,role,token_hash,invited_by_user_id,expires_at) VALUES(w,e,'agent',gen_random_uuid()::text,u,now()+interval '1 day');
 failed:=false;
 BEGIN
 INSERT INTO public.workspace_invitations(workspace_id,email,role,token_hash,invited_by_user_id,expires_at) VALUES(w,'capacity-extra@example.com','agent',gen_random_uuid()::text,u,now()+interval '1 day');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'PLAN_OPERATOR_LIMIT:%' THEN failed:=true; ELSE RAISE; END IF; END;
 IF NOT failed THEN RAISE EXCEPTION 'Pending invitation did not reserve a seat'; END IF;
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,u2,'agent');
 UPDATE public.workspace_invitations SET accepted_at=now() WHERE workspace_id=w;
 UPDATE public.workspace_admin_controls SET limits='{"operator_seats":1}' WHERE workspace_id=w;
 UPDATE public.workspace_members SET role='admin' WHERE workspace_id=w AND user_id=u2;
 INSERT INTO public.workspace_invitations(workspace_id,email,role,token_hash,invited_by_user_id,expires_at) VALUES(w,'capacity-viewer@example.com','viewer',gen_random_uuid()::text,u,now()+interval '1 day');
 INSERT INTO public.allowed_domains(workspace_id,domain,verified) VALUES(w,'capacity.example.com',true),(w,'www.capacity.example.com',true);
 failed:=false;
 BEGIN INSERT INTO public.allowed_domains(workspace_id,domain,verified) VALUES(w,'second.example.com',true);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'PLAN_SITE_LIMIT:%' THEN failed:=true; ELSE RAISE; END IF; END;
 IF NOT failed THEN RAISE EXCEPTION 'Website capacity not enforced'; END IF;
 UPDATE public.allowed_domains SET verified=false WHERE workspace_id=w;
 INSERT INTO public.allowed_domains(workspace_id,domain,verified) VALUES(w,'second.example.com',true);
 UPDATE public.workspace_admin_controls SET plan_id='growth',limits='{}' WHERE workspace_id=w;
 IF app_private.workspace_capacity(w)->>'operators'<>'10' THEN RAISE EXCEPTION 'Upgrade capacity incorrect'; END IF;
END $$;
ROLLBACK;
