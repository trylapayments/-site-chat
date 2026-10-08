-- Visitor identity + context: durable contacts.public_id, session device/UTM fields,
-- page-view trail, widget identify/page-view RPCs, operator profile update, and
-- richer conversation detail for the inbox.
--
-- Privacy notes:
-- - No raw IP address column is stored on visitor_sessions or related tables.
-- - country_code is reserved for future trusted platform headers only; never
--   derive it from IP geolocation in this migration or application path.
-- - contacts rows are the workspace-scoped visitor identity record.

-- ---------------------------------------------------------------------------
-- Enum: device type
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'app_device_type'
  ) THEN
    CREATE TYPE public.app_device_type AS ENUM (
      'desktop',
      'mobile',
      'tablet',
      'bot',
      'unknown'
    );
  END IF;
END;
$$;

COMMENT ON TYPE public.app_device_type IS
  'Parsed device class for visitor sessions (never raw User-Agent).';

-- ---------------------------------------------------------------------------
-- contacts: public_id + visit_count + phone_e164
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS public_id text,
  ADD COLUMN IF NOT EXISTS visit_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS phone_e164 text;

COMMENT ON TABLE public.contacts IS
  'Workspace visitor identity. One row per known visitor (anonymous or identified). '
  'public_id (vis_…) is the opaque client-facing identifier; email uniquely identifies '
  'within a workspace when present.';

COMMENT ON COLUMN public.contacts.public_id IS
  'Opaque visitor public id: vis_ + 32 lowercase hex. Safe for widget localStorage and host APIs.';

COMMENT ON COLUMN public.contacts.visit_count IS
  'Number of visitor sessions linked to this contact (starts at 1 on create).';

COMMENT ON COLUMN public.contacts.phone_e164 IS
  'Optional normalized phone (+digits). Display form remains in phone.';

COMMENT ON COLUMN public.contacts.custom_attributes_json IS
  'Host-provided visitor attributes (primitive JSON values). Null patch values delete keys.';

-- Backfill public_id before NOT NULL / format check
UPDATE public.contacts
SET public_id = 'vis_' || encode(extensions.gen_random_bytes(16), 'hex')
WHERE public_id IS NULL;

