-- Visitor identity security hardening (PR #26 follow-up).
--
-- Fixes on top of 20260810160000_visitor_identity_context.sql:
-- - CRITICAL: revoke EXECUTE on app_private from PUBLIC/anon/authenticated
-- - CRITICAL: durable public_id DEFAULT (vis_ + 32 hex)
-- - HIGH: remove email merge from widget_identify_visitor (no contact reassignment)
-- - HIGH: public_id is NOT authorization — continuity_token (hashed) binds sessions
-- - HIGH: SQL-side URL privacy redaction (http(s), path + allowlisted UTM only)
-- - HIGH: update_visitor_profile return contract + lock order + no last_seen bump
-- - MED: stop touching conversations on every page view (identify still touches)
-- - Add tab_id / active_tab_* for multi-tab page-view semantics
--
-- Privacy notes (unchanged intent):
-- - No raw IP address is stored on visitor_sessions or related tables.
-- - country_code remains reserved for trusted platform headers only.
-- - Widget identify is unsigned (host-supplied claims); treat as unverified PII
--   until a verified identify path exists. Continuity token is the cross-session
--   binder; public_id is a display/correlation id only.

-- ---------------------------------------------------------------------------
-- CRITICAL-2: public_id DEFAULT
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts
  ALTER COLUMN public_id SET DEFAULT (
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex')
  );

COMMENT ON COLUMN public.contacts.public_id IS
  'Opaque visitor public id: vis_ + 32 lowercase hex. Client-facing correlation id only — '
  'NOT an authorization secret. Cross-session continuity uses continuity_token_hash.';

-- ---------------------------------------------------------------------------
-- HIGH-2: continuity_token_hash (authorization / continuity binder)
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS continuity_token_hash text;

COMMENT ON COLUMN public.contacts.continuity_token_hash IS
  'SHA-256 hex of opaque continuity token. Plaintext is returned once when minted; '
  'never store plaintext. Used to bind a new browser session to an existing contact. '
  'Invalid/unknown tokens are ignored (no enumeration). public_id must never be used '
  'for this binding.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_contacts_continuity_token_hash'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_continuity_token_hash
      CHECK (
        continuity_token_hash IS NULL
        OR continuity_token_hash ~ '^[a-f0-9]{64}$'
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_workspace_continuity_token_hash
  ON public.contacts (workspace_id, continuity_token_hash)
  WHERE continuity_token_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Multi-tab: visitor_page_views.tab_id + visitor_sessions.active_tab_*
-- ---------------------------------------------------------------------------

ALTER TABLE public.visitor_page_views
  ADD COLUMN IF NOT EXISTS tab_id text;

ALTER TABLE public.visitor_sessions
  ADD COLUMN IF NOT EXISTS active_tab_id text,
  ADD COLUMN IF NOT EXISTS active_tab_seen_at timestamptz;

COMMENT ON COLUMN public.visitor_page_views.tab_id IS
  'Optional client tab identifier (max 64). Distinguishes concurrent tabs in one session.';

COMMENT ON COLUMN public.visitor_sessions.active_tab_id IS
  'Most recently reported tab_id from page-view RPC. '
  'visitor_context.current_url reflects this most recently reported tab, not a locked primary tab.';

COMMENT ON COLUMN public.visitor_sessions.active_tab_seen_at IS
  'Timestamp when active_tab_id was last reported via page-view.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_page_views_tab_id_len'
      AND conrelid = 'public.visitor_page_views'::regclass
  ) THEN
    ALTER TABLE public.visitor_page_views
      ADD CONSTRAINT chk_visitor_page_views_tab_id_len
      CHECK (tab_id IS NULL OR char_length(tab_id) BETWEEN 1 AND 64);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_visitor_sessions_active_tab_id_len'
      AND conrelid = 'public.visitor_sessions'::regclass
  ) THEN
    ALTER TABLE public.visitor_sessions
      ADD CONSTRAINT chk_visitor_sessions_active_tab_id_len
      CHECK (active_tab_id IS NULL OR char_length(active_tab_id) BETWEEN 1 AND 64);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- HIGH-3: URL privacy sanitizer (SQL defense in depth)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.sanitize_page_url(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_raw text;
  v_scheme text;
  v_rest text;
  v_authority text;
  v_path_and_query text;
  v_path text;
  v_query text;
  v_hostport text;
  v_origin text;
  v_pair text;
  v_key text;
  v_value text;
  v_utm_parts text[] := ARRAY[]::text[];
  v_allowed text[] := ARRAY[
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term'
  ];
  v_result text;
  v_slash_pos integer;
  v_q_pos integer;
  v_eq_pos integer;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Strip ASCII controls (defense in depth; app layer also strips).
  v_raw := btrim(regexp_replace(p_raw, E'[\\x00-\\x1F\\x7F]', '', 'g'));
  IF v_raw IS NULL OR length(v_raw) = 0 THEN
    RETURN NULL;
  END IF;

  IF lower(v_raw) ~ '^(javascript|data|vbscript):' THEN
    RETURN NULL;
  END IF;

  -- Strip fragment before parsing.
  v_raw := split_part(v_raw, '#', 1);

  IF v_raw !~* '^https?://' THEN
    RETURN NULL;
  END IF;

  v_scheme := lower(split_part(v_raw, '://', 1));
  IF v_scheme NOT IN ('http', 'https') THEN
    RETURN NULL;
  END IF;

  v_rest := substr(v_raw, length(v_scheme) + 4);
  IF v_rest IS NULL OR length(v_rest) = 0 THEN
    RETURN NULL;
  END IF;

  v_slash_pos := position('/' IN v_rest);
  v_q_pos := position('?' IN v_rest);

  IF v_slash_pos > 0 AND (v_q_pos = 0 OR v_slash_pos < v_q_pos) THEN
    v_authority := substr(v_rest, 1, v_slash_pos - 1);
    v_path_and_query := substr(v_rest, v_slash_pos);
  ELSIF v_q_pos > 0 THEN
    v_authority := substr(v_rest, 1, v_q_pos - 1);
    v_path_and_query := '/' || substr(v_rest, v_q_pos);
  ELSE
    v_authority := v_rest;
    v_path_and_query := '/';
  END IF;

  IF v_authority IS NULL OR length(v_authority) = 0 THEN
    RETURN NULL;
  END IF;

  -- Strip userinfo (user:pass@host).
  IF position('@' IN v_authority) > 0 THEN
    v_authority := substr(v_authority, position('@' IN v_authority) + 1);
  END IF;

  IF v_authority IS NULL OR length(v_authority) = 0 THEN
    RETURN NULL;
  END IF;

  -- Reject empty host / malformed authority.
  v_hostport := lower(v_authority);
  IF v_hostport = '' OR v_hostport = ':' OR v_hostport ~ '\s' THEN
    RETURN NULL;
  END IF;

  v_origin := v_scheme || '://' || v_authority;

  v_q_pos := position('?' IN v_path_and_query);
  IF v_q_pos > 0 THEN
    v_path := substr(v_path_and_query, 1, v_q_pos - 1);
    v_query := substr(v_path_and_query, v_q_pos + 1);
  ELSE
    v_path := v_path_and_query;
    v_query := NULL;
  END IF;

  IF v_path IS NULL OR length(v_path) = 0 THEN
    v_path := '/';
  END IF;

  -- Keep only allowlisted UTM query params (first occurrence wins; values bounded).
  IF v_query IS NOT NULL AND length(v_query) > 0 THEN
    FOREACH v_pair IN ARRAY string_to_array(v_query, '&')
    LOOP
      IF v_pair IS NULL OR length(v_pair) = 0 THEN
        CONTINUE;
      END IF;

      v_eq_pos := position('=' IN v_pair);
      IF v_eq_pos > 0 THEN
        v_key := lower(substr(v_pair, 1, v_eq_pos - 1));
        v_value := substr(v_pair, v_eq_pos + 1);
      ELSE
        v_key := lower(v_pair);
        v_value := '';
      END IF;

      -- Basic percent-decoding is intentionally skipped; store as presented after allowlist.
      v_value := btrim(regexp_replace(v_value, E'[\\x00-\\x1F\\x7F]', '', 'g'));
      IF length(v_value) = 0 THEN
        CONTINUE;
      END IF;
      IF length(v_value) > 200 THEN
        v_value := left(v_value, 200);
      END IF;

      IF v_key = ANY (v_allowed)
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(v_utm_parts) AS existing(p)
           WHERE split_part(existing.p, '=', 1) = v_key
         )
      THEN
        v_utm_parts := array_append(v_utm_parts, v_key || '=' || v_value);
      END IF;
    END LOOP;
  END IF;

  IF coalesce(array_length(v_utm_parts, 1), 0) > 0 THEN
    v_result := v_origin || v_path || '?' || array_to_string(v_utm_parts, '&');
  ELSE
    v_result := v_origin || v_path;
  END IF;

  IF length(v_result) > 2048 THEN
    v_result := left(v_result, 2048);
  END IF;

  -- Re-validate after truncation (avoid returning a broken URL stump).
  IF v_result !~* '^https?://[^/#?]+' THEN
    RETURN NULL;
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION app_private.sanitize_page_url(text) IS
  'Privacy-safe URL redaction for visitor context storage. Keeps http(s) origin + pathname '
  '+ allowlisted UTM query params only. Strips userinfo, fragment, and all other query keys. '
  'Rejects javascript:/data:/vbscript: and non-http(s). Bound length 2048. Returns null if invalid. '
  'Apply to current_url, landing_url, referrer, initial_url, and page_views.url/referrer.';

