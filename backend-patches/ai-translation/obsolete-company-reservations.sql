-- OBSOLETE company quota design. Reference only. NEVER apply this file.
-- Server-only translation cache and monthly quota; existing AI credits are untouched.
CREATE TABLE public.ai_translation_usage (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 month_start date NOT NULL,
 used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
 PRIMARY KEY (workspace_id, month_start)
);
CREATE TABLE public.ai_translation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL,
 cache_key text NOT NULL CHECK (length(cache_key)=64),
 source_hash text NOT NULL CHECK (length(source_hash)=64),
 target_language text NOT NULL CHECK (target_language IN ('en','es','fr','de','it','pt','nl','pl','uk','ru','tr','ar','he','hi','ja','ko','zh','sv','da','fi')),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','complete','failed')),
 translated_text text,
 model text,
 prompt_tokens integer CHECK (prompt_tokens >= 0),
 completion_tokens integer CHECK (completion_tokens >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz,
 UNIQUE (workspace_id, cache_key),
 FOREIGN KEY (conversation_id,workspace_id) REFERENCES public.conversations(id,workspace_id) ON DELETE CASCADE,
 CHECK (state <> 'complete' OR length(trim(translated_text)) > 0 AND translated_text IS NOT NULL)
);
CREATE TABLE public.ai_translation_requests (
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id text NOT NULL CHECK (length(request_id) BETWEEN 1 AND 180),
 binding text NOT NULL CHECK (length(binding)=64),
 job_id uuid NOT NULL REFERENCES public.ai_translation_jobs(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (workspace_id,user_id,request_id)
);
ALTER TABLE public.ai_translation_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_translation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_translation_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_translation_usage,public.ai_translation_jobs,public.ai_translation_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_translation_usage,public.ai_translation_jobs,public.ai_translation_requests TO service_role;

-- p_limit is supplied only by the freshly authorized, versioned billing adapter.
-- Never expose this function to a client; all arguments are server-derived.
CREATE FUNCTION public.reserve_ai_translation(
 p_user_id uuid,p_workspace_id uuid,p_conversation_id uuid,p_target_language text,
 p_source_hash text,p_cache_key text,p_request_id text,p_binding text,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
 v_month date := date_trunc('month',now() AT TIME ZONE 'UTC')::date;
 v_used integer;
 v_job public.ai_translation_jobs%ROWTYPE;
 v_request public.ai_translation_requests%ROWTYPE;
BEGIN
 IF p_limit IS NULL OR p_limit NOT IN (1000,5000,15000) THEN
  RAISE EXCEPTION 'Translation is not included' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND status='active')
 OR NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=p_workspace_id AND status='active')
 OR NOT EXISTS (SELECT 1 FROM public.conversations WHERE id=p_conversation_id AND workspace_id=p_workspace_id) THEN
  RAISE EXCEPTION 'Translation access denied' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.ai_translation_usage(workspace_id,month_start) VALUES(p_workspace_id,v_month) ON CONFLICT DO NOTHING;
 -- Serializes all reservations in this company's current quota period, including
 -- concurrent cache misses and duplicate request IDs, without cross-company locks.
 SELECT used INTO v_used FROM public.ai_translation_usage WHERE workspace_id=p_workspace_id AND month_start=v_month FOR UPDATE;
 SELECT * INTO v_request FROM public.ai_translation_requests WHERE workspace_id=p_workspace_id AND user_id=p_user_id AND request_id=p_request_id;
 IF FOUND THEN
  IF v_request.binding <> p_binding THEN RAISE EXCEPTION 'Translation request changed' USING ERRCODE='22023'; END IF;
  SELECT * INTO STRICT v_job FROM public.ai_translation_jobs WHERE id=v_request.job_id AND workspace_id=p_workspace_id;
  IF v_job.conversation_id <> p_conversation_id OR v_job.source_hash <> p_source_hash OR v_job.target_language <> p_target_language OR v_job.cache_key <> p_cache_key THEN
   RAISE EXCEPTION 'Translation request does not match conversation' USING ERRCODE='22023';
  END IF;
 ELSE
  SELECT * INTO v_job FROM public.ai_translation_jobs WHERE workspace_id=p_workspace_id AND cache_key=p_cache_key;
  IF FOUND AND (v_job.conversation_id <> p_conversation_id OR v_job.source_hash <> p_source_hash OR v_job.target_language <> p_target_language) THEN
   RAISE EXCEPTION 'Translation cache does not match conversation' USING ERRCODE='22023';
  END IF;
  IF NOT FOUND THEN
   IF v_used >= p_limit THEN RETURN jsonb_build_object('status','quota_exceeded','remaining',0); END IF;
   INSERT INTO public.ai_translation_jobs(workspace_id,conversation_id,cache_key,source_hash,target_language)
   VALUES(p_workspace_id,p_conversation_id,p_cache_key,p_source_hash,p_target_language) RETURNING * INTO v_job;
   INSERT INTO public.ai_translation_requests(workspace_id,user_id,request_id,binding,job_id) VALUES(p_workspace_id,p_user_id,p_request_id,p_binding,v_job.id);
   UPDATE public.ai_translation_usage SET used=used+1 WHERE workspace_id=p_workspace_id AND month_start=v_month;
   RETURN jsonb_build_object('status','reserved','id',v_job.id,'remaining',greatest(0,p_limit-v_used-1));
  END IF;
  INSERT INTO public.ai_translation_requests(workspace_id,user_id,request_id,binding,job_id) VALUES(p_workspace_id,p_user_id,p_request_id,p_binding,v_job.id);
 END IF;
 IF v_job.state='complete' THEN RETURN jsonb_build_object('status','cached','translatedText',v_job.translated_text,'remaining',greatest(0,p_limit-v_used)); END IF;
 IF v_job.state='failed' THEN RETURN jsonb_build_object('status','failed'); END IF;
 RETURN jsonb_build_object('status','pending');
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_ai_translation(uuid,uuid,uuid,text,text,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_translation(uuid,uuid,uuid,text,text,text,text,text,integer) TO service_role;
