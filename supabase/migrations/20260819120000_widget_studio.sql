-- Site Chat Widget Studio: draft/published appearance state and brand assets.
-- Draft mutations are authenticated RPC-only; visitor bootstrap reads the
-- explicitly allowlisted published DTO.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.widget_configs (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  draft_json jsonb NOT NULL,
  published_json jsonb NOT NULL,
  published_version integer NOT NULL DEFAULT 1,
  draft_updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  draft_updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_widget_configs_published_version CHECK (published_version >= 1)
);

COMMENT ON TABLE public.widget_configs IS
  'Widget Studio appearance state. draft_json is operator-only preview state; visitors only receive published_json through app_private.widget_public_config_for_workspace.';
COMMENT ON COLUMN public.widget_configs.draft_json IS
  'Latest editable Widget Studio appearance. Never exposed to visitor bootstrap.';
COMMENT ON COLUMN public.widget_configs.published_json IS
  'Last atomically published appearance. The only Widget Studio config exposed to visitors.';

CREATE TRIGGER trg_widget_configs_set_updated_at
  BEFORE UPDATE ON public.widget_configs
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.widget_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer,
  height integer,
  original_filename text NOT NULL,
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT chk_widget_assets_kind
    CHECK (kind IN ('logo', 'launcher_icon', 'agent_avatar')),
  CONSTRAINT chk_widget_assets_byte_size
    CHECK (byte_size > 0 AND byte_size <= 524288),
  CONSTRAINT uq_widget_assets_workspace_storage_key
    UNIQUE (workspace_id, storage_key)
);

COMMENT ON TABLE public.widget_assets IS
  'Private Widget Studio brand-asset metadata. Visitors receive only app-signed URLs derived from published asset references; storage keys are not public config.';
COMMENT ON COLUMN public.widget_assets.deleted_at IS
  'Soft-delete marker. Active asset lookups require deleted_at IS NULL.';

CREATE INDEX idx_widget_assets_workspace
  ON public.widget_assets (workspace_id);

CREATE INDEX idx_widget_assets_workspace_kind
  ON public.widget_assets (workspace_id, kind)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_widget_assets_set_updated_at
  BEFORE UPDATE ON public.widget_assets
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Canonical appearance and legacy conversion
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_appearance_defaults()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT '{"schemaVersion":1,"primaryColor":"#0066FF","accentColor":"#0052CC","backgroundColor":"#FFFFFF","textColor":"#111827","launcherColor":"#0066FF","launcherIcon":"chat","launcherShape":"circle","launcherSize":"md","launcherPosition":"bottom-right","launcherOffsetX":16,"launcherOffsetY":16,"launcherIconAssetId":null,"borderRadius":16,"shadowLevel":"md","widgetWidth":380,"widgetHeight":560,"widgetMaxHeight":720,"density":"comfortable","headerStyle":"solid","headerTitle":{"useSystemDefaults":true,"overrides":{}},"subtitle":{"useSystemDefaults":true,"overrides":{}},"logoAssetId":null,"agentAvatarAssetId":null,"welcomeMessage":{"useSystemDefaults":true,"overrides":{"en":"Hi! How can we help?"}},"placeholderText":{"useSystemDefaults":true,"overrides":{}},"sendButtonStyle":"icon","fontFamily":"system","fontSizeScale":"md","colorMode":"light","autoOpenDelayMs":null,"hideLauncherWhenOpen":true,"showGreeting":true,"mobileBehavior":"fullscreen","showAgentAvatars":true,"showPoweredBy":true,"soundEnabled":false,"locale":"en","reopenWindowHours":24,"businessHours":{"enabled":false,"timezone":"UTC","weekly":[]},"presetId":null}'::jsonb;
$$;

COMMENT ON FUNCTION app_private.widget_appearance_defaults() IS
  'Canonical schemaVersion 1 Widget Studio appearance defaults.';

