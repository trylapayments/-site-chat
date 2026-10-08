-- Widget Studio hardening (PR #36 follow-up):
-- 1) Close authenticated widget_assets write surface
-- 2) Explicit verification state (status + verified_at)
-- 3) storage_key workspace-prefix invariant + immutability
-- 4) Zod-parity validate_widget_appearance
-- 5) Publish CAS via expected published_version
-- 6) Raster-only brand assets (no SVG)

-- ---------------------------------------------------------------------------
-- widget_assets: verification state + path invariant
-- ---------------------------------------------------------------------------

ALTER TABLE public.widget_assets
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

UPDATE public.widget_assets
SET
  status = CASE
    WHEN deleted_at IS NOT NULL THEN 'rejected'
    WHEN width IS NOT NULL AND height IS NOT NULL THEN 'verified'
    ELSE 'pending'
  END,
  verified_at = CASE
    WHEN deleted_at IS NULL AND width IS NOT NULL AND height IS NOT NULL
      THEN COALESCE(updated_at, created_at)
    ELSE NULL
  END
WHERE TRUE;

ALTER TABLE public.widget_assets
  DROP CONSTRAINT IF EXISTS chk_widget_assets_status;

ALTER TABLE public.widget_assets
  ADD CONSTRAINT chk_widget_assets_status
  CHECK (status IN ('pending', 'verified', 'rejected'));

ALTER TABLE public.widget_assets
  DROP CONSTRAINT IF EXISTS chk_widget_assets_verified_consistency;

ALTER TABLE public.widget_assets
  ADD CONSTRAINT chk_widget_assets_verified_consistency
  CHECK (
    (status = 'verified' AND verified_at IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL)
    OR (status <> 'verified' AND verified_at IS NULL)
  );

ALTER TABLE public.widget_assets
  DROP CONSTRAINT IF EXISTS chk_widget_assets_storage_key_workspace;

ALTER TABLE public.widget_assets
  ADD CONSTRAINT chk_widget_assets_storage_key_workspace
  CHECK (
    storage_key LIKE ('workspaces/' || workspace_id::text || '/widget-assets/%')
    AND storage_key !~ '\.\.'
    AND char_length(storage_key) BETWEEN 40 AND 512
  );

COMMENT ON COLUMN public.widget_assets.status IS
  'Upload lifecycle: pending (unsigned), verified (server-inspected), rejected (soft-failed). Width/height alone never imply trust.';
COMMENT ON COLUMN public.widget_assets.verified_at IS
  'Set only by the server after magic-byte/dimension inspection. Never client-writable via RLS.';
COMMENT ON COLUMN public.widget_assets.storage_key IS
  'Server-generated object path. Immutable after insert. Must be workspaces/{workspace_id}/widget-assets/...';

CREATE OR REPLACE FUNCTION app_private.widget_assets_protect_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.storage_key IS DISTINCT FROM OLD.storage_key THEN
      RAISE EXCEPTION 'FORBIDDEN: widget_assets.storage_key is immutable.';
    END IF;
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'FORBIDDEN: widget_assets.workspace_id is immutable.';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'FORBIDDEN: widget_assets.id is immutable.';
    END IF;
  END IF;

  IF NEW.storage_key NOT LIKE ('workspaces/' || NEW.workspace_id::text || '/widget-assets/%') THEN
    RAISE EXCEPTION 'INVALID_STORAGE_KEY: storage_key must be scoped to the asset workspace.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_widget_assets_protect_immutable ON public.widget_assets;
CREATE TRIGGER trg_widget_assets_protect_immutable
  BEFORE INSERT OR UPDATE ON public.widget_assets
  FOR EACH ROW
  EXECUTE FUNCTION app_private.widget_assets_protect_immutable_fields();

CREATE INDEX IF NOT EXISTS idx_widget_assets_workspace_verified
  ON public.widget_assets (workspace_id, kind)
  WHERE deleted_at IS NULL AND status = 'verified';

-- Close direct client mutation of verification-sensitive rows.
DROP POLICY IF EXISTS widget_assets_insert_manage ON public.widget_assets;
DROP POLICY IF EXISTS widget_assets_update_manage ON public.widget_assets;

REVOKE ALL ON TABLE public.widget_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.widget_assets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.widget_assets TO service_role;

-- Raster-only bucket policy (remove SVG).
UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp'],
  file_size_limit = 524288
WHERE id = 'widget-assets';

-- ---------------------------------------------------------------------------
-- Strong appearance validation (Zod parity for RPC boundary)
-- ---------------------------------------------------------------------------

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
  IF COALESCE(p_draft ->> 'launcherShape', '') NOT IN ('circle', 'rounded-square', 'square') THEN
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

COMMENT ON FUNCTION app_private.validate_widget_appearance(jsonb) IS
  'Strict Widget Studio draft validation aligned with shared Zod (enums, bounds, localized copy, no unknown keys).';

-- ---------------------------------------------------------------------------
-- Publish CAS
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.publish_widget_studio(uuid);

CREATE OR REPLACE FUNCTION public.publish_widget_studio(
  p_workspace_id uuid,
  p_expected_published_version integer DEFAULT NULL
)
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
    published_json = draft_json,
    published_version = published_version + 1,
    published_at = now(),
    published_by = auth.uid()
  WHERE workspace_id = p_workspace_id
    AND (
      p_expected_published_version IS NULL
      OR published_version = p_expected_published_version
    )
  RETURNING * INTO v_config;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLISH_CONFLICT: Widget Studio publish version mismatch.';
  END IF;

  RETURN app_private.widget_studio_state_payload(v_config);
END;
$$;

REVOKE ALL ON FUNCTION public.publish_widget_studio(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_widget_studio(uuid, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Privilege restore for RLS helpers after REVOKE ALL on app_private
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
