-- AI foundation: per-workspace config (settings_json.ai), usage telemetry,
-- and operator-scoped rate limiting for Suggested Replies.
-- AI is disabled by default; no provider secrets are stored in the database.

-- ---------------------------------------------------------------------------
-- Usage telemetry (no prompt/conversation content)
-- ---------------------------------------------------------------------------

CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  member_id uuid REFERENCES public.workspace_members (id) ON DELETE SET NULL,
  feature text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  status text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_usage_events_feature_check CHECK (
    feature IN ('suggested_replies')
  ),
  CONSTRAINT ai_usage_events_provider_check CHECK (
    provider IN ('openai', 'mock', 'anthropic', 'gemini', 'ollama')
  ),
  CONSTRAINT ai_usage_events_status_check CHECK (
    status IN ('success', 'error', 'rate_limited', 'timeout', 'cancelled')
  ),
  CONSTRAINT ai_usage_events_tokens_check CHECK (
    (prompt_tokens IS NULL OR prompt_tokens >= 0)
    AND (completion_tokens IS NULL OR completion_tokens >= 0)
    AND (total_tokens IS NULL OR total_tokens >= 0)
  )
);

CREATE INDEX idx_ai_usage_events_workspace_created
  ON public.ai_usage_events (workspace_id, created_at DESC);

CREATE INDEX idx_ai_usage_events_workspace_feature_created
  ON public.ai_usage_events (workspace_id, feature, created_at DESC);

COMMENT ON TABLE public.ai_usage_events IS
  'AI usage telemetry for billing/analytics. Never stores prompts or message bodies.';

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Members can read usage for workspaces they belong to (billing/analytics later).
CREATE POLICY ai_usage_events_select_member
  ON public.ai_usage_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = ai_usage_events.workspace_id
        AND wm.user_id = (SELECT auth.uid())
        AND wm.status = 'active'
    )
  );

-- No direct client inserts/updates/deletes. Service role inserts from API.
REVOKE INSERT, UPDATE, DELETE ON public.ai_usage_events FROM authenticated, anon;
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

-- ---------------------------------------------------------------------------
-- Operator AI rate limit buckets (HMAC bucket keys only; no raw identifiers)
-- ---------------------------------------------------------------------------

CREATE TABLE public.ai_rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX idx_ai_rate_limit_buckets_window
  ON public.ai_rate_limit_buckets (window_start);

ALTER TABLE public.ai_rate_limit_buckets ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon — service role only.
REVOKE ALL ON public.ai_rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON public.ai_rate_limit_buckets FROM anon, authenticated;
GRANT ALL ON public.ai_rate_limit_buckets TO service_role;

CREATE OR REPLACE FUNCTION app_private.ai_consume_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF p_window_seconds < 1 OR p_limit < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.ai_rate_limit_buckets (bucket_key, window_start, request_count)
  VALUES (p_bucket_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
  SET
    request_count = public.ai_rate_limit_buckets.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.ai_consume_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.ai_consume_rate_limit(p_bucket_key, p_window_seconds, p_limit);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_consume_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_consume_rate_limit(text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_consume_rate_limit(text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- Helpers: extract AI config from settings_json (never includes secrets)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.workspace_ai_config(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_ai jsonb;
  v_features jsonb;
  v_provider text;
BEGIN
  v_ai := COALESCE(p_settings -> 'ai', '{}'::jsonb);
  v_features := COALESCE(v_ai -> 'features', '{}'::jsonb);
  v_provider := COALESCE(v_ai ->> 'provider', 'openai');

  IF v_provider NOT IN ('openai', 'mock', 'anthropic', 'gemini', 'ollama') THEN
    v_provider := 'openai';
  END IF;

  RETURN jsonb_build_object(
    'enabled', COALESCE((v_ai ->> 'enabled')::boolean, false),
    'features', jsonb_build_object(
      'suggestedReplies', COALESCE((v_features ->> 'suggestedReplies')::boolean, false),
      'summary', COALESCE((v_features ->> 'summary')::boolean, false),
      'rag', COALESCE((v_features ->> 'rag')::boolean, false),
      'agent', COALESCE((v_features ->> 'agent')::boolean, false)
    ),
    'provider', v_provider,
    'model', NULLIF(v_ai ->> 'model', '')
  );
END;
$$;
