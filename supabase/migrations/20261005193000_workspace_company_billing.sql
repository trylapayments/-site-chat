-- Company records are tenant scoped; billing references are server-only.
CREATE TABLE public.workspace_company_profiles (
 workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
 profile jsonb NOT NULL DEFAULT '{}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_company_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_company_profiles FROM anon, authenticated;
GRANT ALL ON public.workspace_company_profiles TO service_role;
CREATE TABLE public.workspace_billing_accounts (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN ('test','live')),
 stripe_customer_id text NOT NULL CHECK(stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,mode), UNIQUE(mode,stripe_customer_id)
);
ALTER TABLE public.workspace_billing_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_billing_accounts FROM anon, authenticated;
GRANT ALL ON public.workspace_billing_accounts TO service_role;
CREATE FUNCTION public.get_workspace_company(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM app_private.require_workspace_access(p_workspace_id);
 RETURN (SELECT COALESCE(p.profile,'{}'::jsonb) || jsonb_build_object('name',w.name) FROM public.workspaces w LEFT JOIN public.workspace_company_profiles p ON p.workspace_id=w.id WHERE w.id=p_workspace_id);
END; $$;
CREATE FUNCTION public.update_workspace_company(p_workspace_id uuid,p_profile jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;v jsonb;
BEGIN
 PERFORM app_private.require_widget_studio_manage(p_workspace_id);
 IF jsonb_typeof(p_profile) IS DISTINCT FROM 'object' OR pg_column_size(p_profile)>8192 THEN RAISE EXCEPTION 'Invalid company profile'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_profile) LOOP
   IF k NOT IN ('name','legalName','website','email','phone','addressLine1','addressLine2','city','region','postalCode','country','taxId') OR jsonb_typeof(v)<>'string' OR length(v#>>'{}')>300 THEN RAISE EXCEPTION 'Invalid company field'; END IF;
 END LOOP;
 IF length(trim(COALESCE(p_profile->>'name',''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid company name'; END IF;
 UPDATE public.workspaces SET name=trim(p_profile->>'name'),updated_at=now() WHERE id=p_workspace_id;
 INSERT INTO public.workspace_company_profiles(workspace_id,profile) VALUES(p_workspace_id,p_profile-'name') ON CONFLICT(workspace_id) DO UPDATE SET profile=EXCLUDED.profile,updated_at=now();
 RETURN public.get_workspace_company(p_workspace_id);
END; $$;
REVOKE ALL ON FUNCTION public.get_workspace_company(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_workspace_company(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_company(uuid,jsonb) TO authenticated;
