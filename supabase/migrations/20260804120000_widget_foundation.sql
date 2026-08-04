-- Phase 4B: widget foundation (public key, domains, visitor RPCs, rate limits)
-- Forward-only migration. See PR 4B implementation plan.

-- ---------------------------------------------------------------------------
-- workspaces: widget_public_key + settings_json
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspaces
  ADD COLUMN widget_public_key text,
  ADD COLUMN settings_json jsonb NOT NULL DEFAULT '{}';

UPDATE public.workspaces
SET widget_public_key = 'wk_' || replace(gen_random_uuid()::text, '-', '')
WHERE widget_public_key IS NULL;

ALTER TABLE public.workspaces
  ALTER COLUMN widget_public_key SET NOT NULL;

ALTER TABLE public.workspaces
  ADD CONSTRAINT chk_workspaces_widget_public_key_format CHECK (
    widget_public_key ~ '^wk_[a-f0-9]{32}$'
  );

CREATE UNIQUE INDEX uq_workspaces_widget_public_key
  ON public.workspaces (widget_public_key);

-- ---------------------------------------------------------------------------
-- allowed_domains
-- ---------------------------------------------------------------------------

CREATE TABLE public.allowed_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  domain text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_allowed_domains_workspace_domain UNIQUE (workspace_id, domain),
  CONSTRAINT chk_allowed_domains_domain_format CHECK (
    length(trim(domain)) > 0
    AND domain = lower(trim(domain))
  )
);

CREATE INDEX idx_allowed_domains_workspace_id ON public.allowed_domains (workspace_id);

-- ---------------------------------------------------------------------------
-- visitor_sessions: locale + page metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.visitor_sessions
  ADD COLUMN locale text NOT NULL DEFAULT 'en',
  ADD COLUMN initial_url text,
  ADD COLUMN current_url text,
  ADD COLUMN referrer text;

ALTER TABLE public.visitor_sessions
  ADD CONSTRAINT chk_visitor_sessions_locale CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$');

CREATE INDEX idx_visitor_sessions_token_hash
  ON public.visitor_sessions (session_token_hash);

-- ---------------------------------------------------------------------------
-- conversations: locale + one open/pending per session
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN locale text;

CREATE UNIQUE INDEX uq_conversations_one_open_pending_per_session
  ON public.conversations (visitor_session_id)
  WHERE status IN ('open', 'pending');

-- ---------------------------------------------------------------------------
-- widget_rate_limit_buckets (fixed-window; bucket_key is HMAC from app layer)
-- ---------------------------------------------------------------------------

CREATE TABLE public.widget_rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start),
  CONSTRAINT chk_widget_rate_limit_count CHECK (request_count >= 0)
);

CREATE INDEX idx_widget_rate_limit_buckets_window_start
  ON public.widget_rate_limit_buckets (window_start);

