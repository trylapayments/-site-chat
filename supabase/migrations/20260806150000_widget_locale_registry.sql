-- Expand widget locale validation to the full LiveChat-aligned canonical set (48).
-- Source: https://www.livechat.com/help/how-to-modify-chat-window-language/
-- Verified: 2026-08-06 (article updated 2024-12-05).
-- Invalid remains public branding/config only (no secrets). Invalid `en`/`ru` keep working.

CREATE OR REPLACE FUNCTION app_private.is_supported_widget_locale(p_locale text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_locale IN (
    'ar', 'hy', 'az', 'bg', 'ca', 'zh-CN', 'zh-TW', 'hr', 'cs', 'da',
    'nl', 'en', 'et', 'fa', 'fi', 'fr', 'ka', 'de', 'el', 'he',
    'hi', 'hu', 'is', 'id', 'it', 'ja', 'kk', 'ko', 'lv', 'lt',
    'mg', 'ms', 'nb', 'nn', 'pl', 'pt-PT', 'pt-BR', 'ro', 'ru', 'sr',
    'sk', 'sl', 'es', 'sv', 'th', 'tr', 'uk', 'vi'
  );
$$;

COMMENT ON FUNCTION app_private.is_supported_widget_locale(text) IS
  'True when p_locale is a canonical Site Chat widget UI locale (48 LiveChat-aligned codes).';

CREATE OR REPLACE FUNCTION app_private.normalize_widget_locale(p_locale text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF p_locale IS NULL OR length(trim(p_locale)) = 0 THEN
    RETURN 'en';
  END IF;

  IF app_private.is_supported_widget_locale(p_locale) THEN
    RETURN p_locale;
  END IF;

  RETURN 'en';
END;
$$;

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
  v_locale := app_private.normalize_widget_locale(COALESCE(v_widget ->> 'locale', 'en'));

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
  v_locale := app_private.normalize_widget_locale(p_locale);

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