-- ---------------------------------------------------------------------------
-- Continuity token helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.generate_continuity_token()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT replace(
    replace(
      replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'),
      '/',
      '_'
    ),
    '=',
    ''
  );
$$;

COMMENT ON FUNCTION app_private.generate_continuity_token() IS
  'Mint an opaque continuity token (32+ bytes, base64url). Return plaintext to the client '
  'once; store only SHA-256 hex on contacts.continuity_token_hash.';

CREATE OR REPLACE FUNCTION app_private.hash_continuity_token(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

COMMENT ON FUNCTION app_private.hash_continuity_token(text) IS
  'SHA-256 hex digest of a continuity token plaintext (UTF-8).';

CREATE OR REPLACE FUNCTION app_private.mint_contact_continuity_token(p_contact_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_token text;
  v_hash text;
BEGIN
  -- Serialize mint per contact so concurrent resumes cannot leave a client without plaintext.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_contact_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = p_contact_id
      AND c.continuity_token_hash IS NOT NULL
  ) THEN
    RETURN NULL;
  END IF;

  v_token := app_private.generate_continuity_token();
  v_hash := app_private.hash_continuity_token(v_token);

  UPDATE public.contacts c
  SET
    continuity_token_hash = v_hash,
    updated_at = now()
  WHERE c.id = p_contact_id
    AND c.continuity_token_hash IS NULL;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION app_private.mint_contact_continuity_token(uuid) IS
  'Mint and persist continuity_token_hash when missing. Returns plaintext once, else null. '
  'Does not rotate an existing hash (client keeps localStorage token). Uses a transaction '
  'advisory lock so concurrent mint attempts do not strand a client without plaintext.';
-- ---------------------------------------------------------------------------
-- visitor_profile_json: match visitorProfileSchema (no phone_e164)
-- ---------------------------------------------------------------------------

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
    'attributes', COALESCE(p_contact.custom_attributes_json, '{}'::jsonb),
    'first_seen_at', p_contact.first_seen_at,
    'last_seen_at', p_contact.last_seen_at,
    'visit_count', p_contact.visit_count
  );
