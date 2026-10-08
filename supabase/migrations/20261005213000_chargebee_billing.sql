-- Chargebee is the calculation provider; Mill owns the tenant mapping and archive.
CREATE TABLE public.workspace_chargebee_accounts (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 site text NOT NULL CHECK(site ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
 customer_id text NOT NULL,
 snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
 synced_at timestamptz,
 PRIMARY KEY(workspace_id,site), UNIQUE(site,customer_id)
);
CREATE TABLE public.billing_card_setups (
 site text NOT NULL, intent_id text NOT NULL,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 customer_id text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(site,intent_id)
);
CREATE TABLE public.billing_resource_snapshots (
 site text NOT NULL, kind text NOT NULL CHECK(kind IN ('invoice','subscription','customer','payment_source')),
 resource_id text NOT NULL, customer_id text NOT NULL,
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 resource_version bigint NOT NULL, payload jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(site,kind,resource_id)
);
CREATE TABLE public.billing_provider_events (
 site text NOT NULL, event_id text NOT NULL, event_type text NOT NULL,
 processed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site,event_id)
);
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT unnest(ARRAY['workspace_chargebee_accounts','billing_card_setups','billing_resource_snapshots','billing_provider_events']) LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
CREATE FUNCTION public.apply_chargebee_event(p_site text,p_event_id text,p_event_type text,p_resources jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb; w uuid;
BEGIN
 INSERT INTO public.billing_provider_events(site,event_id,event_type) VALUES(p_site,p_event_id,p_event_type) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_resources) LOOP
 SELECT workspace_id INTO w FROM public.workspace_chargebee_accounts WHERE site=p_site AND customer_id=r->>'customer_id';
 IF w IS NULL THEN CONTINUE; END IF;
 INSERT INTO public.billing_resource_snapshots(site,kind,resource_id,customer_id,workspace_id,resource_version,payload)
 VALUES(p_site,r->>'kind',r->>'id',r->>'customer_id',w,(r->>'resource_version')::bigint,r->'payload')
 ON CONFLICT(site,kind,resource_id) DO UPDATE SET resource_version=EXCLUDED.resource_version,payload=EXCLUDED.payload,updated_at=now()
 WHERE EXCLUDED.resource_version>public.billing_resource_snapshots.resource_version;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.apply_chargebee_event(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_chargebee_event(text,text,text,jsonb) TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('billing-invoices','billing-invoices',false,10485760,ARRAY['application/pdf']) ON CONFLICT(id) DO NOTHING;
