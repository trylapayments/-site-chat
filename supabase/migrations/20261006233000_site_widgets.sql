CREATE TABLE public.widget_site_configs (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 domain text NOT NULL CHECK(domain=lower(domain) AND domain !~ '^www\.'),
 draft_json jsonb NOT NULL, published_json jsonb NOT NULL,
 published_version integer NOT NULL DEFAULT 1 CHECK(published_version>0),
 draft_updated_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,domain)
);
CREATE TABLE public.site_chat_settings (
 workspace_id uuid NOT NULL, domain text NOT NULL, config jsonb NOT NULL, version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,domain),
 FOREIGN KEY(workspace_id,domain) REFERENCES public.widget_site_configs(workspace_id,domain) ON DELETE CASCADE
);
ALTER TABLE public.widget_site_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_chat_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.widget_site_configs,public.site_chat_settings FROM anon,authenticated;
GRANT ALL ON public.widget_site_configs,public.site_chat_settings TO service_role;
CREATE TRIGGER protect_site_custom_launcher BEFORE INSERT OR UPDATE ON public.widget_site_configs FOR EACH ROW EXECUTE FUNCTION app_private.protect_custom_launcher();
CREATE FUNCTION public.site_widget_studio(p_workspace_id uuid,p_domain text,p_action text DEFAULT 'get',p_draft jsonb DEFAULT NULL,p_expected_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d text:=regexp_replace(lower(p_domain),'^www\.',''); r public.widget_site_configs; base public.widget_configs; v jsonb;
BEGIN
 IF p_action='get' THEN PERFORM app_private.require_widget_studio_view(p_workspace_id);
 ELSE PERFORM app_private.require_widget_studio_manage(p_workspace_id); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.allowed_domains WHERE workspace_id=p_workspace_id AND verified AND regexp_replace(lower(domain),'^www\.','')=d) THEN RAISE EXCEPTION 'Enabled website required'; END IF;
 PERFORM app_private.ensure_widget_config(p_workspace_id);
 SELECT * INTO base FROM public.widget_configs WHERE workspace_id=p_workspace_id;
 IF p_action<>'get' THEN
  INSERT INTO public.widget_site_configs(workspace_id,domain,draft_json,published_json,published_version) VALUES(p_workspace_id,d,base.published_json,base.published_json,base.published_version) ON CONFLICT DO NOTHING;
 END IF;
 SELECT * INTO r FROM public.widget_site_configs WHERE workspace_id=p_workspace_id AND domain=d FOR UPDATE;
 IF NOT FOUND THEN RETURN app_private.widget_studio_state_payload(base); END IF;
 IF p_action='save' THEN
  v:=app_private.validate_widget_appearance(p_draft);
  IF v->>'launcherIcon'='custom' OR r.draft_json->>'launcherIcon'='custom' OR v->'launcherIconAssetId' IS DISTINCT FROM r.draft_json->'launcherIconAssetId' THEN
   v:=v||jsonb_build_object('launcherIcon',r.draft_json->'launcherIcon','launcherIconAssetId',r.draft_json->'launcherIconAssetId');
  END IF;
  UPDATE public.widget_site_configs SET draft_json=v,draft_updated_at=now() WHERE workspace_id=p_workspace_id AND domain=d RETURNING * INTO r;
 ELSIF p_action='publish' THEN
  IF p_expected_version IS NOT NULL AND p_expected_version<>r.published_version THEN RAISE EXCEPTION 'PUBLISH_CONFLICT'; END IF;
  UPDATE public.widget_site_configs SET published_json=draft_json,published_version=published_version+1,published_at=now() WHERE workspace_id=p_workspace_id AND domain=d RETURNING * INTO r;
 ELSIF p_action='discard' THEN
  UPDATE public.widget_site_configs SET draft_json=published_json,draft_updated_at=now() WHERE workspace_id=p_workspace_id AND domain=d RETURNING * INTO r;
 ELSIF p_action='reset' THEN
  UPDATE public.widget_site_configs SET draft_json=base.published_json,draft_updated_at=now() WHERE workspace_id=p_workspace_id AND domain=d RETURNING * INTO r;
 ELSIF p_action<>'get' THEN RAISE EXCEPTION 'Invalid site action'; END IF;
 RETURN jsonb_build_object('draft',r.draft_json,'published',r.published_json,'publishedVersion',r.published_version,'draftUpdatedAt',r.draft_updated_at,'publishedAt',r.published_at,'draftDirty',r.draft_json IS DISTINCT FROM r.published_json);
END $$;
REVOKE ALL ON FUNCTION public.site_widget_studio(uuid,text,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.site_widget_studio(uuid,text,text,jsonb,integer) TO authenticated;