$$;

COMMENT ON FUNCTION app_private.visitor_profile_json(public.contacts) IS
  'Visitor profile JSON matching visitorProfileSchema: public_id, name, email, phone, '
  'attributes, first_seen_at, last_seen_at, visit_count. Does not include phone_e164.';

-- ---------------------------------------------------------------------------
-- ensure_visitor_contact: always create (no public_id binding)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_private.ensure_visitor_contact(uuid, text, boolean);

CREATE OR REPLACE FUNCTION app_private.ensure_visitor_contact(
  p_workspace_id uuid,
  p_bump_visit_count boolean DEFAULT false
)
RETURNS public.contacts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
BEGIN
  -- Always create a new anonymous contact. Cross-session reuse is ONLY via
  -- continuity token resolution in widget_create_or_resume_visitor_session.
  -- p_bump_visit_count is retained for call-site compatibility but unused:
  -- visit_count bumps happen when linking via continuity in the session RPC.
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

  -- p_bump_visit_count intentionally unused: visit bumps happen only when linking
  -- via continuity token in widget_create_or_resume_visitor_session.
  IF p_bump_visit_count THEN
    NULL;
  END IF;

  RETURN v_contact;
END;
$$;

COMMENT ON FUNCTION app_private.ensure_visitor_contact(uuid, boolean) IS
  'Always creates a new anonymous workspace visitor contact. Does NOT bind by public_id. '
  'Continuity linking (and visit_count bump) is handled only in session create/resume RPC.';