ALTER TABLE public.contacts
  ALTER COLUMN public_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_contacts_public_id_format'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_public_id_format
      CHECK (public_id ~ '^vis_[a-f0-9]{32}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_contacts_visit_count'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_visit_count
      CHECK (visit_count >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_contacts_phone_e164'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_phone_e164
      CHECK (
        phone_e164 IS NULL
        OR (
          char_length(phone_e164) BETWEEN 1 AND 20
          AND phone_e164 ~ '^\+?[0-9]+$'
        )
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_public_id
  ON public.contacts (workspace_id, public_id);

-- ---------------------------------------------------------------------------
-- visitor_sessions: page/device/UTM context (no raw IP / UA)
-- ---------------------------------------------------------------------------

ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS current_title text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS utm_term text,
  ADD COLUMN IF NOT EXISTS browser_family text,
  ADD COLUMN IF NOT EXISTS browser_version text,
  ADD COLUMN IF NOT EXISTS os_family text,
  ADD COLUMN IF NOT EXISTS device_type public.app_device_type,
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS country_code char(2);

-- Backfill last_seen_at for existing rows
UPDATE public.visitor_sessions
SET last_seen_at = COALESCE(updated_at, created_at, now())
WHERE last_seen_at IS NULL;

ALTER TABLE public.visitor_sessions
  ALTER COLUMN last_seen_at SET DEFAULT now(),
  ALTER COLUMN last_seen_at SET NOT NULL;

COMMENT ON COLUMN public.visitor_sessions.country_code IS
  'Reserved for future trusted platform geo headers only. Never populate from IP geolocation.';

COMMENT ON COLUMN public.visitor_sessions.last_seen_at IS
  'Last activity timestamp for this browser session (init, page view, message).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_landing_url_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_landing_url_len
      CHECK (landing_url IS NULL OR char_length(landing_url) <= 2048);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_current_url_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_current_url_len
      CHECK (current_url IS NULL OR char_length(current_url) <= 2048);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_initial_url_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_initial_url_len
      CHECK (initial_url IS NULL OR char_length(initial_url) <= 2048);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_referrer_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_referrer_len
      CHECK (referrer IS NULL OR char_length(referrer) <= 2048);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_current_title_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_current_title_len
      CHECK (current_title IS NULL OR char_length(current_title) <= 500);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_utm_source_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_utm_source_len
      CHECK (utm_source IS NULL OR char_length(utm_source) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_utm_medium_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_utm_medium_len
      CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_utm_campaign_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_utm_campaign_len
      CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_utm_content_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_utm_content_len
      CHECK (utm_content IS NULL OR char_length(utm_content) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_utm_term_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_utm_term_len
      CHECK (utm_term IS NULL OR char_length(utm_term) <= 200);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_browser_family_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_browser_family_len
      CHECK (browser_family IS NULL OR char_length(browser_family) <= 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_browser_version_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_browser_version_len
      CHECK (browser_version IS NULL OR char_length(browser_version) <= 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_os_family_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_os_family_len
      CHECK (os_family IS NULL OR char_length(os_family) <= 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_timezone_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_timezone_len
      CHECK (timezone IS NULL OR char_length(timezone) <= 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_language_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_language_len
      CHECK (language IS NULL OR char_length(language) <= 35);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_country_code'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_country_code
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- visitor_page_views
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.visitor_page_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  visitor_session_id uuid NOT NULL,
  contact_id uuid,
  url text NOT NULL,
  title text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_visitor_page_views_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_visitor_page_views_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_visitor_page_views_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_visitor_page_views_url_len CHECK (char_length(url) BETWEEN 1 AND 2048),
  CONSTRAINT chk_visitor_page_views_title_len CHECK (title IS NULL OR char_length(title) <= 500),
  CONSTRAINT chk_visitor_page_views_referrer_len CHECK (referrer IS NULL OR char_length(referrer) <= 2048),
  CONSTRAINT chk_visitor_page_views_utm_source_len CHECK (utm_source IS NULL OR char_length(utm_source) <= 200),
  CONSTRAINT chk_visitor_page_views_utm_medium_len CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 200),
  CONSTRAINT chk_visitor_page_views_utm_campaign_len CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 200),
  CONSTRAINT chk_visitor_page_views_utm_content_len CHECK (utm_content IS NULL OR char_length(utm_content) <= 200),
  CONSTRAINT chk_visitor_page_views_utm_term_len CHECK (utm_term IS NULL OR char_length(utm_term) <= 200)
);

COMMENT ON TABLE public.visitor_page_views IS
  'Bounded page-view trail for visitor sessions. No raw IP or User-Agent storage.';

CREATE INDEX IF NOT EXISTS idx_visitor_page_views_contact_created
  ON public.visitor_page_views (workspace_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visitor_page_views_session_created
  ON public.visitor_page_views (visitor_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_visitor_page_views_session_url_created
  ON public.visitor_page_views (visitor_session_id, url, created_at DESC);

ALTER TABLE public.visitor_page_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visitor_page_views_select_authenticated ON public.visitor_page_views;
CREATE POLICY visitor_page_views_select_authenticated
  ON public.visitor_page_views
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

REVOKE ALL ON TABLE public.visitor_page_views FROM PUBLIC;
REVOKE ALL ON TABLE public.visitor_page_views FROM anon;
REVOKE ALL ON TABLE public.visitor_page_views FROM authenticated;
GRANT SELECT ON TABLE public.visitor_page_views TO authenticated;
GRANT ALL ON TABLE public.visitor_page_views TO service_role;

-- ---------------------------------------------------------------------------
-- Realtime publication + replica identity
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'contacts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'visitor_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visitor_sessions;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'visitor_page_views'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visitor_page_views;
  END IF;
END;
$$;

ALTER TABLE public.contacts REPLICA IDENTITY FULL;
ALTER TABLE public.visitor_sessions REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- Helpers: text bounds, device type, public id, attributes merge
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.bounded_text(p_value text, p_max integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN length(btrim(p_value)) = 0 THEN NULL
    ELSE left(btrim(p_value), p_max)
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.parse_device_type(p_value text)
RETURNS public.app_device_type
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_raw text;
BEGIN
  v_raw := lower(btrim(COALESCE(p_value, '')));
  IF v_raw IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown') THEN
    RETURN v_raw::public.app_device_type;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.generate_visitor_public_id()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT 'vis_' || encode(extensions.gen_random_bytes(16), 'hex');
$$;

COMMENT ON FUNCTION app_private.generate_visitor_public_id() IS
  'Generate a new opaque visitor public id (vis_ + 32 hex).';

CREATE OR REPLACE FUNCTION app_private.merge_visitor_attributes(
  p_existing jsonb,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_key text;
  v_value jsonb;
  v_count integer;
BEGIN
  v_result := COALESCE(p_existing, '{}'::jsonb);
  IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
    RETURN v_result;
  END IF;

  IF jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Attributes must be an object';
  END IF;

  FOR v_key, v_value IN
    SELECT key, value
    FROM jsonb_each(p_patch)
  LOOP
    IF v_key IS NULL OR length(v_key) = 0 OR length(v_key) > 64 THEN
      RAISE EXCEPTION 'Invalid attribute key';
    END IF;

    IF lower(v_key) IN (
      '__proto__', 'constructor', 'prototype',
      'workspace_id', 'workspaceid',
      'visitor_id', 'visitorid',
      'contact_id', 'contactid',
      'public_id', 'publicid',
      'session_id', 'sessionid',
      'id'
    ) THEN
      RAISE EXCEPTION 'Reserved attribute key';
    END IF;

    IF v_key !~ '^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$' THEN
      RAISE EXCEPTION 'Invalid attribute key';
    END IF;

    IF v_value = 'null'::jsonb THEN
      v_result := v_result - v_key;
    ELSE
      IF jsonb_typeof(v_value) = 'string' AND char_length(v_value #>> '{}') > 500 THEN
        RAISE EXCEPTION 'Attribute value too long';
      END IF;
      IF jsonb_typeof(v_value) NOT IN ('string', 'number', 'boolean') THEN
        RAISE EXCEPTION 'Attribute values must be string, number, boolean, or null';
      END IF;
      v_result := v_result || jsonb_build_object(v_key, v_value);
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM jsonb_object_keys(v_result);
  IF v_count > 50 THEN
    RAISE EXCEPTION 'Too many attributes';
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.visitor_profile_json(p_contact public.contacts)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'public_id', p_contact.public_id,
    'name', p_contact.name,
    'email', p_contact.email,
    'phone', p_contact.phone,
    'phone_e164', p_contact.phone_e164,
    'attributes', COALESCE(p_contact.custom_attributes_json, '{}'::jsonb),
    'first_seen_at', p_contact.first_seen_at,
    'last_seen_at', p_contact.last_seen_at,
    'visit_count', p_contact.visit_count
  );
$$;

CREATE OR REPLACE FUNCTION app_private.touch_session_open_conversations(
  p_workspace_id uuid,
  p_visitor_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.conversations c
  SET updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status IN ('open', 'pending');
END;
$$;

-- ---------------------------------------------------------------------------
-- ensure_visitor_contact
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.ensure_visitor_contact(
  p_workspace_id uuid,
  p_visitor_public_id text DEFAULT NULL,
  p_bump_visit_count boolean DEFAULT false
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_public_id text;
BEGIN
  v_public_id := NULLIF(btrim(COALESCE(p_visitor_public_id, '')), '');

  IF v_public_id IS NOT NULL AND v_public_id ~ '^vis_[a-f0-9]{32}$' THEN
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.public_id = v_public_id
    FOR UPDATE;

    IF FOUND THEN
      IF p_bump_visit_count THEN
        UPDATE public.contacts c
        SET
          visit_count = c.visit_count + 1,
          last_seen_at = now(),
          updated_at = now()
        WHERE c.id = v_contact.id
        RETURNING * INTO v_contact;
      ELSE
        UPDATE public.contacts c
        SET
          last_seen_at = now(),
          updated_at = now()
        WHERE c.id = v_contact.id
        RETURNING * INTO v_contact;
      END IF;

      RETURN v_contact;
    END IF;
  END IF;

  INSERT INTO public.contacts (
    workspace_id,
    public_id,
    visit_count,
    first_seen_at,
    last_seen_at
  )
  VALUES (
    p_workspace_id,
    app_private.generate_visitor_public_id(),
    1,
    now(),
    now()
  )
  RETURNING * INTO v_contact;

  RETURN v_contact;
END;
$$;

COMMENT ON FUNCTION app_private.ensure_visitor_contact(uuid, text, boolean) IS
  'Resolve or create an anonymous workspace visitor contact by public_id. '
  'When p_bump_visit_count is true and an existing contact is reused (new session), visit_count increments.';

-- ---------------------------------------------------------------------------
-- REPLACE widget_create_or_resume_visitor_session (expanded signature)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.widget_create_or_resume_visitor_session(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS app_private.widget_create_or_resume_visitor_session(uuid, text, text, text, text);

CREATE OR REPLACE FUNCTION app_private.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_visitor_public_id text DEFAULT NULL,
  p_page_title text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_browser_family text DEFAULT NULL,
  p_browser_version text DEFAULT NULL,
  p_os_family text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_landing_url text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_conversation public.conversations;
  v_contact public.contacts;
  v_new_token text;
  v_token_hash text;
  v_locale text;
  v_page_url text;
  v_page_title text;
  v_referrer text;
  v_landing_url text;
  v_timezone text;
  v_language text;
  v_browser_family text;
  v_browser_version text;
  v_os_family text;
  v_device_type public.app_device_type;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_content text;
  v_utm_term text;
BEGIN
  v_locale := app_private.normalize_widget_locale(p_locale);
  v_page_url := app_private.bounded_text(p_page_url, 2048);
  v_page_title := app_private.bounded_text(p_page_title, 500);
  v_referrer := app_private.bounded_text(p_referrer, 2048);
  v_landing_url := COALESCE(
    app_private.bounded_text(p_landing_url, 2048),
    v_page_url
  );
  v_timezone := app_private.bounded_text(p_timezone, 64);
  v_language := app_private.bounded_text(p_language, 35);
  v_browser_family := app_private.bounded_text(p_browser_family, 64);
  v_browser_version := app_private.bounded_text(p_browser_version, 64);
  v_os_family := app_private.bounded_text(p_os_family, 64);
  v_device_type := app_private.parse_device_type(p_device_type);
  v_utm_source := app_private.bounded_text(p_utm_source, 200);
  v_utm_medium := app_private.bounded_text(p_utm_medium, 200);
  v_utm_campaign := app_private.bounded_text(p_utm_campaign, 200);
  v_utm_content := app_private.bounded_text(p_utm_content, 200);
  v_utm_term := app_private.bounded_text(p_utm_term, 200);

  IF p_session_token IS NOT NULL AND length(btrim(p_session_token)) > 0 THEN
    BEGIN
      v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

      UPDATE public.visitor_sessions vs
      SET
        expires_at = now() + interval '30 days',
        locale = v_locale,
        current_url = COALESCE(v_page_url, vs.current_url),
        current_title = COALESCE(v_page_title, vs.current_title),
        referrer = COALESCE(v_referrer, vs.referrer),
        browser_family = COALESCE(vs.browser_family, v_browser_family),
        browser_version = COALESCE(vs.browser_version, v_browser_version),
        os_family = COALESCE(vs.os_family, v_os_family),
        device_type = COALESCE(vs.device_type, v_device_type),
        timezone = COALESCE(vs.timezone, v_timezone),
        language = COALESCE(vs.language, v_language),
        last_seen_at = now(),
        updated_at = now()
      WHERE vs.id = v_session.id
      RETURNING * INTO v_session;

      IF v_session.contact_id IS NULL THEN
        v_contact := app_private.ensure_visitor_contact(
          p_workspace_id,
          p_visitor_public_id,
          false
        );
        UPDATE public.visitor_sessions vs
        SET contact_id = v_contact.id, updated_at = now()
        WHERE vs.id = v_session.id
        RETURNING * INTO v_session;
      ELSE
        UPDATE public.contacts c
        SET last_seen_at = now(), updated_at = now()
        WHERE c.id = v_session.contact_id
          AND c.workspace_id = p_workspace_id
        RETURNING * INTO v_contact;
      END IF;

      v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

      RETURN jsonb_build_object(
        'session_token', p_session_token,
        'expires_at', v_session.expires_at,
        'locale', v_session.locale,
        'has_conversation', v_conversation.id IS NOT NULL,
        'conversation_status', v_conversation.status,
        'visitor_public_id', v_contact.public_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  -- New session: reuse contact by public_id when valid (bumps visit_count), else create.
  v_contact := app_private.ensure_visitor_contact(
    p_workspace_id,
    p_visitor_public_id,
    true
  );

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
    contact_id,
    session_token_hash,
    expires_at,
    locale,
    initial_url,
    current_url,
    current_title,
    referrer,
    landing_url,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    browser_family,
    browser_version,
    os_family,
    device_type,
    timezone,
    language,
    last_seen_at
  )
  VALUES (
    p_workspace_id,
    v_contact.id,
    v_token_hash,
    now() + interval '30 days',
    v_locale,
    v_page_url,
    v_page_url,
    v_page_title,
    v_referrer,
    v_landing_url,
    v_utm_source,
    v_utm_medium,
    v_utm_campaign,
    v_utm_content,
    v_utm_term,
    v_browser_family,
    v_browser_version,
    v_os_family,
    v_device_type,
    v_timezone,
    v_language,
    now()
  )
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'session_token', v_new_token,
    'expires_at', v_session.expires_at,
    'locale', v_session.locale,
    'has_conversation', false,
    'conversation_status', NULL,
    'visitor_public_id', v_contact.public_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_visitor_public_id text DEFAULT NULL,
  p_page_title text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_language text DEFAULT NULL,
  p_browser_family text DEFAULT NULL,
  p_browser_version text DEFAULT NULL,
  p_os_family text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_landing_url text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
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
    p_referrer,
    p_visitor_public_id,
    p_page_title,
    p_timezone,
    p_language,
    p_browser_family,
    p_browser_version,
    p_os_family,
    p_device_type,
    p_landing_url,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    p_utm_content,
    p_utm_term
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- widget_identify_visitor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_identify_visitor(
  p_workspace_id uuid,
  p_session_token text,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_phone_e164 text DEFAULT NULL,
  p_attributes jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_contact public.contacts;
  v_email_contact public.contacts;
  v_old_contact_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_e164 text;
  v_has_name boolean := false;
  v_has_email boolean := false;
  v_has_phone boolean := false;
  v_has_phone_e164 boolean := false;
  v_other_sessions integer;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  IF p_name IS NOT NULL THEN
    v_has_name := true;
    v_name := app_private.bounded_text(p_name, 120);
  END IF;

  IF p_email IS NOT NULL THEN
    v_has_email := true;
    IF btrim(p_email) = '' THEN
      v_email := NULL;
    ELSE
      IF char_length(btrim(p_email)) > 254 THEN
        RAISE EXCEPTION 'Email is too long';
      END IF;
      IF position('@' IN btrim(p_email)) < 2
         OR btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
        RAISE EXCEPTION 'Invalid email format';
      END IF;
      -- Preserve local-part casing; lowercase domain only.
      v_email := split_part(btrim(p_email), '@', 1)
        || '@'
        || lower(split_part(btrim(p_email), '@', 2));
    END IF;
  END IF;

  IF p_phone IS NOT NULL THEN
    v_has_phone := true;
    v_phone := app_private.bounded_text(p_phone, 64);
  END IF;

  IF p_phone_e164 IS NOT NULL THEN
    v_has_phone_e164 := true;
    v_phone_e164 := NULLIF(btrim(p_phone_e164), '');
    IF v_phone_e164 IS NOT NULL THEN
      IF char_length(v_phone_e164) > 20 OR v_phone_e164 !~ '^\+?[0-9]+$' THEN
        RAISE EXCEPTION 'Invalid phone_e164';
      END IF;
    END IF;
  END IF;

  IF p_attributes IS NOT NULL AND jsonb_typeof(p_attributes) <> 'object' THEN
    RAISE EXCEPTION 'Attributes must be an object';
  END IF;

  IF v_session.contact_id IS NULL THEN
    v_contact := app_private.ensure_visitor_contact(p_workspace_id, NULL, false);
    UPDATE public.visitor_sessions vs
    SET contact_id = v_contact.id, updated_at = now(), last_seen_at = now()
    WHERE vs.id = v_session.id
    RETURNING * INTO v_session;
  ELSE
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = v_session.contact_id
      AND c.workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_contact := app_private.ensure_visitor_contact(p_workspace_id, NULL, false);
      UPDATE public.visitor_sessions vs
      SET contact_id = v_contact.id, updated_at = now(), last_seen_at = now()
      WHERE vs.id = v_session.id
      RETURNING * INTO v_session;
    END IF;
  END IF;

  -- Email ownership merge: if email belongs to another contact, reassign FKs.
  IF v_has_email AND v_email IS NOT NULL THEN
    SELECT *
    INTO v_email_contact
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.email IS NOT NULL
      AND lower(c.email) = lower(v_email)
      AND c.id <> v_contact.id
    FOR UPDATE;

    IF FOUND THEN
      v_old_contact_id := v_contact.id;

      UPDATE public.contacts c
      SET
        name = COALESCE(c.name, CASE WHEN v_has_name THEN v_name ELSE v_contact.name END),
        phone = COALESCE(c.phone, CASE WHEN v_has_phone THEN v_phone ELSE v_contact.phone END),
        phone_e164 = COALESCE(
          c.phone_e164,
          CASE WHEN v_has_phone_e164 THEN v_phone_e164 ELSE v_contact.phone_e164 END
        ),
        custom_attributes_json = app_private.merge_visitor_attributes(
          app_private.merge_visitor_attributes(
            c.custom_attributes_json,
            v_contact.custom_attributes_json
          ),
          p_attributes
        ),
        last_seen_at = now(),
        updated_at = now()
      WHERE c.id = v_email_contact.id
      RETURNING * INTO v_contact;

      UPDATE public.visitor_sessions vs
      SET contact_id = v_contact.id, updated_at = now(), last_seen_at = now()
      WHERE vs.id = v_session.id
        AND vs.workspace_id = p_workspace_id;

      UPDATE public.conversations c
      SET contact_id = v_contact.id, updated_at = now()
      WHERE c.workspace_id = p_workspace_id
        AND c.visitor_session_id = v_session.id
        AND c.status IN ('open', 'pending');

      SELECT count(*)
      INTO v_other_sessions
      FROM public.visitor_sessions vs
      WHERE vs.workspace_id = p_workspace_id
        AND vs.contact_id = v_old_contact_id
        AND vs.id <> v_session.id;

      IF v_other_sessions = 0 THEN
        -- Delete orphan anonymous contact when it has no email and no remaining sessions.
        DELETE FROM public.contacts c
        WHERE c.id = v_old_contact_id
          AND c.workspace_id = p_workspace_id
          AND c.email IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM public.visitor_sessions vs
            WHERE vs.contact_id = v_old_contact_id
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.conversations conv
            WHERE conv.contact_id = v_old_contact_id
          );
      END IF;

      PERFORM app_private.touch_session_open_conversations(p_workspace_id, v_session.id);
      RETURN app_private.visitor_profile_json(v_contact);
    END IF;
  END IF;

  UPDATE public.contacts c
  SET
    name = CASE WHEN v_has_name THEN v_name ELSE c.name END,
    email = CASE WHEN v_has_email THEN v_email ELSE c.email END,
    phone = CASE WHEN v_has_phone THEN v_phone ELSE c.phone END,
    phone_e164 = CASE WHEN v_has_phone_e164 THEN v_phone_e164 ELSE c.phone_e164 END,
    custom_attributes_json = CASE
      WHEN p_attributes IS NULL THEN c.custom_attributes_json
      ELSE app_private.merge_visitor_attributes(c.custom_attributes_json, p_attributes)
    END,
    last_seen_at = now(),
    updated_at = now()
  WHERE c.id = v_contact.id
    AND c.workspace_id = p_workspace_id
  RETURNING * INTO v_contact;

  UPDATE public.visitor_sessions vs
  SET last_seen_at = now(), updated_at = now()
  WHERE vs.id = v_session.id;

  UPDATE public.conversations c
  SET
    contact_id = COALESCE(c.contact_id, v_contact.id),
    updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = v_session.id
    AND c.status IN ('open', 'pending');

  RETURN app_private.visitor_profile_json(v_contact);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Email already belongs to another visitor in this workspace';
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_identify_visitor(
  p_workspace_id uuid,
  p_session_token text,
  p_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_phone_e164 text DEFAULT NULL,
  p_attributes jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_identify_visitor(
    p_workspace_id,
    p_session_token,
    p_name,
    p_email,
    p_phone,
    p_phone_e164,
    p_attributes
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- widget_record_page_view
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_record_page_view(
  p_workspace_id uuid,
  p_session_token text,
  p_url text,
  p_title text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_url text;
  v_title text;
  v_referrer text;
  v_utm_source text;
  v_utm_medium text;
  v_utm_campaign text;
  v_utm_content text;
  v_utm_term text;
  v_latest_created_at timestamptz;
  v_deduped boolean := false;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  v_url := app_private.bounded_text(p_url, 2048);
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'url is required';
  END IF;

  v_title := app_private.bounded_text(p_title, 500);
  v_referrer := app_private.bounded_text(p_referrer, 2048);
  v_utm_source := app_private.bounded_text(p_utm_source, 200);
  v_utm_medium := app_private.bounded_text(p_utm_medium, 200);
  v_utm_campaign := app_private.bounded_text(p_utm_campaign, 200);
  v_utm_content := app_private.bounded_text(p_utm_content, 200);
  v_utm_term := app_private.bounded_text(p_utm_term, 200);

  SELECT pv.created_at
  INTO v_latest_created_at
  FROM public.visitor_page_views pv
  WHERE pv.visitor_session_id = v_session.id
    AND pv.workspace_id = p_workspace_id
    AND pv.url = v_url
  ORDER BY pv.created_at DESC
  LIMIT 1;

  IF v_latest_created_at IS NOT NULL
     AND v_latest_created_at > now() - interval '30 seconds' THEN
    v_deduped := true;
  ELSE
    INSERT INTO public.visitor_page_views (
      workspace_id,
      visitor_session_id,
      contact_id,
      url,
      title,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      created_at
    )
    VALUES (
      p_workspace_id,
      v_session.id,
      v_session.contact_id,
      v_url,
      v_title,
      v_referrer,
      v_utm_source,
      v_utm_medium,
      v_utm_campaign,
      v_utm_content,
      v_utm_term,
      now()
    );
  END IF;

  UPDATE public.visitor_sessions vs
  SET
    current_url = v_url,
    current_title = COALESCE(v_title, vs.current_title),
    referrer = COALESCE(v_referrer, vs.referrer),
    utm_source = COALESCE(v_utm_source, vs.utm_source),
    utm_medium = COALESCE(v_utm_medium, vs.utm_medium),
    utm_campaign = COALESCE(v_utm_campaign, vs.utm_campaign),
    utm_content = COALESCE(v_utm_content, vs.utm_content),
    utm_term = COALESCE(v_utm_term, vs.utm_term),
    last_seen_at = now(),
    expires_at = now() + interval '30 days',
    updated_at = now()
  WHERE vs.id = v_session.id
  RETURNING * INTO v_session;

  IF v_session.contact_id IS NOT NULL THEN
    UPDATE public.contacts c
    SET last_seen_at = now(), updated_at = now()
    WHERE c.id = v_session.contact_id
      AND c.workspace_id = p_workspace_id;
  END IF;

  PERFORM app_private.touch_session_open_conversations(p_workspace_id, v_session.id);

  RETURN jsonb_build_object(
    'recorded', NOT v_deduped,
    'deduped', v_deduped,
    'current_url', v_session.current_url,
    'current_title', v_session.current_title
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_record_page_view(
  p_workspace_id uuid,
  p_session_token text,
  p_url text,
  p_title text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_utm_term text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_record_page_view(
    p_workspace_id,
    p_session_token,
    p_url,
    p_title,
    p_referrer,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    p_utm_content,
    p_utm_term
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- update_visitor_profile (operator)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.update_visitor_profile(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation public.conversations;
  v_session public.visitor_sessions;
  v_contact public.contacts;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_e164 text;
  v_has_name boolean := false;
  v_has_email boolean := false;
  v_has_phone boolean := false;
  v_has_phone_e164 boolean := false;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object';
  END IF;

  IF NOT (
    p_patch ? 'name'
    OR p_patch ? 'email'
    OR p_patch ? 'phone'
    OR p_patch ? 'phone_e164'
  ) THEN
    RAISE EXCEPTION 'At least one field is required';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF v_conversation.contact_id IS NULL THEN
    SELECT *
    INTO v_session
    FROM public.visitor_sessions vs
    WHERE vs.id = v_conversation.visitor_session_id
      AND vs.workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Visitor session not found';
    END IF;

    IF v_session.contact_id IS NOT NULL THEN
      SELECT *
      INTO v_contact
      FROM public.contacts c
      WHERE c.id = v_session.contact_id
        AND c.workspace_id = p_workspace_id
      FOR UPDATE;
    END IF;

    IF v_contact IS NULL THEN
      v_contact := app_private.ensure_visitor_contact(p_workspace_id, NULL, false);
      UPDATE public.visitor_sessions vs
      SET contact_id = v_contact.id, updated_at = now()
      WHERE vs.id = v_session.id;
    END IF;

    UPDATE public.conversations c
    SET contact_id = v_contact.id, updated_at = now()
    WHERE c.id = v_conversation.id
    RETURNING * INTO v_conversation;
  ELSE
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = v_conversation.contact_id
      AND c.workspace_id = p_workspace_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contact not found';
    END IF;
  END IF;

  IF p_patch ? 'name' THEN
    v_has_name := true;
    IF p_patch -> 'name' = 'null'::jsonb THEN
      v_name := NULL;
    ELSE
      v_name := app_private.bounded_text(p_patch ->> 'name', 120);
    END IF;
  END IF;

  IF p_patch ? 'email' THEN
    v_has_email := true;
    IF p_patch -> 'email' = 'null'::jsonb THEN
      v_email := NULL;
    ELSE
      v_email := NULLIF(btrim(p_patch ->> 'email'), '');
      IF v_email IS NOT NULL THEN
        IF char_length(v_email) > 254 THEN
          RAISE EXCEPTION 'Email is too long';
        END IF;
        IF lower(v_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
          RAISE EXCEPTION 'Invalid email format';
        END IF;
        v_email := split_part(btrim(p_patch ->> 'email'), '@', 1)
          || '@'
          || lower(split_part(btrim(p_patch ->> 'email'), '@', 2));
      END IF;
    END IF;
  END IF;

  IF p_patch ? 'phone' THEN
    v_has_phone := true;
    IF p_patch -> 'phone' = 'null'::jsonb THEN
      v_phone := NULL;
    ELSE
      v_phone := app_private.bounded_text(p_patch ->> 'phone', 64);
    END IF;
  END IF;

  IF p_patch ? 'phone_e164' THEN
    v_has_phone_e164 := true;
    IF p_patch -> 'phone_e164' = 'null'::jsonb THEN
      v_phone_e164 := NULL;
    ELSE
      v_phone_e164 := NULLIF(btrim(p_patch ->> 'phone_e164'), '');
      IF v_phone_e164 IS NOT NULL
         AND (char_length(v_phone_e164) > 20 OR v_phone_e164 !~ '^\+?[0-9]+$') THEN
        RAISE EXCEPTION 'Invalid phone_e164';
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.contacts c
    SET
      name = CASE WHEN v_has_name THEN v_name ELSE c.name END,
      email = CASE WHEN v_has_email THEN v_email ELSE c.email END,
      phone = CASE WHEN v_has_phone THEN v_phone ELSE c.phone END,
      phone_e164 = CASE WHEN v_has_phone_e164 THEN v_phone_e164 ELSE c.phone_e164 END,
      last_seen_at = now(),
      updated_at = now()
    WHERE c.id = v_contact.id
      AND c.workspace_id = p_workspace_id
    RETURNING * INTO v_contact;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Email already belongs to another visitor in this workspace';
  END;

  UPDATE public.conversations c
  SET updated_at = now()
  WHERE c.id = v_conversation.id
    AND c.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'id', v_contact.id,
    'public_id', v_contact.public_id,
    'name', v_contact.name,
    'email', v_contact.email,
    'phone', v_contact.phone,
    'phone_e164', v_contact.phone_e164,
    'attributes', COALESCE(v_contact.custom_attributes_json, '{}'::jsonb),
    'first_seen_at', v_contact.first_seen_at,
    'last_seen_at', v_contact.last_seen_at,
    'visit_count', v_contact.visit_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_visitor_profile(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_visitor_profile(
    p_workspace_id,
    p_conversation_id,
    p_patch
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- REPLACE build_conversation_detail with visitor profile/context/activity
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.build_conversation_detail(
  p_conversation public.conversations,
  p_member_id uuid,
  p_last_read_sequence bigint,
  p_stored_unread_count integer DEFAULT NULL,
  p_has_read_row boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_contact_json jsonb;
  v_assigned jsonb;
  v_unread integer;
  v_visitor_read bigint;
  v_visitor_delivered bigint;
  v_agent_read bigint;
  v_agent_delivered bigint;
  v_session public.visitor_sessions;
  v_visitor jsonb;
  v_visitor_context jsonb;
  v_visitor_activity jsonb;
  v_page_views jsonb;
  v_first_seen timestamptz;
  v_last_seen timestamptz;
  v_visit_count integer;
BEGIN
  IF p_conversation.contact_id IS NOT NULL THEN
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = p_conversation.contact_id;

    IF FOUND THEN
      v_contact_json := jsonb_build_object(
        'id', v_contact.id,
        'public_id', v_contact.public_id,
        'name', v_contact.name,
        'email', v_contact.email,
        'phone', v_contact.phone
      );
      v_visitor := jsonb_build_object(
        'public_id', v_contact.public_id,
        'name', v_contact.name,
        'email', v_contact.email,
        'phone', v_contact.phone,
        'attributes', COALESCE(v_contact.custom_attributes_json, '{}'::jsonb),
        'first_seen_at', v_contact.first_seen_at,
        'last_seen_at', v_contact.last_seen_at,
        'visit_count', v_contact.visit_count
      );
      v_first_seen := v_contact.first_seen_at;
      v_last_seen := v_contact.last_seen_at;
      v_visit_count := v_contact.visit_count;
    ELSE
      v_contact_json := NULL;
      v_visitor := NULL;
    END IF;
  ELSE
    v_contact_json := NULL;
    v_visitor := NULL;
  END IF;

  IF p_conversation.assigned_to IS NOT NULL THEN
    v_assigned := jsonb_build_object(
      'member_id', p_conversation.assigned_to,
      'display_label', app_private.member_display_label(p_conversation.assigned_to)
    );
  ELSE
    v_assigned := NULL;
  END IF;

  v_unread := app_private.conversation_unread_count(
    p_conversation.id,
    p_member_id,
    p_last_read_sequence,
    p_stored_unread_count,
    p_has_read_row,
    p_conversation.visitor_message_count
  );

  SELECT v.last_read_sequence, v.last_delivered_sequence
  INTO v_visitor_read, v_visitor_delivered
  FROM app_private.visitor_receipt_cursors(p_conversation.id) v;

  SELECT a.last_read_sequence, a.last_delivered_sequence
  INTO v_agent_read, v_agent_delivered
  FROM app_private.agent_receipt_cursors(p_conversation.id) a;

  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = p_conversation.visitor_session_id;

  IF FOUND THEN
    v_visitor_context := jsonb_build_object(
      'current_url', v_session.current_url,
      'current_title', v_session.current_title,
      'landing_url', v_session.landing_url,
      'referrer', v_session.referrer,
      'utm_source', v_session.utm_source,
      'utm_medium', v_session.utm_medium,
      'utm_campaign', v_session.utm_campaign,
      'utm_content', v_session.utm_content,
      'utm_term', v_session.utm_term,
      'browser_family', v_session.browser_family,
      'browser_version', v_session.browser_version,
      'os_family', v_session.os_family,
      'device_type', v_session.device_type,
      'locale', v_session.locale,
      'timezone', v_session.timezone,
      'language', v_session.language,
      'country_code', v_session.country_code
    );

    IF v_first_seen IS NULL THEN
      v_first_seen := v_session.created_at;
      v_last_seen := v_session.last_seen_at;
      v_visit_count := 1;
    END IF;
  ELSE
    v_visitor_context := NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pv.id,
        'url', pv.url,
        'title', pv.title,
        'referrer', pv.referrer,
        'utm_source', pv.utm_source,
        'utm_medium', pv.utm_medium,
        'utm_campaign', pv.utm_campaign,
        'created_at', pv.created_at
      )
      ORDER BY pv.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_page_views
  FROM (
    SELECT
      p.id,
      p.url,
      p.title,
      p.referrer,
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      p.created_at
    FROM public.visitor_page_views p
    WHERE p.workspace_id = p_conversation.workspace_id
      AND (
        (
          p_conversation.contact_id IS NOT NULL
          AND p.contact_id = p_conversation.contact_id
        )
        OR (
          p_conversation.contact_id IS NULL
          AND p.visitor_session_id = p_conversation.visitor_session_id
        )
      )
    ORDER BY p.created_at DESC
    LIMIT 20
  ) pv;

  IF v_first_seen IS NOT NULL THEN
    v_visitor_activity := jsonb_build_object(
      'first_seen_at', v_first_seen,
      'last_seen_at', COALESCE(v_last_seen, v_first_seen),
      'visit_count', COALESCE(v_visit_count, 1),
      'recent_page_views', COALESCE(v_page_views, '[]'::jsonb)
    );
  ELSE
    v_visitor_activity := NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact_json,
    'visitor_session_id', p_conversation.visitor_session_id,
    'visitor_realtime_topic',
      'widget-conversation:' || p_conversation.visitor_realtime_topic_key,
    'visitor_ephemeral_topic',
      'widget-ephemeral:' || p_conversation.visitor_realtime_topic_key,
    'source_url', p_conversation.source_url,
    'referrer', p_conversation.referrer,
    'visitor', v_visitor,
    'visitor_context', v_visitor_context,
    'visitor_activity', v_visitor_activity,
    'message_count', p_conversation.message_count,
    'last_message_at', p_conversation.last_message_at,
    'has_unread', v_unread > 0,
    'unread_count', v_unread,
    'member_last_read_sequence', COALESCE(p_last_read_sequence, 0),
    'visitor_last_read_sequence', COALESCE(v_visitor_read, 0),
    'visitor_last_delivered_sequence', COALESCE(v_visitor_delivered, 0),
    'agent_last_read_sequence', COALESCE(v_agent_read, 0),
    'agent_last_delivered_sequence', COALESCE(v_agent_delivered, 0),
    'created_at', p_conversation.created_at,
    'resolved_at', p_conversation.resolved_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.widget_identify_visitor(
  uuid, text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_identify_visitor(
  uuid, text, text, text, text, text, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_identify_visitor(
  uuid, text, text, text, text, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) TO authenticated;
