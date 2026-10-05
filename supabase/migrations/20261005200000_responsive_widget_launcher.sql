-- Rectangular and per-device launchers; retain backwards-compatible defaults.
CREATE OR REPLACE FUNCTION app_private.validate_widget_appearance(p_draft jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_allowed_keys text[] := ARRAY[
    'schemaVersion',
    'primaryColor',
    'accentColor',
    'backgroundColor',
    'textColor',
    'launcherColor',
    'launcherIcon',
    'launcherShape',
    'launcherSize',
    'launcherPosition',
    'launcherOffsetX',
    'launcherOffsetY',
    'launcherIconAssetId',
    'borderRadius',
    'shadowLevel',
    'widgetWidth',
    'widgetHeight',
    'widgetMaxHeight',
    'density',
    'headerStyle',
    'headerTitle',
    'subtitle',
    'logoAssetId',
    'agentAvatarAssetId',
    'welcomeMessage',
    'placeholderText',
    'sendButtonStyle',
    'fontFamily',
    'fontSizeScale',
    'colorMode',
    'autoOpenDelayMs',
    'hideLauncherWhenOpen',
    'showGreeting',
    'mobileBehavior',
    'showAgentAvatars',
    'showPoweredBy',
    'soundEnabled',
    'locale',
    'reopenWindowHours',
    'businessHours',
    'presetId'
  ];
  v_key text;
  v_color_key text;
  v_hours integer;
  v_offset integer;
  v_width integer;
  v_height integer;
  v_max_height integer;
  v_radius integer;
  v_delay integer;
  v_copy jsonb;
  v_bh jsonb;
  v_weekly jsonb;
  v_item jsonb;
  v_day integer;
BEGIN
  p_draft := jsonb_build_object('launcherText', 'Online chat', 'launcherWidth', 180, 'mobileLauncher', NULL) || p_draft;
  v_allowed_keys := v_allowed_keys || ARRAY['launcherText', 'launcherWidth', 'mobileLauncher'];
  IF jsonb_typeof(p_draft -> 'launcherText') <> 'string' OR length(btrim(p_draft ->> 'launcherText')) NOT BETWEEN 1 AND 40 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcher label.';
  END IF;
  IF jsonb_typeof(p_draft -> 'launcherWidth') <> 'number' OR (p_draft ->> 'launcherWidth')::numeric NOT BETWEEN 120 AND 320 OR (p_draft ->> 'launcherWidth')::numeric <> trunc((p_draft ->> 'launcherWidth')::numeric) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcher width.';
  END IF;
  IF p_draft -> 'mobileLauncher' <> 'null'::jsonb THEN
    v_item := p_draft -> 'mobileLauncher';
    IF jsonb_typeof(v_item) <> 'object' OR NOT (v_item ?& ARRAY['launcherShape','launcherSize','launcherText','launcherWidth','launcherColor','launcherPosition','launcherOffsetX','launcherOffsetY']) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: invalid mobile launcher.';
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_item) LOOP
      IF v_item -> v_key = 'null'::jsonb THEN RAISE EXCEPTION 'INVALID_APPEARANCE: null mobile field.'; END IF;
      IF v_key NOT IN ('launcherShape','launcherSize','launcherText','launcherWidth','launcherColor','launcherPosition','launcherOffsetX','launcherOffsetY') THEN RAISE EXCEPTION 'INVALID_APPEARANCE: unknown mobile launcher field.'; END IF;
    END LOOP;
    IF v_item ->> 'launcherShape' NOT IN ('circle','rounded-square','square','rectangle') OR v_item ->> 'launcherSize' NOT IN ('sm','md','lg') OR v_item ->> 'launcherPosition' NOT IN ('bottom-left','bottom-right') OR COALESCE(v_item ->> 'launcherColor','') !~ '^#[0-9A-Fa-f]{6}$' OR jsonb_typeof(v_item -> 'launcherText') <> 'string' OR length(btrim(v_item ->> 'launcherText')) NOT BETWEEN 1 AND 40 THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: invalid mobile launcher.';
    END IF;
    FOR v_key IN SELECT unnest(ARRAY['launcherWidth','launcherOffsetX','launcherOffsetY']) LOOP
      IF jsonb_typeof(v_item -> v_key) <> 'number' OR (v_item ->> v_key)::numeric <> trunc((v_item ->> v_key)::numeric) OR (v_item ->> v_key)::numeric < (CASE WHEN v_key = 'launcherWidth' THEN 120 ELSE 0 END) OR (v_item ->> v_key)::numeric > (CASE WHEN v_key = 'launcherWidth' THEN 320 ELSE 120 END) THEN
        RAISE EXCEPTION 'INVALID_APPEARANCE: invalid mobile launcher dimensions.';
      END IF;
    END LOOP;
  END IF;
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: appearance must be a JSON object.';
  END IF;

  IF jsonb_path_exists(p_draft, '$.**.customCss')
     OR jsonb_path_exists(p_draft, '$.**.customJS') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: customCss and customJS are not allowed.';
  END IF;

  -- Reject unknown top-level keys (strict contract).
  FOR v_key IN SELECT jsonb_object_keys(p_draft)
  LOOP
    IF NOT (v_key = ANY (v_allowed_keys)) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: unknown key % is not allowed.', v_key;
    END IF;
  END LOOP;

  IF NOT (p_draft ?& v_allowed_keys) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: one or more required appearance keys are missing.';
  END IF;

  IF p_draft -> 'schemaVersion' <> '1'::jsonb THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: schemaVersion must be 1.';
  END IF;

  FOREACH v_color_key IN ARRAY ARRAY[
    'primaryColor',
    'accentColor',
    'backgroundColor',
    'textColor',
    'launcherColor'
  ]
  LOOP
    IF jsonb_typeof(p_draft -> v_color_key) IS DISTINCT FROM 'string'
       OR COALESCE((p_draft ->> v_color_key) !~ '^#[0-9A-Fa-f]{6}$', true) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: % must be a #RRGGBB color.', v_color_key;
    END IF;
  END LOOP;

  IF COALESCE(p_draft ->> 'launcherIcon', '') NOT IN ('chat', 'message', 'help', 'custom') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcherIcon.';
  END IF;
  IF COALESCE(p_draft ->> 'launcherShape', '') NOT IN ('circle', 'rounded-square', 'square', 'rectangle') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcherShape.';
  END IF;
  IF COALESCE(p_draft ->> 'launcherSize', '') NOT IN ('sm', 'md', 'lg') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcherSize.';
  END IF;
  IF COALESCE(p_draft ->> 'launcherPosition', '') NOT IN ('bottom-right', 'bottom-left') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid launcherPosition.';
  END IF;
  IF COALESCE(p_draft ->> 'shadowLevel', '') NOT IN ('none', 'sm', 'md', 'lg') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid shadowLevel.';
  END IF;
  IF COALESCE(p_draft ->> 'density', '') NOT IN ('compact', 'comfortable') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid density.';
  END IF;
  IF COALESCE(p_draft ->> 'headerStyle', '') NOT IN ('solid', 'minimal', 'branded') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid headerStyle.';
  END IF;
  IF COALESCE(p_draft ->> 'sendButtonStyle', '') NOT IN ('icon', 'text', 'icon-text') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid sendButtonStyle.';
  END IF;
  IF COALESCE(p_draft ->> 'fontFamily', '') NOT IN (
    'system', 'inter', 'geist', 'source-sans', 'ibm-plex-sans', 'nunito-sans'
  ) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid fontFamily.';
  END IF;
  IF COALESCE(p_draft ->> 'fontSizeScale', '') NOT IN ('sm', 'md', 'lg') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid fontSizeScale.';
  END IF;
  IF COALESCE(p_draft ->> 'colorMode', '') NOT IN ('light', 'dark', 'system') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid colorMode.';
  END IF;
  IF COALESCE(p_draft ->> 'mobileBehavior', '') NOT IN ('responsive', 'fullscreen') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid mobileBehavior.';
  END IF;
  IF p_draft -> 'presetId' IS DISTINCT FROM 'null'::jsonb
     AND COALESCE(p_draft ->> 'presetId', '') NOT IN (
       'clean', 'minimal', 'modern', 'dark', 'rounded'
     ) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid presetId.';
  END IF;

  IF jsonb_typeof(p_draft -> 'locale') IS DISTINCT FROM 'string'
     OR NOT app_private.is_supported_widget_locale(p_draft ->> 'locale') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: invalid locale.';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'hideLauncherWhenOpen',
    'showGreeting',
    'showAgentAvatars',
    'showPoweredBy',
    'soundEnabled'
  ]
  LOOP
    IF jsonb_typeof(p_draft -> v_key) IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: % must be a boolean.', v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(p_draft -> 'reopenWindowHours') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'reopenWindowHours') !~ '^[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: reopenWindowHours must be an integer from 1 to 720.';
  END IF;
  v_hours := (p_draft ->> 'reopenWindowHours')::integer;
  IF v_hours < 1 OR v_hours > 720 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: reopenWindowHours must be between 1 and 720.';
  END IF;

  FOREACH v_key IN ARRAY ARRAY['launcherOffsetX', 'launcherOffsetY']
  LOOP
    IF jsonb_typeof(p_draft -> v_key) IS DISTINCT FROM 'number'
       OR COALESCE((p_draft ->> v_key) !~ '^-?[0-9]+$', true) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: % must be an integer.', v_key;
    END IF;
    v_offset := (p_draft ->> v_key)::integer;
    IF v_offset < 0 OR v_offset > 120 THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: % must be between 0 and 120.', v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(p_draft -> 'borderRadius') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'borderRadius') !~ '^-?[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: borderRadius must be an integer.';
  END IF;
  v_radius := (p_draft ->> 'borderRadius')::integer;
  IF v_radius < 0 OR v_radius > 32 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: borderRadius must be between 0 and 32.';
  END IF;

  IF jsonb_typeof(p_draft -> 'widgetWidth') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'widgetWidth') !~ '^[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetWidth must be an integer.';
  END IF;
  v_width := (p_draft ->> 'widgetWidth')::integer;
  IF v_width < 300 OR v_width > 480 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetWidth must be between 300 and 480.';
  END IF;

  IF jsonb_typeof(p_draft -> 'widgetHeight') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'widgetHeight') !~ '^[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetHeight must be an integer.';
  END IF;
  v_height := (p_draft ->> 'widgetHeight')::integer;
  IF v_height < 360 OR v_height > 800 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetHeight must be between 360 and 800.';
  END IF;

  IF jsonb_typeof(p_draft -> 'widgetMaxHeight') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'widgetMaxHeight') !~ '^[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetMaxHeight must be an integer.';
  END IF;
  v_max_height := (p_draft ->> 'widgetMaxHeight')::integer;
  IF v_max_height < 360 OR v_max_height > 900 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetMaxHeight must be between 360 and 900.';
  END IF;
  IF v_max_height < v_height THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: widgetMaxHeight must be >= widgetHeight.';
  END IF;

  IF p_draft -> 'autoOpenDelayMs' IS DISTINCT FROM 'null'::jsonb THEN
    IF jsonb_typeof(p_draft -> 'autoOpenDelayMs') IS DISTINCT FROM 'number'
       OR COALESCE((p_draft ->> 'autoOpenDelayMs') !~ '^[0-9]+$', true) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: autoOpenDelayMs must be an integer or null.';
    END IF;
    v_delay := (p_draft ->> 'autoOpenDelayMs')::integer;
    IF v_delay < 0 OR v_delay > 60000 THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: autoOpenDelayMs must be between 0 and 60000.';
    END IF;
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'launcherIconAssetId',
    'logoAssetId',
    'agentAvatarAssetId'
  ]
  LOOP
    IF p_draft -> v_key IS DISTINCT FROM 'null'::jsonb THEN
      IF jsonb_typeof(p_draft -> v_key) IS DISTINCT FROM 'string'
         OR COALESCE(
           (p_draft ->> v_key)
           !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
           true
         ) THEN
        RAISE EXCEPTION 'INVALID_APPEARANCE: % must be a UUID or null.', v_key;
      END IF;
    END IF;
  END LOOP;

  FOREACH v_key IN ARRAY ARRAY[
    'headerTitle',
    'subtitle',
    'welcomeMessage',
    'placeholderText'
  ]
  LOOP
    v_copy := p_draft -> v_key;
    IF jsonb_typeof(v_copy) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: % must be a localized copy object.', v_key;
    END IF;
    IF jsonb_typeof(v_copy -> 'useSystemDefaults') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: %.useSystemDefaults must be boolean.', v_key;
    END IF;
    IF jsonb_typeof(v_copy -> 'overrides') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: %.overrides must be an object.', v_key;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_each(v_copy -> 'overrides') AS e(locale, value)
      WHERE NOT app_private.is_supported_widget_locale(e.locale)
         OR jsonb_typeof(e.value) IS DISTINCT FROM 'string'
         OR length(btrim(e.value #>> '{}')) < 1
         OR length(e.value #>> '{}') > 500
    ) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: %.overrides has invalid locale entries.', v_key;
    END IF;
  END LOOP;

  v_bh := p_draft -> 'businessHours';
  IF jsonb_typeof(v_bh) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours must be an object.';
  END IF;
  IF jsonb_typeof(v_bh -> 'enabled') IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours.enabled must be boolean.';
  END IF;
  IF jsonb_typeof(v_bh -> 'timezone') IS DISTINCT FROM 'string'
     OR length(btrim(v_bh ->> 'timezone')) < 1
     OR length(v_bh ->> 'timezone') > 64 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours.timezone is invalid.';
  END IF;
  IF jsonb_typeof(v_bh -> 'weekly') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_bh -> 'weekly') > 21 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours.weekly is invalid.';
  END IF;

  v_weekly := v_bh -> 'weekly';
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_weekly)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours.weekly entries must be objects.';
    END IF;
    IF jsonb_typeof(v_item -> 'day') IS DISTINCT FROM 'number'
       OR COALESCE((v_item ->> 'day') !~ '^[0-6]$', true) THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours day must be 0-6.';
    END IF;
    v_day := (v_item ->> 'day')::integer;
    IF v_day < 0 OR v_day > 6 THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours day must be 0-6.';
    END IF;
    IF COALESCE(v_item ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR COALESCE(v_item ->> 'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours times must be HH:mm.';
    END IF;
    IF (v_item ->> 'start') >= (v_item ->> 'end') THEN
      RAISE EXCEPTION 'INVALID_APPEARANCE: businessHours start must be before end.';
    END IF;
  END LOOP;

  RETURN p_draft;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_public_config_payload(
  p_appearance jsonb,
  p_version integer,
  p_updated_at jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_config jsonb;
  v_welcome jsonb;
  v_header_title jsonb;
  v_subtitle jsonb;
  v_placeholder jsonb;
  v_business_hours jsonb;
  v_weekly jsonb;
  v_greeting text;
  v_display_name text;
BEGIN
  v_config := app_private.widget_appearance_defaults()
    || CASE
         WHEN jsonb_typeof(p_appearance) = 'object' THEN p_appearance
         ELSE '{}'::jsonb
       END;

  v_welcome := app_private.widget_public_localized_copy(v_config -> 'welcomeMessage');
  v_header_title := app_private.widget_public_localized_copy(v_config -> 'headerTitle');
  v_subtitle := app_private.widget_public_localized_copy(v_config -> 'subtitle');
  v_placeholder := app_private.widget_public_localized_copy(v_config -> 'placeholderText');

  v_greeting := NULLIF(v_welcome -> 'overrides' ->> 'en', '');
  IF v_greeting IS NULL THEN
    SELECT NULLIF(e.value, '')
    INTO v_greeting
    FROM jsonb_each_text(v_welcome -> 'overrides') AS e
    ORDER BY e.key
    LIMIT 1;
  END IF;
  v_greeting := COALESCE(v_greeting, 'Hi! How can we help?');

  v_display_name := NULLIF(v_header_title -> 'overrides' ->> 'en', '');
  IF v_display_name IS NULL THEN
    SELECT NULLIF(e.value, '')
    INTO v_display_name
    FROM jsonb_each_text(v_header_title -> 'overrides') AS e
    ORDER BY e.key
    LIMIT 1;
  END IF;

  v_business_hours := CASE
    WHEN jsonb_typeof(v_config -> 'businessHours') = 'object'
      THEN v_config -> 'businessHours'
    ELSE app_private.widget_appearance_defaults() -> 'businessHours'
  END;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'day', item -> 'day',
        'start', item -> 'start',
        'end', item -> 'end'
      )
      ORDER BY ordinal
    ),
    '[]'::jsonb
  )
  INTO v_weekly
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(v_business_hours -> 'weekly') = 'array'
        THEN v_business_hours -> 'weekly'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS entry(item, ordinal)
  WHERE jsonb_typeof(item) = 'object';

  RETURN jsonb_build_object(
    'version', p_version,
    'updatedAt', p_updated_at,
    'locale', app_private.normalize_widget_locale(v_config ->> 'locale'),
    'reopenWindowHours', v_config -> 'reopenWindowHours',
    'primaryColor', v_config -> 'primaryColor',
    'accentColor', v_config -> 'accentColor',
    'backgroundColor', v_config -> 'backgroundColor',
    'textColor', v_config -> 'textColor',
    'launcherColor', v_config -> 'launcherColor',
    'launcherIcon', v_config -> 'launcherIcon',
    'launcherText', COALESCE(v_config -> 'launcherText', '"Online chat"'::jsonb),
    'launcherWidth', COALESCE(v_config -> 'launcherWidth', '180'::jsonb),
    'mobileLauncher', COALESCE(v_config -> 'mobileLauncher', 'null'::jsonb),
    'launcherShape', v_config -> 'launcherShape',
    'launcherSize', v_config -> 'launcherSize',
    'position', v_config -> 'launcherPosition',
    'launcherOffsetX', v_config -> 'launcherOffsetX',
    'launcherOffsetY', v_config -> 'launcherOffsetY',
    'launcherIconUrl', NULL,
    'borderRadius', v_config -> 'borderRadius',
    'shadowLevel', v_config -> 'shadowLevel',
    'widgetWidth', v_config -> 'widgetWidth',
    'widgetHeight', v_config -> 'widgetHeight',
    'widgetMaxHeight', v_config -> 'widgetMaxHeight',
    'density', v_config -> 'density',
    'headerStyle', v_config -> 'headerStyle',
    'headerTitle', v_header_title,
    'subtitle', v_subtitle,
    'logoUrl', NULL,
    'agentAvatarUrl', NULL,
    'welcomeMessage', v_welcome,
    'placeholderText', v_placeholder,
    'sendButtonStyle', v_config -> 'sendButtonStyle',
    'fontFamily', v_config -> 'fontFamily',
    'fontSizeScale', v_config -> 'fontSizeScale',
    'colorMode', v_config -> 'colorMode',
    'autoOpenDelayMs', v_config -> 'autoOpenDelayMs',
    'hideLauncherWhenOpen', v_config -> 'hideLauncherWhenOpen',
    'showGreeting', v_config -> 'showGreeting',
    'mobileBehavior', v_config -> 'mobileBehavior',
    'showAgentAvatars', v_config -> 'showAgentAvatars',
    'showPoweredBy', v_config -> 'showPoweredBy',
    'soundEnabled', v_config -> 'soundEnabled',
    'businessHours', jsonb_build_object(
      'enabled', CASE
        WHEN jsonb_typeof(v_business_hours -> 'enabled') = 'boolean'
          THEN v_business_hours -> 'enabled'
        ELSE 'false'::jsonb
      END,
      'timezone', CASE
        WHEN jsonb_typeof(v_business_hours -> 'timezone') = 'string'
          THEN v_business_hours -> 'timezone'
        ELSE '"UTC"'::jsonb
      END,
      'weekly', v_weekly,
      'onlineGreeting', CASE
        WHEN jsonb_typeof(v_business_hours -> 'onlineGreeting') = 'object'
          THEN app_private.widget_public_localized_copy(
            v_business_hours -> 'onlineGreeting'
          )
        ELSE NULL
      END,
      'offlineGreeting', CASE
        WHEN jsonb_typeof(v_business_hours -> 'offlineGreeting') = 'object'
          THEN app_private.widget_public_localized_copy(
            v_business_hours -> 'offlineGreeting'
          )
        ELSE NULL
      END,
      'awayMessage', CASE
        WHEN jsonb_typeof(v_business_hours -> 'awayMessage') = 'object'
          THEN app_private.widget_public_localized_copy(
            v_business_hours -> 'awayMessage'
          )
        ELSE NULL
      END
    ),
    'greetingMessage', v_greeting,
    'branding', jsonb_build_object(
      'displayName', v_display_name,
      'logoUrl', NULL,
      'primaryColor', v_config -> 'primaryColor',
      'showPoweredBy', v_config -> 'showPoweredBy'
    )
  );
END;
$$;