-- ---------------------------------------------------------------------------
-- DROP obsolete session create overloads (5-arg + 19-arg with public_id)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text
);
DROP FUNCTION IF EXISTS app_private.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text
);

DROP FUNCTION IF EXISTS public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS app_private.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
);

-- ---------------------------------------------------------------------------
-- HIGH-2: widget_create_or_resume_visitor_session (continuity_token, not public_id)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_continuity_token text DEFAULT NULL,
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
  v_continuity_in text;
  v_continuity_hash text;
  v_continuity_out text := NULL;
  v_linked_by_continuity boolean := false;
BEGIN
  v_locale := app_private.normalize_widget_locale(p_locale);
  v_page_url := app_private.sanitize_page_url(p_page_url);
  v_page_title := app_private.bounded_text(p_page_title, 500);
  v_referrer := app_private.sanitize_page_url(p_referrer);
  v_landing_url := COALESCE(
    app_private.sanitize_page_url(p_landing_url),
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

  v_continuity_in := NULLIF(btrim(COALESCE(p_continuity_token, '')), '');

  IF p_session_token IS NOT NULL AND length(btrim(p_session_token)) > 0 THEN
    BEGIN
      v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

      -- Lock order: session then contact.
      SELECT *
      INTO v_session
      FROM public.visitor_sessions vs
      WHERE vs.id = v_session.id
        AND vs.workspace_id = p_workspace_id
      FOR UPDATE;

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
        v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
        UPDATE public.visitor_sessions vs
        SET contact_id = v_contact.id, updated_at = now()
        WHERE vs.id = v_session.id
        RETURNING * INTO v_session;

        v_continuity_out := app_private.mint_contact_continuity_token(v_contact.id);
        SELECT * INTO v_contact FROM public.contacts c WHERE c.id = v_contact.id;
      ELSE
        SELECT *
        INTO v_contact
        FROM public.contacts c
        WHERE c.id = v_session.contact_id
          AND c.workspace_id = p_workspace_id
        FOR UPDATE;

        IF NOT FOUND THEN
          v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
          UPDATE public.visitor_sessions vs
          SET contact_id = v_contact.id, updated_at = now()
          WHERE vs.id = v_session.id
          RETURNING * INTO v_session;
          v_continuity_out := app_private.mint_contact_continuity_token(v_contact.id);
          SELECT * INTO v_contact FROM public.contacts c WHERE c.id = v_contact.id;
        ELSE
          UPDATE public.contacts c
          SET last_seen_at = now(), updated_at = now()
          WHERE c.id = v_contact.id
          RETURNING * INTO v_contact;

          IF v_contact.continuity_token_hash IS NULL THEN
            v_continuity_out := app_private.mint_contact_continuity_token(v_contact.id);
            SELECT * INTO v_contact FROM public.contacts c WHERE c.id = v_contact.id;
          ELSE
            -- Hash already set: client keeps localStorage token; do not re-emit plaintext.
            v_continuity_out := NULL;
          END IF;
        END IF;
      END IF;

      v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

      RETURN jsonb_build_object(
        'session_token', p_session_token,
        'expires_at', v_session.expires_at,
        'locale', v_session.locale,
        'has_conversation', v_conversation.id IS NOT NULL,
        'conversation_status', v_conversation.status,
        'visitor_public_id', v_contact.public_id,
        'continuity_token', v_continuity_out
      );
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END IF;

  -- New session: bind by continuity token hash when valid; else create contact.
  -- NEVER bind by public_id. Invalid/unknown continuity tokens are ignored (no enumeration).
  IF v_continuity_in IS NOT NULL THEN
    v_continuity_hash := app_private.hash_continuity_token(v_continuity_in);

    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.continuity_token_hash = v_continuity_hash
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.contacts c
      SET
        visit_count = c.visit_count + 1,
        last_seen_at = now(),
        updated_at = now()
      WHERE c.id = v_contact.id
      RETURNING * INTO v_contact;

      v_linked_by_continuity := true;
      -- Client already holds the plaintext token.
      v_continuity_out := NULL;
    END IF;
  END IF;

  IF NOT v_linked_by_continuity THEN
    v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
    v_continuity_out := app_private.mint_contact_continuity_token(v_contact.id);
    SELECT * INTO v_contact FROM public.contacts c WHERE c.id = v_contact.id;
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
    'visitor_public_id', v_contact.public_id,
    'continuity_token', v_continuity_out
  );