CREATE OR REPLACE FUNCTION app_private.widget_appearance_from_legacy(p_settings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_result jsonb := app_private.widget_appearance_defaults();
  v_widget jsonb := '{}'::jsonb;
  v_branding jsonb := '{}'::jsonb;
  v_text text;
  v_hours numeric;
BEGIN
  IF jsonb_typeof(p_settings) = 'object'
     AND jsonb_typeof(p_settings -> 'widget') = 'object' THEN
    v_widget := p_settings -> 'widget';
  END IF;

  IF jsonb_typeof(v_widget -> 'branding') = 'object' THEN
    v_branding := v_widget -> 'branding';
  END IF;

  IF jsonb_typeof(v_widget -> 'locale') = 'string' THEN
    v_result := jsonb_set(
      v_result,
      '{locale}',
      to_jsonb(app_private.normalize_widget_locale(v_widget ->> 'locale'))
    );
  END IF;

  IF jsonb_typeof(v_widget -> 'greetingMessage') = 'string' THEN
    v_text := NULLIF(btrim(v_widget ->> 'greetingMessage'), '');
    IF v_text IS NOT NULL THEN
      v_result := jsonb_set(
        v_result,
        '{welcomeMessage}',
        jsonb_build_object(
          'useSystemDefaults', true,
          'overrides', jsonb_build_object('en', left(v_text, 500))
        )
      );
    END IF;
  END IF;

  IF jsonb_typeof(v_widget -> 'reopenWindowHours') = 'number'
     AND (v_widget ->> 'reopenWindowHours') ~ '^[0-9]+$' THEN
    v_hours := (v_widget ->> 'reopenWindowHours')::numeric;
    IF v_hours BETWEEN 1 AND 720 THEN
      v_result := jsonb_set(v_result, '{reopenWindowHours}', to_jsonb(v_hours::integer));
    END IF;
  END IF;

  IF v_widget ->> 'position' IN ('bottom-right', 'bottom-left') THEN
    v_result := jsonb_set(
      v_result,
      '{launcherPosition}',
      to_jsonb(v_widget ->> 'position')
    );
  END IF;

  IF jsonb_typeof(v_branding -> 'displayName') = 'string' THEN
    v_text := NULLIF(btrim(v_branding ->> 'displayName'), '');
    IF v_text IS NOT NULL THEN
      v_result := jsonb_set(
        v_result,
        '{headerTitle}',
        jsonb_build_object(
          'useSystemDefaults', true,
          'overrides', jsonb_build_object('en', left(v_text, 100))
        )
      );
    END IF;
  END IF;

  IF jsonb_typeof(v_branding -> 'primaryColor') = 'string'
     AND (v_branding ->> 'primaryColor') ~ '^#[0-9A-Fa-f]{6}$' THEN
    v_result := jsonb_set(v_result, '{primaryColor}', v_branding -> 'primaryColor');
    v_result := jsonb_set(v_result, '{accentColor}', v_branding -> 'primaryColor');
    v_result := jsonb_set(v_result, '{launcherColor}', v_branding -> 'primaryColor');
  END IF;

  IF jsonb_typeof(v_branding -> 'showPoweredBy') = 'boolean' THEN
    v_result := jsonb_set(v_result, '{showPoweredBy}', v_branding -> 'showPoweredBy');
  END IF;

  -- Legacy branding.logoUrl is intentionally not copied. Asset IDs must refer
  -- to rows in widget_assets and URLs are signed by the application layer.
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION app_private.widget_appearance_from_legacy(jsonb) IS
  'Maps allowlisted settings_json.widget legacy fields onto Widget Studio defaults; legacy logoUrl is intentionally ignored.';

-- ---------------------------------------------------------------------------
-- Access, validation, row creation, and state helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.require_widget_studio_view(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.require_widget_studio_manage(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  v_role := app_private.require_widget_studio_view(p_workspace_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only owners and admins can manage Widget Studio.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.validate_widget_appearance(p_draft jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_required_keys text[] := ARRAY[
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
  v_color_key text;
  v_hours numeric;
BEGIN
  IF p_draft IS NULL OR jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: appearance must be a JSON object.';
  END IF;

  IF NOT (p_draft ?& v_required_keys) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: one or more required appearance keys are missing.';
  END IF;

  IF jsonb_path_exists(p_draft, '$.**.customCss')
     OR jsonb_path_exists(p_draft, '$.**.customJS') THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: customCss and customJS are not allowed.';
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

  IF jsonb_typeof(p_draft -> 'launcherPosition') IS DISTINCT FROM 'string'
     OR COALESCE(
       (p_draft ->> 'launcherPosition') NOT IN ('bottom-right', 'bottom-left'),
       true
     ) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: launcherPosition must be bottom-right or bottom-left.';
  END IF;

  IF jsonb_typeof(p_draft -> 'reopenWindowHours') IS DISTINCT FROM 'number'
     OR COALESCE((p_draft ->> 'reopenWindowHours') !~ '^[0-9]+$', true) THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: reopenWindowHours must be an integer from 1 to 720.';
  END IF;

  v_hours := (p_draft ->> 'reopenWindowHours')::numeric;
  IF v_hours NOT BETWEEN 1 AND 720 THEN
    RAISE EXCEPTION 'INVALID_APPEARANCE: reopenWindowHours must be between 1 and 720.';
  END IF;

  RETURN p_draft;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.ensure_widget_config(p_workspace_id uuid)
RETURNS public.widget_configs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  INSERT INTO public.widget_configs (
    workspace_id,
    draft_json,
    published_json
  )
  SELECT
    w.id,
    app_private.widget_appearance_from_legacy(w.settings_json),
    app_private.widget_appearance_from_legacy(w.settings_json)
  FROM public.workspaces w
  WHERE w.id = p_workspace_id
  ON CONFLICT (workspace_id) DO NOTHING;

  SELECT wc.*
  INTO v_config
  FROM public.widget_configs wc
  WHERE wc.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND: Workspace not found.';
  END IF;

  RETURN v_config;
END;
$$;

COMMENT ON FUNCTION app_private.ensure_widget_config(uuid) IS
  'Idempotently creates a Widget Studio row from legacy workspace settings and returns it.';

CREATE OR REPLACE FUNCTION app_private.widget_studio_state_payload(
  r public.widget_configs
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'draft', r.draft_json,
    'published', r.published_json,
    'publishedVersion', r.published_version,
    'draftUpdatedAt', r.draft_updated_at,
    'publishedAt', r.published_at,
    'draftDirty', r.draft_json IS DISTINCT FROM r.published_json
  );
$$;

-- ---------------------------------------------------------------------------
-- Explicit public appearance mapping
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_public_localized_copy(p_copy jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_overrides jsonb;
  v_use_system_defaults boolean := true;
BEGIN
  IF jsonb_typeof(p_copy) <> 'object' THEN
    p_copy := '{}'::jsonb;
  END IF;

  IF jsonb_typeof(p_copy -> 'useSystemDefaults') = 'boolean' THEN
    v_use_system_defaults := (p_copy ->> 'useSystemDefaults')::boolean;
  END IF;

  SELECT COALESCE(jsonb_object_agg(e.key, e.value ORDER BY e.key), '{}'::jsonb)
  INTO v_overrides
  FROM jsonb_each(
    CASE
      WHEN jsonb_typeof(p_copy -> 'overrides') = 'object'
        THEN p_copy -> 'overrides'
      ELSE '{}'::jsonb
    END
  ) AS e
  WHERE jsonb_typeof(e.value) = 'string'
    AND app_private.is_supported_widget_locale(e.key)
    AND length(btrim(e.value #>> '{}')) BETWEEN 1 AND 500;

  RETURN jsonb_build_object(
    'useSystemDefaults', v_use_system_defaults,
    'overrides', v_overrides
  );
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

COMMENT ON FUNCTION app_private.widget_public_config_payload(jsonb, integer, jsonb) IS
  'Builds the explicit visitor-safe appearance DTO. Asset URLs remain null for application-layer signing.';

CREATE OR REPLACE FUNCTION app_private.widget_public_config(p_settings jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT app_private.widget_public_config_payload(
    app_private.widget_appearance_from_legacy(p_settings),
    1,
    '"1970-01-01T00:00:00Z"'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION app_private.widget_public_config_for_workspace(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  v_config := app_private.ensure_widget_config(p_workspace_id);

  -- published_json is selected deliberately. draft_json must never enter a
  -- visitor response, even when an owner is actively editing it.
  RETURN app_private.widget_public_config_payload(
    v_config.published_json,
    v_config.published_version,
    to_jsonb(v_config.published_at)
  );
END;
$$;

COMMENT ON FUNCTION app_private.widget_public_config_for_workspace(uuid) IS
  'Returns only the published, explicitly allowlisted Widget Studio visitor DTO. Draft state and non-appearance workspace data are never included.';

-- ---------------------------------------------------------------------------
-- Backfill active workspaces
-- ---------------------------------------------------------------------------

INSERT INTO public.widget_configs (
  workspace_id,
  draft_json,
  published_json,
  published_version,
  draft_updated_at,
  published_at,
  published_by,
  draft_updated_by,
  created_at,
  updated_at
)
SELECT
  w.id,
  appearance.value,
  appearance.value,
  1,
  now(),
  now(),
  NULL,
  NULL,
  now(),
  now()
FROM public.workspaces w
CROSS JOIN LATERAL (
  SELECT app_private.widget_appearance_from_legacy(w.settings_json) AS value
) AS appearance
WHERE w.deleted_at IS NULL
ON CONFLICT (workspace_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Authenticated Widget Studio RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_widget_studio_state(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  PERFORM app_private.require_widget_studio_view(p_workspace_id);
  v_config := app_private.ensure_widget_config(p_workspace_id);
  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

CREATE OR REPLACE FUNCTION public.save_widget_studio_draft(
  p_workspace_id uuid,
  p_draft jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
  v_draft jsonb;
BEGIN
  PERFORM app_private.require_widget_studio_manage(p_workspace_id);
  v_draft := app_private.validate_widget_appearance(p_draft);
  PERFORM app_private.ensure_widget_config(p_workspace_id);

  UPDATE public.widget_configs
  SET
    draft_json = v_draft,
    draft_updated_at = now(),
    draft_updated_by = auth.uid()
  WHERE workspace_id = p_workspace_id
  RETURNING * INTO v_config;

  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_widget_studio(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  PERFORM app_private.require_widget_studio_manage(p_workspace_id);
  PERFORM app_private.ensure_widget_config(p_workspace_id);

  -- Keep the publish transition in one row update so config, version, time,
  -- and actor can never become partially visible.
  UPDATE public.widget_configs
  SET
    published_json = draft_json,
    published_version = published_version + 1,
    published_at = now(),
    published_by = auth.uid()
  WHERE workspace_id = p_workspace_id
  RETURNING * INTO v_config;

  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

CREATE OR REPLACE FUNCTION public.discard_widget_studio_draft(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  PERFORM app_private.require_widget_studio_manage(p_workspace_id);
  PERFORM app_private.ensure_widget_config(p_workspace_id);

  UPDATE public.widget_configs
  SET
    draft_json = published_json,
    draft_updated_at = now(),
    draft_updated_by = auth.uid()
  WHERE workspace_id = p_workspace_id
  RETURNING * INTO v_config;

  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_widget_studio_draft(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_config public.widget_configs;
BEGIN
  PERFORM app_private.require_widget_studio_manage(p_workspace_id);
  PERFORM app_private.ensure_widget_config(p_workspace_id);

  UPDATE public.widget_configs
  SET
    draft_json = app_private.widget_appearance_defaults(),
    draft_updated_at = now(),
    draft_updated_by = auth.uid()
  WHERE workspace_id = p_workspace_id
  RETURNING * INTO v_config;

  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

-- ---------------------------------------------------------------------------
-- Visitor helper replacements
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_resolve_public_key(
  p_widget_public_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace public.workspaces;
BEGIN
  SELECT w.*
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
    'config', app_private.widget_public_config_for_workspace(v_workspace.id)
  );
END;
$$;

-- The underlying resolver may initialize a missing config row, so this wrapper
-- is intentionally VOLATILE rather than retaining the legacy STABLE marker.
CREATE OR REPLACE FUNCTION public.widget_resolve_public_key(
  p_widget_public_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_resolve_public_key(p_widget_public_key);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_reopen_window_hours(
  p_workspace_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    CASE
      WHEN jsonb_typeof(wc.published_json -> 'reopenWindowHours') = 'number'
        AND (wc.published_json ->> 'reopenWindowHours') ~ '^[0-9]+$'
        AND (wc.published_json ->> 'reopenWindowHours')::numeric BETWEEN 1 AND 720
      THEN (wc.published_json ->> 'reopenWindowHours')::integer
      ELSE NULL
    END,
    CASE
      WHEN jsonb_typeof(w.settings_json -> 'widget' -> 'reopenWindowHours') = 'number'
        AND (w.settings_json -> 'widget' ->> 'reopenWindowHours') ~ '^[0-9]+$'
        AND (w.settings_json -> 'widget' ->> 'reopenWindowHours')::numeric
          BETWEEN 1 AND 720
      THEN (w.settings_json -> 'widget' ->> 'reopenWindowHours')::integer
      ELSE NULL
    END,
    24
  )
  FROM public.workspaces w
  LEFT JOIN public.widget_configs wc ON wc.workspace_id = w.id
  WHERE w.id = p_workspace_id;
$$;

-- ---------------------------------------------------------------------------
-- Private storage bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'widget-assets',
  'widget-assets',
  false,
  524288,
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ObjectStorage uses the service role to mint signed upload/download URLs.
-- No anon/authenticated storage.objects policy is added for this private bucket.

-- ---------------------------------------------------------------------------
-- RLS and table privileges
-- ---------------------------------------------------------------------------

ALTER TABLE public.widget_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_configs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.widget_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.widget_assets FORCE ROW LEVEL SECURITY;

CREATE POLICY widget_configs_select_authenticated
  ON public.widget_configs
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY widget_assets_select_authenticated
  ON public.widget_assets
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

-- Mutations are service-role only (signed upload finalize). Authenticated
-- clients never INSERT/UPDATE verification-sensitive fields directly.

REVOKE ALL ON TABLE public.widget_configs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.widget_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget_configs TO service_role;

REVOKE ALL ON TABLE public.widget_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.widget_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget_assets TO service_role;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_widget_studio_state(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_widget_studio_draft(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_widget_studio(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.discard_widget_studio_draft(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_widget_studio_draft(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_widget_studio_state(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_widget_studio_draft(uuid, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_widget_studio(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_widget_studio_draft(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_widget_studio_draft(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.widget_resolve_public_key(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_resolve_public_key(text)
  TO service_role;

-- CREATE OR REPLACE grants app_private functions to PUBLIC by default. Restore
-- the repository's deny-by-default function boundary, then expose only helpers
-- required by authenticated RLS policy evaluation.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