CREATE TRIGGER trg_widget_rate_limit_buckets_set_updated_at
  BEFORE UPDATE ON public.widget_rate_limit_buckets
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Domain helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.normalize_origin_host(p_origin text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_origin text;
  v_host text;
BEGIN
  v_origin := lower(trim(p_origin));
  IF v_origin = '' THEN
    RETURN NULL;
  END IF;

  IF v_origin !~ '^https?://' THEN
    v_origin := 'https://' || v_origin;
  END IF;

  v_host := split_part(split_part(v_origin, '://', 2), '/', 1);
  v_host := split_part(v_host, ':', 1);

  IF v_host = '' THEN
    RETURN NULL;
  END IF;

  IF v_host IN ('localhost', '127.0.0.1') THEN
    RETURN v_host;
  END IF;

  RETURN v_host;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.domain_matches_pattern(
  p_host text,
  p_pattern text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_host text;
  v_pattern text;
  v_suffix text;
BEGIN
  v_host := lower(trim(p_host));
  v_pattern := lower(trim(p_pattern));

  IF v_host = '' OR v_pattern = '' THEN
    RETURN false;
  END IF;

  IF v_pattern LIKE '*.%' THEN
    v_suffix := substring(v_pattern from 3);
    IF v_host = v_suffix THEN
      RETURN false;
    END IF;
    RETURN v_host LIKE ('%.' || v_suffix)
      AND v_host <> v_suffix;
  END IF;

  RETURN v_host = v_pattern;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.validate_widget_origin(
  p_workspace_id uuid,
  p_origin text,
  p_require_verified boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_host text;
BEGIN
  v_host := app_private.normalize_origin_host(p_origin);
  IF v_host IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.allowed_domains ad
    WHERE ad.workspace_id = p_workspace_id
      AND (NOT p_require_verified OR ad.verified = true)
      AND app_private.domain_matches_pattern(v_host, ad.domain)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Rate limit helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_consume_rate_limit(
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

  INSERT INTO public.widget_rate_limit_buckets (bucket_key, window_start, request_count)
  VALUES (p_bucket_key, v_window_start, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
  SET
    request_count = public.widget_rate_limit_buckets.request_count + 1,
    updated_at = now()
  RETURNING request_count INTO v_count;

  RETURN v_count <= p_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Widget settings extraction (allowlisted public subset)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_public_config(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_widget jsonb;
  v_branding jsonb;
  v_locale text;
BEGIN
  v_widget := COALESCE(p_settings -> 'widget', '{}'::jsonb);
  v_branding := COALESCE(v_widget -> 'branding', '{}'::jsonb);
  v_locale := COALESCE(v_widget ->> 'locale', 'en');

  IF v_locale NOT IN ('en', 'ru') THEN
    v_locale := 'en';
  END IF;

  RETURN jsonb_build_object(
    'locale', v_locale,
    'greetingMessage', COALESCE(v_widget ->> 'greetingMessage', 'Hi! How can we help?'),
    'reopenWindowHours', COALESCE((v_widget ->> 'reopenWindowHours')::integer, 24),
    'branding', jsonb_build_object(
      'displayName', NULLIF(v_branding ->> 'displayName', ''),
      'logoUrl', NULLIF(v_branding ->> 'logoUrl', ''),
      'primaryColor', COALESCE(NULLIF(v_branding ->> 'primaryColor', ''), '#0066FF'),
      'showPoweredBy', COALESCE((v_branding ->> 'showPoweredBy')::boolean, true)
    ),
    'position', CASE
      WHEN v_widget ->> 'position' IN ('bottom-right', 'bottom-left') THEN v_widget ->> 'position'
      ELSE 'bottom-right'
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_resolve_public_key(p_widget_public_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace public.workspaces;
BEGIN
  SELECT *
  INTO v_workspace
  FROM public.workspaces w
  WHERE w.widget_public_key = p_widget_public_key
    AND w.deleted_at IS NULL
    AND w.status = 'active';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'workspace_id', v_workspace.id,
    'widget_public_key', v_workspace.widget_public_key,
    'config', app_private.widget_public_config(v_workspace.settings_json)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Session token helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.hash_visitor_session_token(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION app_private.resolve_visitor_session(
  p_workspace_id uuid,
  p_session_token text
)
RETURNS public.visitor_sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
BEGIN
  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.workspace_id = p_workspace_id
    AND vs.session_token_hash = app_private.hash_visitor_session_token(p_session_token)
    AND vs.expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session invalid or expired';
  END IF;

  RETURN v_session;
END;
$$;

-- ---------------------------------------------------------------------------
-- Conversation lifecycle helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_reopen_window_hours(p_workspace_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF((w.settings_json -> 'widget' ->> 'reopenWindowHours')::integer, 0),
    24
  )
  FROM public.workspaces w
  WHERE w.id = p_workspace_id;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_viewable_conversation(
  p_workspace_id uuid,
  p_visitor_session_id uuid
)
RETURNS public.conversations
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation public.conversations;
  v_reopen_hours integer;
BEGIN
  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status IN ('open', 'pending')
  ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_conversation;
  END IF;

  v_reopen_hours := app_private.widget_reopen_window_hours(p_workspace_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status = 'resolved'
    AND c.resolved_at IS NOT NULL
    AND c.resolved_at > now() - make_interval(hours => v_reopen_hours)
  ORDER BY c.resolved_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_conversation;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_get_or_create_conversation_for_send(
  p_workspace_id uuid,
  p_visitor_session_id uuid,
  p_locale text,
  p_source_url text,
  p_referrer text
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation public.conversations;
  v_reopen_hours integer;
  v_conversation_id uuid;
BEGIN
  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status IN ('open', 'pending')
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_conversation;
  END IF;

  v_reopen_hours := app_private.widget_reopen_window_hours(p_workspace_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status = 'resolved'
    AND c.resolved_at IS NOT NULL
    AND c.resolved_at > now() - make_interval(hours => v_reopen_hours)
  ORDER BY c.resolved_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.conversations c
    SET
      status = 'open',
      resolved_at = NULL,
      resolved_by = NULL,
      locale = COALESCE(c.locale, p_locale),
      updated_at = now()
    WHERE c.id = v_conversation.id
    RETURNING * INTO v_conversation;

    RETURN v_conversation;
  END IF;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    channel_type,
    source_url,
    referrer,
    locale,
    next_message_sequence
  )
  VALUES (
    p_workspace_id,
    p_visitor_session_id,
    'open',
    'widget',
    p_source_url,
    p_referrer,
    p_locale,
    1
  )
  RETURNING id INTO v_conversation_id;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation_id;

  RETURN v_conversation;
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_conversation
    FROM public.conversations c
    WHERE c.workspace_id = p_workspace_id
      AND c.visitor_session_id = p_visitor_session_id
      AND c.status IN ('open', 'pending')
    ORDER BY c.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    RETURN v_conversation;
END;
$$;

-- ---------------------------------------------------------------------------
-- create_or_resume_visitor_session (app_private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_conversation public.conversations;
  v_new_token text;
  v_token_hash text;
  v_locale text;
BEGIN
  IF p_locale NOT IN ('en', 'ru') THEN
    v_locale := 'en';
  ELSE
    v_locale := p_locale;
  END IF;

  IF p_session_token IS NOT NULL AND length(trim(p_session_token)) > 0 THEN
    BEGIN
      v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

      UPDATE public.visitor_sessions vs
      SET
        expires_at = now() + interval '30 days',
        locale = v_locale,
        current_url = COALESCE(p_page_url, vs.current_url),
        referrer = COALESCE(p_referrer, vs.referrer),
        updated_at = now()
      WHERE vs.id = v_session.id
      RETURNING * INTO v_session;

      v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

      RETURN jsonb_build_object(
        'session_token', p_session_token,
        'expires_at', v_session.expires_at,
        'locale', v_session.locale,
        'has_conversation', v_conversation.id IS NOT NULL,
        'conversation_status', v_conversation.status
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  v_new_token := replace(
    replace(
      replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'),
      '/',
      '_'
    ),
    '=',
    ''
  );
  v_token_hash := app_private.hash_visitor_session_token(v_new_token);

  INSERT INTO public.visitor_sessions (
    workspace_id,
    session_token_hash,
    expires_at,
    locale,
    initial_url,
    current_url,
    referrer
  )
  VALUES (
    p_workspace_id,
    v_token_hash,
    now() + interval '30 days',
    v_locale,
    p_page_url,
    p_page_url,
    p_referrer
  )
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'session_token', v_new_token,
    'expires_at', v_session.expires_at,
    'locale', v_session.locale,
    'has_conversation', false,
    'conversation_status', NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- send_visitor_message (app_private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_send_visitor_message(
  p_workspace_id uuid,
  p_session_token text,
  p_body text,
  p_client_message_id uuid DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_body text;
  v_conversation public.conversations;
  v_existing public.messages;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_message_body(p_body);

  UPDATE public.visitor_sessions vs
  SET
    expires_at = now() + interval '30 days',
    current_url = COALESCE(p_page_url, vs.current_url),
    referrer = COALESCE(p_referrer, vs.referrer),
    updated_at = now()
  WHERE vs.id = v_session.id;

  v_conversation := app_private.widget_get_or_create_conversation_for_send(
    p_workspace_id,
    v_session.id,
    v_session.locale,
    COALESCE(p_page_url, v_session.current_url, v_session.initial_url),
    COALESCE(p_referrer, v_session.referrer)
  );

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.messages m
    WHERE m.conversation_id = v_conversation.id
      AND m.workspace_id = p_workspace_id
      AND m.client_message_id = p_client_message_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'message', jsonb_build_object(
          'id', v_existing.id,
          'sequence_number', v_existing.sequence_number,
          'sender_type', v_existing.sender_type,
          'body', v_existing.body,
          'created_at', v_existing.created_at
        ),
        'conversation_status', v_conversation.status
      );
    END IF;
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id
  FOR UPDATE;

  v_sequence := v_conversation.next_message_sequence;

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = left(v_body, 200),
    updated_at = now()
  WHERE c.id = v_conversation.id
    AND c.workspace_id = p_workspace_id;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body,
    is_internal,
    client_message_id
  )
  VALUES (
    p_workspace_id,
    v_conversation.id,
    v_sequence,
    'visitor',
    v_session.id,
    v_body,
    false,
    p_client_message_id
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message_id,
      'sequence_number', v_sequence,
      'sender_type', 'visitor',
      'body', v_body,
      'created_at', v_created_at
    ),
    'conversation_status', v_conversation.status
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- list_visitor_messages (app_private)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_list_visitor_messages(
  p_workspace_id uuid,
  p_session_token text,
  p_limit integer DEFAULT 50,
  p_before_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_conversation public.conversations;
  v_items jsonb;
  v_oldest_sequence bigint;
  v_has_older boolean;
  v_fetched_count integer;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid message limit';
  END IF;

  v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

  IF v_conversation IS NULL THEN
    RETURN jsonb_build_object(
      'items', '[]'::jsonb,
      'has_older', false,
      'oldest_sequence', NULL
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.sequence_number ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      msg.id,
      msg.sequence_number,
      msg.sender_type,
      msg.body,
      msg.created_at
    FROM public.messages msg
    WHERE msg.conversation_id = v_conversation.id
      AND msg.workspace_id = p_workspace_id
      AND msg.is_internal = false
      AND msg.sender_type IN ('visitor', 'agent', 'system')
      AND (p_before_sequence IS NULL OR msg.sequence_number < p_before_sequence)
    ORDER BY msg.sequence_number DESC
    LIMIT p_limit
  ) m;

  SELECT count(*)
  INTO v_fetched_count
  FROM jsonb_array_elements(v_items);

  IF v_fetched_count > 0 THEN
    SELECT (elem ->> 'sequence_number')::bigint
    INTO v_oldest_sequence
    FROM jsonb_array_elements(v_items) AS elem
    ORDER BY (elem ->> 'sequence_number')::bigint ASC
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.messages msg
      WHERE msg.conversation_id = v_conversation.id
        AND msg.workspace_id = p_workspace_id
        AND msg.is_internal = false
        AND msg.sender_type IN ('visitor', 'agent', 'system')
        AND msg.sequence_number < v_oldest_sequence
    )
    INTO v_has_older;
  ELSE
    v_oldest_sequence := NULL;
    v_has_older := false;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'has_older', COALESCE(v_has_older, false),
    'oldest_sequence', v_oldest_sequence
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public SECURITY DEFINER wrappers (service_role only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.widget_resolve_public_key(p_widget_public_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_resolve_public_key(p_widget_public_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_validate_origin(
  p_workspace_id uuid,
  p_origin text,
  p_require_verified boolean DEFAULT true
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.validate_widget_origin(p_workspace_id, p_origin, p_require_verified);
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_consume_rate_limit(
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
  RETURN app_private.widget_consume_rate_limit(p_bucket_key, p_window_seconds, p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_create_or_resume_visitor_session(
    p_workspace_id,
    p_session_token,
    p_locale,
    p_page_url,
    p_referrer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_send_visitor_message(
  p_workspace_id uuid,
  p_session_token text,
  p_body text,
  p_client_message_id uuid DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_send_visitor_message(
    p_workspace_id,
    p_session_token,
    p_body,
    p_client_message_id,
    p_page_url,
    p_referrer
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_list_visitor_messages(
  p_workspace_id uuid,
  p_session_token text,
  p_limit integer DEFAULT 50,
  p_before_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_list_visitor_messages(
    p_workspace_id,
    p_session_token,
    p_limit,
    p_before_sequence
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS for allowed_domains
-- ---------------------------------------------------------------------------

ALTER TABLE public.allowed_domains ENABLE ROW LEVEL SECURITY;

CREATE POLICY allowed_domains_select_authenticated
  ON public.allowed_domains
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

REVOKE ALL ON TABLE public.allowed_domains FROM anon;
GRANT SELECT ON TABLE public.allowed_domains TO authenticated;

REVOKE ALL ON TABLE public.widget_rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON TABLE public.widget_rate_limit_buckets FROM anon;
REVOKE ALL ON TABLE public.widget_rate_limit_buckets FROM authenticated;

-- ---------------------------------------------------------------------------
-- Grants: widget public RPCs → service_role only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.widget_resolve_public_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_validate_origin(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_consume_rate_limit(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_create_or_resume_visitor_session(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_send_visitor_message(uuid, text, text, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.widget_resolve_public_key(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.widget_validate_origin(uuid, text, boolean) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.widget_consume_rate_limit(text, integer, integer) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.widget_create_or_resume_visitor_session(uuid, text, text, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.widget_send_visitor_message(uuid, text, text, uuid, text, text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.widget_resolve_public_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_validate_origin(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_consume_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_create_or_resume_visitor_session(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_send_visitor_message(uuid, text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint) TO service_role;

-- Update create_workspace to assign widget_public_key for new workspaces
CREATE OR REPLACE FUNCTION app_private.create_workspace(p_name text, p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_workspace_id uuid;
  v_slug text;
  v_name text;
  v_public_key text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_public_key := 'wk_' || replace(gen_random_uuid()::text, '-', '');

  WITH new_workspace AS (
    INSERT INTO public.workspaces (name, slug, widget_public_key)
    VALUES (p_name, p_slug, v_public_key)
    RETURNING id, slug, name, widget_public_key
  ),
  new_member AS (
    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    SELECT nw.id, v_user_id, 'owner', 'active'
    FROM new_workspace nw
    RETURNING workspace_id
  )
  SELECT nw.id, nw.slug, nw.name, nw.widget_public_key
  INTO v_workspace_id, v_slug, v_name, v_public_key
  FROM new_workspace nw;

  INSERT INTO public.user_preferences (user_id, last_workspace_id)
  VALUES (v_user_id, v_workspace_id)
  ON CONFLICT (user_id) DO UPDATE
  SET
    last_workspace_id = EXCLUDED.last_workspace_id,
    updated_at = now();

  RETURN jsonb_build_object(
    'workspace_id', v_workspace_id,
    'slug', v_slug,
    'name', v_name,
    'widget_public_key', v_public_key
  );
END;
$$;