END;
$$;

COMMENT ON FUNCTION app_private.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'Create or resume a visitor session. Continuity across browsers uses p_continuity_token '
  '(hashed at rest). public_id is returned for display/correlation only and is never used '
  'for authorization. URLs are sanitized (http(s) + path + UTM allowlist). No raw IP stored.';

CREATE OR REPLACE FUNCTION public.widget_create_or_resume_visitor_session(
  p_workspace_id uuid,
  p_session_token text DEFAULT NULL,
  p_locale text DEFAULT 'en',
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_continuity_token text DEFAULT NULL,
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
    p_continuity_token,
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

COMMENT ON FUNCTION public.widget_create_or_resume_visitor_session(
  uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text
) IS
  'Public wrapper (service_role only). See app_private.widget_create_or_resume_visitor_session.';

-- ---------------------------------------------------------------------------
-- HIGH-1: widget_identify_visitor — no email merge
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
  v_name text;
  v_email text;
  v_phone text;
  v_phone_e164 text;
  v_has_name boolean := false;
  v_has_email boolean := false;
  v_has_phone boolean := false;
  v_has_phone_e164 boolean := false;
BEGIN
  -- Unsigned identify: host/widget-supplied claims are unverified PII until a
  -- verified identify path exists. Never merge contacts by email.
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  -- Lock order: session then contact.
  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = v_session.id
    AND vs.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session invalid or expired';
  END IF;

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
    v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
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
      v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
      UPDATE public.visitor_sessions vs
      SET contact_id = v_contact.id, updated_at = now(), last_seen_at = now()
      WHERE vs.id = v_session.id
      RETURNING * INTO v_session;
    END IF;
  END IF;

  -- Update ONLY this session's current contact. Never SELECT/reassign by email.
  BEGIN
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
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'Email already belongs to another visitor in this workspace';
  END;

  UPDATE public.visitor_sessions vs
  SET last_seen_at = now(), updated_at = now()
  WHERE vs.id = v_session.id;

  -- Ensure open/pending conversations on this session carry contact_id + CDC bump.
  UPDATE public.conversations c
  SET
    contact_id = COALESCE(c.contact_id, v_contact.id),
    updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = v_session.id
    AND c.status IN ('open', 'pending');

  RETURN app_private.visitor_profile_json(v_contact);
END;
$$;

COMMENT ON FUNCTION app_private.widget_identify_visitor(
  uuid, text, text, text, text, text, jsonb
) IS
  'Unsigned widget/host identify: patches the session contact only. Does NOT merge contacts '
  'by email or reassign session/conversation contact_id based on email. Unique email conflicts '
  'raise a clear exception. Bumps contact.last_seen_at (visitor activity). Touches open/pending '
  'conversations on this session for CDC. Returns visitorProfileSchema JSON (no phone_e164).';

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
-- widget_record_page_view: sanitize URLs, tab_id, no conversation touch
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text
);
DROP FUNCTION IF EXISTS app_private.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text
);

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
  p_utm_term text DEFAULT NULL,
  p_tab_id text DEFAULT NULL
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
  v_tab_id text;
  v_latest_created_at timestamptz;
  v_deduped boolean := false;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  v_url := app_private.sanitize_page_url(p_url);
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'url is required';
  END IF;

  v_title := app_private.bounded_text(p_title, 500);
  v_referrer := app_private.sanitize_page_url(p_referrer);
  v_utm_source := app_private.bounded_text(p_utm_source, 200);
  v_utm_medium := app_private.bounded_text(p_utm_medium, 200);
  v_utm_campaign := app_private.bounded_text(p_utm_campaign, 200);
  v_utm_content := app_private.bounded_text(p_utm_content, 200);
  v_utm_term := app_private.bounded_text(p_utm_term, 200);
  v_tab_id := app_private.bounded_text(p_tab_id, 64);

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
      tab_id,
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
      v_tab_id,
      now()
    );
  END IF;

  -- Update session current_* / last_seen / active tab. Do NOT touch conversations
  -- here (write amplification). Operators should subscribe to visitor_sessions and
  -- contacts realtime; identify still touches open/pending conversations.
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
    active_tab_id = v_tab_id,
    active_tab_seen_at = now(),
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

  RETURN jsonb_build_object(
    'recorded', NOT v_deduped,
    'deduped', v_deduped,
    'current_url', v_session.current_url,
    'current_title', v_session.current_title
  );
