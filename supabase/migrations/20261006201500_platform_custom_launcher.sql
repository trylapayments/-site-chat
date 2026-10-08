-- Custom launcher artwork is supplied by Mill only, on customer request.
CREATE OR REPLACE FUNCTION app_private.protect_custom_launcher()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE field text; incoming jsonb; previous jsonb;
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  FOREACH field IN ARRAY ARRAY['draft_json', 'published_json'] LOOP
    incoming := to_jsonb(NEW)->field;
    previous := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD)->field ELSE '{}'::jsonb END;
    IF incoming->>'launcherIcon' = 'custom' OR previous->>'launcherIcon' = 'custom'
       OR incoming->'launcherIconAssetId' IS DISTINCT FROM previous->'launcherIconAssetId' THEN
      incoming := incoming || jsonb_build_object(
        'launcherIcon', COALESCE(previous->>'launcherIcon','chat'),
        'launcherIconAssetId', previous->'launcherIconAssetId');
      IF field = 'draft_json' THEN NEW.draft_json := incoming;
      ELSE NEW.published_json := incoming; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER protect_custom_launcher BEFORE INSERT OR UPDATE ON public.widget_configs
FOR EACH ROW EXECUTE FUNCTION app_private.protect_custom_launcher();

CREATE OR REPLACE FUNCTION public.platform_set_launcher_icon(
 p_actor_id uuid, p_workspace_id uuid, p_asset_id uuid, p_reason text, p_expected_version integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE current_config public.widget_configs; patch jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.platform_administrators WHERE user_id=p_actor_id AND enabled AND role='owner')
 THEN RAISE EXCEPTION 'Platform owner required' USING ERRCODE='42501'; END IF;
 IF length(trim(COALESCE(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Reason required'; END IF;
 SELECT * INTO STRICT current_config FROM public.widget_configs WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF current_config.published_version IS DISTINCT FROM p_expected_version THEN
   RAISE EXCEPTION 'Widget changed; refresh and retry' USING ERRCODE='40001';
 END IF;
 IF p_asset_id IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM public.widget_assets WHERE id=p_asset_id AND workspace_id=p_workspace_id
   AND kind='launcher_icon' AND deleted_at IS NULL AND width IS NOT NULL AND height IS NOT NULL
 ) THEN RAISE EXCEPTION 'Valid launcher asset required'; END IF;
 patch := jsonb_build_object('launcherIcon',CASE WHEN p_asset_id IS NULL THEN 'chat' ELSE 'custom' END,'launcherIconAssetId',p_asset_id);
 UPDATE public.widget_configs SET draft_json=draft_json||patch, published_json=published_json||patch,
 published_version=published_version+1, published_at=now(), published_by=p_actor_id,
 draft_updated_at=now(), draft_updated_by=p_actor_id WHERE workspace_id=p_workspace_id;
 INSERT INTO public.platform_audit_log(actor_id,workspace_id,action,reason,before_json,after_json)
 VALUES(p_actor_id,p_workspace_id,'custom_launcher_icon',trim(p_reason),
 jsonb_build_object('assetId',current_config.published_json->'launcherIconAssetId'),patch);
END;
$$;
REVOKE ALL ON FUNCTION public.platform_set_launcher_icon(uuid,uuid,uuid,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_launcher_icon(uuid,uuid,uuid,text,integer) TO service_role;