END;
$$;

COMMENT ON FUNCTION app_private.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text, text
) IS
  'Record a page view with sanitized URL/referrer. Updates session + contact last_seen. '
  'Does NOT bump conversations.updated_at (listen to visitor_sessions/contacts for live URL). '
  'Optional p_tab_id sets session.active_tab_id; current_url reflects most recently reported tab.';

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
  p_utm_term text DEFAULT NULL,
  p_tab_id text DEFAULT NULL
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
    p_utm_term,
    p_tab_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- HIGH-4: update_visitor_profile — schema return, lock order, no last_seen
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

  -- Lock order: conversation FOR UPDATE first, then contact FOR UPDATE.
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
      v_contact := app_private.ensure_visitor_contact(p_workspace_id, false);
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
    IF p_patch -> 'name' = 'null'::jsonb THEN
      v_name := NULL;
    ELSE
      v_name := app_private.bounded_text(p_patch ->> 'name', 120);
    END IF;
  END IF;

  IF p_patch ? 'email' THEN
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
    IF p_patch -> 'phone' = 'null'::jsonb THEN
      v_phone := NULL;
    ELSE
      v_phone := app_private.bounded_text(p_patch ->> 'phone', 64);
    END IF;
  END IF;

  IF p_patch ? 'phone_e164' THEN
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

  -- Operator edit: field-level patches only. Do NOT bump last_seen_at.
  BEGIN
    UPDATE public.contacts c
    SET
      name = CASE WHEN p_patch ? 'name' THEN v_name ELSE c.name END,
      email = CASE WHEN p_patch ? 'email' THEN v_email ELSE c.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE c.phone END,
      phone_e164 = CASE WHEN p_patch ? 'phone_e164' THEN v_phone_e164 ELSE c.phone_e164 END,
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

  RETURN app_private.visitor_profile_json(v_contact);
END;
$$;

COMMENT ON FUNCTION app_private.update_visitor_profile(uuid, uuid, jsonb) IS
  'Operator profile patch for a conversation contact. Messaging roles only. '
  'Lock order: conversation then contact. Does not bump last_seen_at. '
  'Returns visitorProfileSchema JSON (no phone_e164, no internal id).';

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

-- Document multi-tab semantics on conversation detail current_url source.
COMMENT ON FUNCTION app_private.build_conversation_detail(
  public.conversations, uuid, bigint, integer, boolean
) IS
  'Build conversation detail JSON including visitor profile/context/activity. '
  'visitor_context.current_url comes from visitor_sessions.current_url and reflects '
  'the most recently reported tab (see active_tab_id), not a locked primary tab.';

COMMENT ON TABLE public.contacts IS
  'Workspace visitor identity. One row per known visitor (anonymous or identified). '
  'public_id (vis_…) is a client-facing correlation id only (NOT authorization). '
  'Cross-session continuity uses continuity_token_hash. Email is unique within a '
  'workspace when present; unsigned widget identify does not merge by email. '
  'No raw IP is stored on contacts or visitor_sessions.';

-- ---------------------------------------------------------------------------
-- Privileges: public wrappers
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
  uuid, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_record_page_view(
  uuid, text, text, text, text, text, text, text, text, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- CRITICAL-1: app_private EXECUTE revokes (must be LAST after all function changes)
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
