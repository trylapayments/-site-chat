-- Visitor Profile / CRM-lite (companies, tags, custom fields, contact profile)
-- Operator CRM entities: soft-delete definitions, typed custom fields, FTS prep,
-- timeline events, RLS SELECT + SECURITY DEFINER RPCs.
-- See docs/VISITOR-IDENTITY.md (CRM expansion) and PR #31 architecture decisions.

-- ---------------------------------------------------------------------------
-- Extensions (trigram already used by canned responses)
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Enum: custom field types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'app_custom_field_type'
  ) THEN
    CREATE TYPE public.app_custom_field_type AS ENUM (
      'text',
      'number',
      'boolean',
      'date',
      'select'
    );
  END IF;
END;
$$;

COMMENT ON TYPE public.app_custom_field_type IS
  'Typed CRM custom field kinds. Values stored in typed columns on custom_field_values.';

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text,
  website text,
  industry text,
  size text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_companies_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_companies_name_length CHECK (
    char_length(name) >= 1 AND char_length(name) <= 200
  ),
  CONSTRAINT chk_companies_domain_length CHECK (
    domain IS NULL OR char_length(domain) BETWEEN 1 AND 253
  ),
  CONSTRAINT chk_companies_website_length CHECK (
    website IS NULL OR char_length(website) BETWEEN 1 AND 2048
  ),
  CONSTRAINT chk_companies_industry_length CHECK (
    industry IS NULL OR char_length(industry) BETWEEN 1 AND 120
  ),
  CONSTRAINT chk_companies_size CHECK (
    size IS NULL OR size IN (
      '1-10',
      '11-50',
      '51-200',
      '201-500',
      '501-1000',
      '1001+'
    )
  ),
  CONSTRAINT fk_companies_created_by_workspace
    FOREIGN KEY (created_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT fk_companies_updated_by_workspace
    FOREIGN KEY (updated_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (updated_by)
);

COMMENT ON TABLE public.companies IS
  'Workspace companies/accounts. First-class CRM entity; contacts link optionally via company_id. No automatic merge by domain.';
COMMENT ON COLUMN public.companies.domain IS
  'Optional lowercased hostname (max 253). Unique per workspace among active rows when set — uniqueness only, not auto-merge.';
COMMENT ON COLUMN public.companies.website IS
  'Optional sanitized http(s) URL (max 2048).';
COMMENT ON COLUMN public.companies.deleted_at IS
  'Soft delete. Listed rows require deleted_at IS NULL.';

CREATE INDEX idx_companies_workspace_active_name
  ON public.companies (workspace_id, lower(name), id)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX uq_companies_workspace_domain_active
  ON public.companies (workspace_id, domain)
  WHERE domain IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_companies_name_trgm
  ON public.companies USING gin (name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_companies_created_by
  ON public.companies (created_by)
  WHERE created_by IS NOT NULL;

CREATE TRIGGER trg_companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- contact_tags (definitions)
-- ---------------------------------------------------------------------------

CREATE TABLE public.contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_contact_tags_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_contact_tags_name_length CHECK (
    char_length(name) >= 1 AND char_length(name) <= 64
  ),
  CONSTRAINT chk_contact_tags_color_hex CHECK (
    color ~ '^#[0-9A-Fa-f]{6}$'
  ),
  CONSTRAINT fk_contact_tags_created_by_workspace
    FOREIGN KEY (created_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT fk_contact_tags_updated_by_workspace
    FOREIGN KEY (updated_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (updated_by)
);

COMMENT ON TABLE public.contact_tags IS
  'Workspace-scoped contact tag definitions. Soft-deleted; unique lower(name) among active tags.';
COMMENT ON COLUMN public.contact_tags.color IS
  'Display color as #RRGGBB hex.';

CREATE UNIQUE INDEX uq_contact_tags_workspace_lower_name_active
  ON public.contact_tags (workspace_id, lower(name))
  WHERE deleted_at IS NULL;

CREATE INDEX idx_contact_tags_workspace_active_name
  ON public.contact_tags (workspace_id, lower(name), id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_contact_tags_name_trgm
  ON public.contact_tags USING gin (name extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_contact_tags_set_updated_at
  BEFORE UPDATE ON public.contact_tags
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- contact_tag_assignments
-- ---------------------------------------------------------------------------

CREATE TABLE public.contact_tag_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_contact_tag_assignments_workspace_contact_tag
    UNIQUE (workspace_id, contact_id, tag_id),
  CONSTRAINT fk_contact_tag_assignments_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_tag_assignments_tag_workspace
    FOREIGN KEY (tag_id, workspace_id)
    REFERENCES public.contact_tags (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_tag_assignments_assigned_by_workspace
    FOREIGN KEY (assigned_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (assigned_by)
);

COMMENT ON TABLE public.contact_tag_assignments IS
  'Contact ↔ tag junction. Hard-deleted on unassign, contact delete, or tag hard-delete.';

CREATE INDEX idx_contact_tag_assignments_workspace_tag_contact
  ON public.contact_tag_assignments (workspace_id, tag_id, contact_id);

CREATE INDEX idx_contact_tag_assignments_workspace_contact
  ON public.contact_tag_assignments (workspace_id, contact_id);

CREATE INDEX idx_contact_tag_assignments_assigned_by
  ON public.contact_tag_assignments (assigned_by)
  WHERE assigned_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- custom_field_definitions
-- ---------------------------------------------------------------------------

CREATE TABLE public.custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  field_type public.app_custom_field_type NOT NULL,
  options_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_custom_field_definitions_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_custom_field_definitions_key_format CHECK (
    key ~ '^[a-z][a-z0-9_]{0,63}$'
  ),
  CONSTRAINT chk_custom_field_definitions_label_length CHECK (
    char_length(label) >= 1 AND char_length(label) <= 120
  ),
  CONSTRAINT chk_custom_field_definitions_options_object CHECK (
    jsonb_typeof(options_json) = 'array'
  ),
  CONSTRAINT chk_custom_field_definitions_options_by_type CHECK (
    (
      field_type = 'select'
      AND jsonb_array_length(options_json) BETWEEN 1 AND 50
    )
    OR (
      field_type <> 'select'
      AND options_json = '[]'::jsonb
    )
  ),
  CONSTRAINT fk_custom_field_definitions_created_by_workspace
    FOREIGN KEY (created_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT fk_custom_field_definitions_updated_by_workspace
    FOREIGN KEY (updated_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (updated_by)
);

COMMENT ON TABLE public.custom_field_definitions IS
  'Workspace CRM custom field definitions. Key immutable after create. Soft-deleted.';
COMMENT ON COLUMN public.custom_field_definitions.key IS
  'Stable slug ^[a-z][a-z0-9_]{0,63}$. Unique among active definitions per workspace.';
COMMENT ON COLUMN public.custom_field_definitions.options_json IS
  'Select options: JSON array of 1–50 strings (1–64 chars). Empty array for non-select types.';

CREATE UNIQUE INDEX uq_custom_field_definitions_workspace_key_active
  ON public.custom_field_definitions (workspace_id, key)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_custom_field_definitions_workspace_active_sort
  ON public.custom_field_definitions (workspace_id, sort_order, label, id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_custom_field_definitions_set_updated_at
  BEFORE UPDATE ON public.custom_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- custom_field_values (typed columns; host identify JSON stays on contacts)
-- ---------------------------------------------------------------------------

CREATE TABLE public.custom_field_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  field_id uuid NOT NULL,
  value_text text,
  value_number numeric,
  value_boolean boolean,
  value_date date,
  value_select text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_custom_field_values_workspace_contact_field
    UNIQUE (workspace_id, contact_id, field_id),
  CONSTRAINT chk_custom_field_values_text_length CHECK (
    value_text IS NULL OR char_length(value_text) BETWEEN 1 AND 2000
  ),
  CONSTRAINT chk_custom_field_values_select_length CHECK (
    value_select IS NULL OR char_length(value_select) BETWEEN 1 AND 64
  ),
  CONSTRAINT fk_custom_field_values_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_custom_field_values_field_workspace
    FOREIGN KEY (field_id, workspace_id)
    REFERENCES public.custom_field_definitions (id, workspace_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.custom_field_values IS
  'Typed CRM custom field values per contact. Distinct from contacts.custom_attributes_json (host identify).';

CREATE INDEX idx_custom_field_values_workspace_field
  ON public.custom_field_values (workspace_id, field_id);

CREATE INDEX idx_custom_field_values_workspace_contact
  ON public.custom_field_values (workspace_id, contact_id);

CREATE TRIGGER trg_custom_field_values_set_updated_at
  BEFORE UPDATE ON public.custom_field_values
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Alter contacts: CRM profile columns + search_vector
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS company_id uuid,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS locale text,
  ADD COLUMN IF NOT EXISTS country_code char(2),
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

COMMENT ON COLUMN public.contacts.company_id IS
  'Optional company in the same workspace. Cleared when company soft-deleted or unlinked.';
COMMENT ON COLUMN public.contacts.job_title IS
  'Optional job title (max 120). Operator CRM field.';
COMMENT ON COLUMN public.contacts.locale IS
  'Optional BCP47-ish locale string (max 35). Profile preference, not session language.';
COMMENT ON COLUMN public.contacts.country_code IS
  'Optional ISO 3166-1 alpha-2 country (A-Z). Profile field; distinct from visitor_sessions.country_code.';
COMMENT ON COLUMN public.contacts.search_vector IS
  'Trigger-maintained FTS vector (name/email/phone/job_title + company + tags + custom text). Prep for PR #32.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_contacts_job_title_length'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_job_title_length
      CHECK (job_title IS NULL OR char_length(job_title) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_contacts_locale_length'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_locale_length
      CHECK (locale IS NULL OR char_length(locale) BETWEEN 1 AND 35);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_contacts_country_code'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT chk_contacts_country_code
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_contacts_company_workspace'
      AND conrelid = 'public.contacts'::regclass
  ) THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT fk_contacts_company_workspace
      FOREIGN KEY (company_id, workspace_id)
      REFERENCES public.companies (id, workspace_id)
      ON DELETE SET NULL (company_id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_last_seen
  ON public.contacts (workspace_id, last_seen_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_company
  ON public.contacts (workspace_id, company_id)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_job_title
  ON public.contacts (workspace_id, job_title)
  WHERE job_title IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_country_code
  ON public.contacts (workspace_id, country_code)
  WHERE country_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_search_vector
  ON public.contacts USING gin (search_vector);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies REPLICA IDENTITY FULL;
ALTER TABLE public.contact_tags REPLICA IDENTITY FULL;
ALTER TABLE public.contact_tag_assignments REPLICA IDENTITY FULL;
ALTER TABLE public.custom_field_definitions REPLICA IDENTITY FULL;
ALTER TABLE public.custom_field_values REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'companies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'contact_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_tags;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'contact_tag_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contact_tag_assignments;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'custom_field_definitions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.custom_field_definitions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'custom_field_values'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.custom_field_values;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeline taxonomy: CRM events
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_timeline_events
  DROP CONSTRAINT IF EXISTS chk_customer_timeline_events_event_type;

ALTER TABLE public.customer_timeline_events
  ADD CONSTRAINT chk_customer_timeline_events_event_type CHECK (
    event_type IN (
      'page_viewed',
      'conversation_started',
      'visitor_message_sent',
      'operator_message_sent',
      'attachment_uploaded',
      'visitor_identified',
      'visitor_profile_updated',
      'conversation_status_changed',
      'conversation_assigned',
      'conversation_transferred',
      'conversation_unassigned',
      'internal_note_created',
      'internal_note_updated',
      'internal_note_deleted',
      'mention_created',
      'tag_added',
      'tag_removed',
      'company_linked',
      'company_unlinked',
      'custom_field_updated'
    )
  );

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.require_crm_read_access(p_workspace_id uuid)
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

CREATE OR REPLACE FUNCTION app_private.require_crm_write_access(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.require_messaging_role(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.require_crm_definitions_manage(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  v_role := app_private.require_crm_read_access(p_workspace_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only owners and admins can manage custom field definitions.';
  END IF;
  RETURN v_role;
END;
$$;

-- ---------------------------------------------------------------------------
-- Normalize helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.strip_html_plain(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    ELSE btrim(
      regexp_replace(
        regexp_replace(p_value, E'<[^>]*>', '', 'g'),
        E'[\\x00-\\x1F\\x7F]',
        '',
        'g'
      )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_tag_name(p_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := app_private.bounded_text(app_private.strip_html_plain(p_name), 64);
  IF v_name IS NULL OR char_length(v_name) < 1 THEN
    RAISE EXCEPTION 'TAG_NAME_REQUIRED: Tag name is required (1–64 characters).';
  END IF;
  RETURN v_name;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_tag_color(p_color text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_color text;
BEGIN
  v_color := upper(btrim(COALESCE(p_color, '')));
  IF v_color !~ '^#[0-9A-F]{6}$' THEN
    RAISE EXCEPTION 'INVALID_COLOR: Color must be a #RRGGBB hex value.';
  END IF;
  RETURN v_color;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_company_domain(p_domain text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_domain text;
BEGIN
  IF p_domain IS NULL THEN
    RETURN NULL;
  END IF;

  v_domain := lower(btrim(app_private.strip_html_plain(p_domain)));
  IF v_domain IS NULL OR v_domain = '' THEN
    RETURN NULL;
  END IF;

  -- Strip scheme / path if an operator pastes a URL.
  v_domain := regexp_replace(v_domain, '^https?://', '');
  v_domain := split_part(v_domain, '/', 1);
  v_domain := split_part(v_domain, '?', 1);
  v_domain := btrim(v_domain, '.');

  IF v_domain = '' THEN
    RETURN NULL;
  END IF;

  IF char_length(v_domain) > 253 THEN
    RAISE EXCEPTION 'INVALID_DOMAIN: Domain must be at most 253 characters.';
  END IF;

  IF v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' THEN
    RAISE EXCEPTION 'INVALID_DOMAIN: Domain format is invalid.';
  END IF;

  RETURN v_domain;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_company_website(p_website text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_website text;
BEGIN
  IF p_website IS NULL THEN
    RETURN NULL;
  END IF;

  v_website := app_private.sanitize_page_url(p_website);
  IF v_website IS NULL THEN
    -- Allow empty clear; reject non-empty invalid.
    IF NULLIF(btrim(p_website), '') IS NULL THEN
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'INVALID_WEBSITE: Website must be a valid http(s) URL.';
  END IF;

  IF char_length(v_website) > 2048 THEN
    RAISE EXCEPTION 'INVALID_WEBSITE: Website must be at most 2048 characters.';
  END IF;

  RETURN v_website;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_country_code(p_code text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_code text;
BEGIN
  IF p_code IS NULL THEN
    RETURN NULL;
  END IF;

  v_code := upper(btrim(p_code));
  IF v_code = '' THEN
    RETURN NULL;
  END IF;

  IF v_code !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'INVALID_COUNTRY_CODE: Country code must be a 2-letter ISO code.';
  END IF;

  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_custom_field_key(p_key text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := lower(btrim(COALESCE(p_key, '')));
  IF v_key !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'INVALID_FIELD_KEY: Key must match ^[a-z][a-z0-9_]{0,63}$.';
  END IF;
  RETURN v_key;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_company_size(p_size text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_size text;
BEGIN
  IF p_size IS NULL THEN
    RETURN NULL;
  END IF;

  v_size := btrim(p_size);
  IF v_size = '' THEN
    RETURN NULL;
  END IF;

  IF v_size NOT IN ('1-10', '11-50', '51-200', '201-500', '501-1000', '1001+') THEN
    RAISE EXCEPTION 'INVALID_COMPANY_SIZE: Size must be one of 1-10, 11-50, 51-200, 201-500, 501-1000, 1001+.';
  END IF;

  RETURN v_size;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_select_options(p_options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_text text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF p_options IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF jsonb_typeof(p_options) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: options must be a JSON array of strings.';
  END IF;

  IF jsonb_array_length(p_options) > 50 THEN
    RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: At most 50 select options are allowed.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_options)
  LOOP
    IF jsonb_typeof(v_item) <> 'string' THEN
      RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: Each option must be a string.';
    END IF;

    v_text := app_private.bounded_text(app_private.strip_html_plain(v_item #>> '{}'), 64);
    IF v_text IS NULL THEN
      RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: Option strings must be 1–64 characters.';
    END IF;

    IF v_text = ANY (v_seen) THEN
      CONTINUE;
    END IF;

    v_seen := array_append(v_seen, v_text);
    v_out := v_out || jsonb_build_array(v_text);
  END LOOP;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Search vector maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.refresh_contact_search_vector(p_contact_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_company_name text;
  v_tag_names text;
  v_custom_text text;
  v_document text;
  v_vector tsvector;
BEGIN
  IF p_contact_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT concat_ws(' ', co.name, co.domain)
  INTO v_company_name
  FROM public.companies co
  WHERE co.id = v_contact.company_id
    AND co.workspace_id = v_contact.workspace_id
    AND co.deleted_at IS NULL;

  SELECT string_agg(t.name, ' ' ORDER BY lower(t.name))
  INTO v_tag_names
  FROM public.contact_tag_assignments a
  INNER JOIN public.contact_tags t
    ON t.id = a.tag_id
   AND t.workspace_id = a.workspace_id
  WHERE a.contact_id = v_contact.id
    AND a.workspace_id = v_contact.workspace_id
    AND t.deleted_at IS NULL;

  SELECT string_agg(
    concat_ws(
      ' ',
      d.label,
      d.key,
      COALESCE(v.value_text, v.value_select, v.value_number::text, v.value_date::text)
    ),
    ' '
  )
  INTO v_custom_text
  FROM public.custom_field_values v
  INNER JOIN public.custom_field_definitions d
    ON d.id = v.field_id
   AND d.workspace_id = v.workspace_id
  WHERE v.contact_id = v_contact.id
    AND v.workspace_id = v_contact.workspace_id
    AND d.deleted_at IS NULL
    AND d.field_type IN ('text', 'select', 'number', 'date');

  v_document := concat_ws(
    ' ',
    v_contact.name,
    v_contact.email,
    v_contact.phone,
    v_contact.job_title,
    v_company_name,
    v_tag_names,
    v_custom_text
  );

  v_vector := to_tsvector('english', coalesce(v_document, ''));

  UPDATE public.contacts c
  SET search_vector = v_vector
  WHERE c.id = v_contact.id
    AND c.search_vector IS DISTINCT FROM v_vector;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_contacts_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.name IS NOT DISTINCT FROM NEW.name
     AND OLD.email IS NOT DISTINCT FROM NEW.email
     AND OLD.phone IS NOT DISTINCT FROM NEW.phone
     AND OLD.job_title IS NOT DISTINCT FROM NEW.job_title
     AND OLD.company_id IS NOT DISTINCT FROM NEW.company_id THEN
    RETURN NULL;
  END IF;

  PERFORM app_private.refresh_contact_search_vector(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_refresh_search_vector ON public.contacts;
CREATE TRIGGER trg_contacts_refresh_search_vector
  AFTER INSERT OR UPDATE OF name, email, phone, job_title, company_id
  ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_contacts_refresh_search_vector();

-- ---------------------------------------------------------------------------
-- Custom field value validation (joins definition)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.trg_custom_field_values_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_def public.custom_field_definitions;
  v_non_null_count integer;
BEGIN
  SELECT d.*
  INTO v_def
  FROM public.custom_field_definitions d
  WHERE d.id = NEW.field_id
    AND d.workspace_id = NEW.workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: Custom field definition not found.';
  END IF;

  IF v_def.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: Custom field definition is deleted.';
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM v_def.workspace_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Cross-workspace custom field value rejected.';
  END IF;

  v_non_null_count :=
    (NEW.value_text IS NOT NULL)::integer
    + (NEW.value_number IS NOT NULL)::integer
    + (NEW.value_boolean IS NOT NULL)::integer
    + (NEW.value_date IS NOT NULL)::integer
    + (NEW.value_select IS NOT NULL)::integer;

  IF v_non_null_count <> 1 THEN
    RAISE EXCEPTION 'INVALID_FIELD_VALUE: Exactly one typed value column must be set.';
  END IF;

  CASE v_def.field_type
    WHEN 'text' THEN
      IF NEW.value_text IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: text fields require value_text.';
      END IF;
    WHEN 'number' THEN
      IF NEW.value_number IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: number fields require value_number.';
      END IF;
    WHEN 'boolean' THEN
      IF NEW.value_boolean IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: boolean fields require value_boolean.';
      END IF;
    WHEN 'date' THEN
      IF NEW.value_date IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: date fields require value_date.';
      END IF;
    WHEN 'select' THEN
      IF NEW.value_select IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: select fields require value_select.';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_def.options_json) opt(val)
        WHERE opt.val = NEW.value_select
      ) THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: select value is not in options.';
      END IF;
    ELSE
      RAISE EXCEPTION 'INVALID_FIELD_VALUE: Unknown field type.';
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_field_values_validate ON public.custom_field_values;
CREATE TRIGGER trg_custom_field_values_validate
  BEFORE INSERT OR UPDATE ON public.custom_field_values
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_custom_field_values_validate();

-- ---------------------------------------------------------------------------
-- JSON builders
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.company_json(p_company public.companies)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_company.id IS NULL OR p_company.deleted_at IS NOT NULL THEN NULL
    ELSE jsonb_build_object(
      'id', p_company.id,
      'name', p_company.name,
      'domain', p_company.domain,
      'website', p_company.website,
      'industry', p_company.industry,
      'size', p_company.size
    )
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.contact_tag_json(p_tag public.contact_tags)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_tag.id,
    'name', p_tag.name,
    'color', p_tag.color
  );
$$;

CREATE OR REPLACE FUNCTION app_private.custom_field_definition_json(
  p_def public.custom_field_definitions
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_def.id,
    'key', p_def.key,
    'label', p_def.label,
    'field_type', p_def.field_type,
    'options', COALESCE(p_def.options_json, '[]'::jsonb),
    'sort_order', p_def.sort_order,
    'is_required', p_def.is_required,
    'created_at', p_def.created_at,
    'updated_at', p_def.updated_at,
    'deleted_at', p_def.deleted_at
  );
$$;

CREATE OR REPLACE FUNCTION app_private.custom_field_value_as_jsonb(
  p_def public.custom_field_definitions,
  p_value public.custom_field_values
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_value.id IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_def.field_type
    WHEN 'text' THEN
      RETURN to_jsonb(p_value.value_text);
    WHEN 'number' THEN
      RETURN to_jsonb(p_value.value_number);
    WHEN 'boolean' THEN
      RETURN to_jsonb(p_value.value_boolean);
    WHEN 'date' THEN
      RETURN to_jsonb(p_value.value_date);
    WHEN 'select' THEN
      RETURN to_jsonb(p_value.value_select);
    ELSE
      RETURN NULL;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.build_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_company public.companies;
  v_tags jsonb := '[]'::jsonb;
  v_custom_fields jsonb := '[]'::jsonb;
  v_conversation_count integer := 0;
  v_attachment_count integer := 0;
  v_assignee jsonb := NULL;
  v_device jsonb := NULL;
  v_member_id uuid;
  v_member_label text;
  v_session public.visitor_sessions;
BEGIN
  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  IF v_contact.company_id IS NOT NULL THEN
    SELECT co.*
    INTO v_company
    FROM public.companies co
    WHERE co.id = v_contact.company_id
      AND co.workspace_id = p_workspace_id
      AND co.deleted_at IS NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      app_private.contact_tag_json(t)
      ORDER BY lower(t.name), t.id
    ),
    '[]'::jsonb
  )
  INTO v_tags
  FROM public.contact_tag_assignments a
  INNER JOIN public.contact_tags t
    ON t.id = a.tag_id
   AND t.workspace_id = a.workspace_id
  WHERE a.workspace_id = p_workspace_id
    AND a.contact_id = p_contact_id
    AND t.deleted_at IS NULL;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'field_id', d.id,
        'key', d.key,
        'label', d.label,
        'field_type', d.field_type,
        'options', COALESCE(d.options_json, '[]'::jsonb),
        'value', app_private.custom_field_value_as_jsonb(d, v)
      )
      ORDER BY d.sort_order, lower(d.label), d.id
    ),
    '[]'::jsonb
  )
  INTO v_custom_fields
  FROM public.custom_field_definitions d
  LEFT JOIN public.custom_field_values v
    ON v.field_id = d.id
   AND v.workspace_id = d.workspace_id
   AND v.contact_id = p_contact_id
  WHERE d.workspace_id = p_workspace_id
    AND d.deleted_at IS NULL;

  SELECT count(*)::integer
  INTO v_conversation_count
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.contact_id = p_contact_id;

  SELECT count(*)::integer
  INTO v_attachment_count
  FROM public.message_attachments ma
  INNER JOIN public.conversations c
    ON c.id = ma.conversation_id
   AND c.workspace_id = ma.workspace_id
  WHERE c.workspace_id = p_workspace_id
    AND c.contact_id = p_contact_id;

  SELECT c.assigned_to
  INTO v_member_id
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.contact_id = p_contact_id
    AND c.status IN ('open', 'pending')
    AND c.assigned_to IS NOT NULL
  ORDER BY c.updated_at DESC, c.id DESC
  LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    v_member_label := COALESCE(
      app_private.member_display_label(v_member_id),
      'Former member'
    );
    v_assignee := jsonb_build_object(
      'member_id', v_member_id,
      'display_label', v_member_label
    );
  END IF;

  SELECT vs.*
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.workspace_id = p_workspace_id
    AND vs.contact_id = p_contact_id
  ORDER BY COALESCE(vs.last_seen_at, vs.updated_at) DESC, vs.id DESC
  LIMIT 1;

  IF FOUND THEN
    v_device := jsonb_build_object(
      'device_type', v_session.device_type,
      'browser_family', v_session.browser_family,
      'browser_version', v_session.browser_version,
      'os_family', v_session.os_family
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_contact.id,
    'public_id', v_contact.public_id,
    'name', v_contact.name,
    'email', v_contact.email,
    'phone', v_contact.phone,
    'job_title', v_contact.job_title,
    'locale', v_contact.locale,
    'country_code', v_contact.country_code,
    'attributes', COALESCE(v_contact.custom_attributes_json, '{}'::jsonb),
    'first_seen_at', v_contact.first_seen_at,
    'last_seen_at', v_contact.last_seen_at,
    'visit_count', v_contact.visit_count,
    'conversation_count', v_conversation_count,
    'attachment_count', v_attachment_count,
    'company', app_private.company_json(v_company),
    'tags', COALESCE(v_tags, '[]'::jsonb),
    'custom_fields', COALESCE(v_custom_fields, '[]'::jsonb),
    'current_assignee', v_assignee,
    'device_summary', v_device,
    'updated_at', v_contact.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.contact_profile_json(p_contact public.contacts)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.build_contact_profile(p_contact.workspace_id, p_contact.id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.contact_list_item_json(p_contact public.contacts)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company public.companies;
  v_tags jsonb := '[]'::jsonb;
BEGIN
  IF p_contact.company_id IS NOT NULL THEN
    SELECT co.*
    INTO v_company
    FROM public.companies co
    WHERE co.id = p_contact.company_id
      AND co.workspace_id = p_contact.workspace_id
      AND co.deleted_at IS NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      app_private.contact_tag_json(t)
      ORDER BY lower(t.name), t.id
    ),
    '[]'::jsonb
  )
  INTO v_tags
  FROM public.contact_tag_assignments a
  INNER JOIN public.contact_tags t
    ON t.id = a.tag_id
   AND t.workspace_id = a.workspace_id
  WHERE a.workspace_id = p_contact.workspace_id
    AND a.contact_id = p_contact.id
    AND t.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'id', p_contact.id,
    'public_id', p_contact.public_id,
    'name', p_contact.name,
    'email', p_contact.email,
    'phone', p_contact.phone,
    'job_title', p_contact.job_title,
    'locale', p_contact.locale,
    'country_code', p_contact.country_code,
    'company', app_private.company_json(v_company),
    'tags', COALESCE(v_tags, '[]'::jsonb),
    'first_seen_at', p_contact.first_seen_at,
    'last_seen_at', p_contact.last_seen_at,
    'visit_count', p_contact.visit_count,
    'updated_at', p_contact.updated_at
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- Profile RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.get_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);
  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.list_contacts(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_q text;
  v_company_id uuid;
  v_tag_ids uuid[] := ARRAY[]::uuid[];
  v_before_last_seen timestamptz;
  v_before_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
  v_tag jsonb;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 25);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');
  IF v_q IS NOT NULL AND char_length(v_q) > 200 THEN
    RAISE EXCEPTION 'INVALID_QUERY: Search query is too long.';
  END IF;

  IF NULLIF(p_query ->> 'company_id', '') IS NOT NULL THEN
    BEGIN
      v_company_id := (p_query ->> 'company_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_QUERY: company_id must be a uuid.';
    END;
  END IF;

  IF p_query ? 'tag_ids'
     AND p_query -> 'tag_ids' IS NOT NULL
     AND p_query -> 'tag_ids' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_query -> 'tag_ids') <> 'array' THEN
      RAISE EXCEPTION 'INVALID_QUERY: tag_ids must be an array of uuids.';
    END IF;
    FOR v_tag IN SELECT value FROM jsonb_array_elements(p_query -> 'tag_ids')
    LOOP
      BEGIN
        v_tag_ids := array_append(v_tag_ids, (v_tag #>> '{}')::uuid);
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'INVALID_QUERY: tag_ids must be an array of uuids.';
      END;
    END LOOP;
  END IF;

  IF p_query ? 'before'
     AND p_query -> 'before' IS NOT NULL
     AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_last_seen := (p_query -> 'before' ->> 'last_seen_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_last_seen IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_QUERY: Invalid before cursor.';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      app_private.contact_list_item_json(q.contact_row)
      ORDER BY q.last_seen_at DESC, q.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT c AS contact_row, c.last_seen_at, c.id
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND (v_company_id IS NULL OR c.company_id = v_company_id)
      AND (
        cardinality(v_tag_ids) = 0
        OR (
          SELECT count(DISTINCT a.tag_id)
          FROM public.contact_tag_assignments a
          INNER JOIN public.contact_tags t
            ON t.id = a.tag_id
           AND t.workspace_id = a.workspace_id
          WHERE a.workspace_id = p_workspace_id
            AND a.contact_id = c.id
            AND t.deleted_at IS NULL
            AND a.tag_id = ANY (v_tag_ids)
        ) = cardinality(v_tag_ids)
      )
      AND (
        v_q IS NULL
        OR c.search_vector @@ plainto_tsquery('english', v_q)
        OR c.name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.email ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.phone ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.job_title ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      AND (
        v_before_last_seen IS NULL
        OR (c.last_seen_at < v_before_last_seen)
        OR (c.last_seen_at = v_before_last_seen AND c.id < v_before_id)
      )
    ORDER BY c.last_seen_at DESC, c.id DESC
    LIMIT v_limit + 1
  ) q;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    SELECT jsonb_agg(value ORDER BY ord)
    INTO v_rows
    FROM (
      SELECT value, ord
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(value, ord)
      WHERE ord <= v_limit
    ) trimmed;
  END IF;

  IF v_has_more AND jsonb_array_length(v_rows) > 0 THEN
    v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
    v_next := jsonb_build_object(
      'last_seen_at', v_last ->> 'last_seen_at',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_rows, '[]'::jsonb),
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_before public.contacts;
  v_member_id uuid;
  v_name text;
  v_email text;
  v_phone text;
  v_job_title text;
  v_locale text;
  v_country_code char(2);
  v_company_id uuid;
  v_company public.companies;
  v_changes jsonb := '[]'::jsonb;
  v_old_company_id uuid;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH: patch must be an object.';
  END IF;

  IF NOT (
    p_patch ? 'name'
    OR p_patch ? 'email'
    OR p_patch ? 'phone'
    OR p_patch ? 'job_title'
    OR p_patch ? 'locale'
    OR p_patch ? 'country_code'
    OR p_patch ? 'company_id'
  ) THEN
    RAISE EXCEPTION 'INVALID_PATCH: At least one field is required.';
  END IF;

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  v_before := v_contact;
  v_old_company_id := v_contact.company_id;

  IF p_patch ? 'name' THEN
    IF p_patch -> 'name' = 'null'::jsonb THEN
      v_name := NULL;
    ELSE
      v_name := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'name'), 120);
    END IF;
  END IF;

  IF p_patch ? 'email' THEN
    IF p_patch -> 'email' = 'null'::jsonb THEN
      v_email := NULL;
    ELSE
      v_email := NULLIF(btrim(p_patch ->> 'email'), '');
      IF v_email IS NOT NULL THEN
        IF char_length(v_email) > 254 THEN
          RAISE EXCEPTION 'INVALID_EMAIL: Email is too long.';
        END IF;
        IF lower(v_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
          RAISE EXCEPTION 'INVALID_EMAIL: Invalid email format.';
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
      v_phone := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'phone'), 64);
    END IF;
  END IF;

  IF p_patch ? 'job_title' THEN
    IF p_patch -> 'job_title' = 'null'::jsonb THEN
      v_job_title := NULL;
    ELSE
      v_job_title := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'job_title'), 120);
    END IF;
  END IF;

  IF p_patch ? 'locale' THEN
    IF p_patch -> 'locale' = 'null'::jsonb THEN
      v_locale := NULL;
    ELSE
      v_locale := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'locale'), 35);
    END IF;
  END IF;

  IF p_patch ? 'country_code' THEN
    IF p_patch -> 'country_code' = 'null'::jsonb THEN
      v_country_code := NULL;
    ELSE
      v_country_code := app_private.normalize_country_code(p_patch ->> 'country_code');
    END IF;
  END IF;

  IF p_patch ? 'company_id' THEN
    IF p_patch -> 'company_id' = 'null'::jsonb OR NULLIF(p_patch ->> 'company_id', '') IS NULL THEN
      v_company_id := NULL;
    ELSE
      BEGIN
        v_company_id := (p_patch ->> 'company_id')::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'INVALID_COMPANY_ID: company_id must be a uuid or null.';
      END;

      SELECT co.*
      INTO v_company
      FROM public.companies co
      WHERE co.id = v_company_id
        AND co.workspace_id = p_workspace_id
        AND co.deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.contacts c
    SET
      name = CASE WHEN p_patch ? 'name' THEN v_name ELSE c.name END,
      email = CASE WHEN p_patch ? 'email' THEN v_email ELSE c.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE c.phone END,
      job_title = CASE WHEN p_patch ? 'job_title' THEN v_job_title ELSE c.job_title END,
      locale = CASE WHEN p_patch ? 'locale' THEN v_locale ELSE c.locale END,
      country_code = CASE WHEN p_patch ? 'country_code' THEN v_country_code ELSE c.country_code END,
      company_id = CASE WHEN p_patch ? 'company_id' THEN v_company_id ELSE c.company_id END,
      updated_at = now()
    WHERE c.id = v_contact.id
      AND c.workspace_id = p_workspace_id
    RETURNING * INTO v_contact;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'EMAIL_TAKEN: Email already belongs to another visitor in this workspace.';
  END;

  IF p_patch ? 'name' AND v_before.name IS DISTINCT FROM v_contact.name THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'name', 'from', v_before.name, 'to', v_contact.name)
    );
  END IF;
  IF p_patch ? 'email' AND v_before.email IS DISTINCT FROM v_contact.email THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'email', 'from', v_before.email, 'to', v_contact.email)
    );
  END IF;
  IF p_patch ? 'phone' AND v_before.phone IS DISTINCT FROM v_contact.phone THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'phone', 'from', v_before.phone, 'to', v_contact.phone)
    );
  END IF;
  IF p_patch ? 'job_title' AND v_before.job_title IS DISTINCT FROM v_contact.job_title THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'job_title', 'from', v_before.job_title, 'to', v_contact.job_title)
    );
  END IF;
  IF p_patch ? 'locale' AND v_before.locale IS DISTINCT FROM v_contact.locale THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'locale', 'from', v_before.locale, 'to', v_contact.locale)
    );
  END IF;
  IF p_patch ? 'country_code' AND v_before.country_code IS DISTINCT FROM v_contact.country_code THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'country_code', 'from', v_before.country_code, 'to', v_contact.country_code)
    );
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    PERFORM app_private.emit_customer_timeline_event(
      p_workspace_id,
      v_contact.id,
      'visitor_profile_updated',
      'operator',
      jsonb_build_object(
        'v', 1,
        'changes', v_changes,
        'source', 'operator'
      ),
      NULL,
      NULL,
      v_member_id,
      now(),
      'contact:' || v_contact.id::text || ':profile:' || md5(v_changes::text) || ':' || floor(extract(epoch FROM now()) * 1000)::text
    );
  END IF;

  IF p_patch ? 'company_id' AND v_old_company_id IS DISTINCT FROM v_contact.company_id THEN
    IF v_contact.company_id IS NOT NULL THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'company_linked',
        'operator',
        jsonb_build_object(
          'v', 1,
          'company_id', v_contact.company_id,
          'previous_company_id', v_old_company_id
        ),
        NULL,
        NULL,
        v_member_id,
        now(),
        NULL
      );
    ELSE
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'company_unlinked',
        'operator',
        jsonb_build_object(
          'v', 1,
          'previous_company_id', v_old_company_id
        ),
        NULL,
        NULL,
        v_member_id,
        now(),
        NULL
      );
    END IF;
  END IF;

  RETURN app_private.build_contact_profile(p_workspace_id, v_contact.id);
END;
$$;


-- ---------------------------------------------------------------------------
-- Tag RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_contact_tags(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_include_deleted boolean := false;
  v_q text;
  v_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_include_deleted := COALESCE((p_query ->> 'include_deleted')::boolean, false);
  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'color', t.color,
        'created_at', t.created_at,
        'updated_at', t.updated_at,
        'deleted_at', t.deleted_at
      )
      ORDER BY lower(t.name), t.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.contact_tags t
  WHERE t.workspace_id = p_workspace_id
    AND (v_include_deleted OR t.deleted_at IS NULL)
    AND (
      v_q IS NULL
      OR t.name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      OR v_q OPERATOR(extensions.<%) t.name
    );

  RETURN jsonb_build_object('items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_private.create_contact_tag(
  p_workspace_id uuid,
  p_name text,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_name text;
  v_color text;
  v_tag public.contact_tags;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  v_name := app_private.normalize_tag_name(p_name);
  v_color := app_private.normalize_tag_color(p_color);

  BEGIN
    INSERT INTO public.contact_tags (
      workspace_id, name, color, created_by, updated_by
    ) VALUES (
      p_workspace_id, v_name, v_color, v_member_id, v_member_id
    )
    RETURNING * INTO v_tag;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'TAG_NAME_TAKEN: A tag with this name already exists.';
  END;

  RETURN app_private.contact_tag_json(v_tag) || jsonb_build_object(
    'created_at', v_tag.created_at,
    'updated_at', v_tag.updated_at,
    'deleted_at', v_tag.deleted_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_contact_tag(
  p_workspace_id uuid,
  p_tag_id uuid,
  p_name text DEFAULT NULL,
  p_color text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_tag public.contact_tags;
  v_name text;
  v_color text;
  v_contact_ids uuid[];
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT t.*
  INTO v_tag
  FROM public.contact_tags t
  WHERE t.id = p_tag_id
    AND t.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR v_tag.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'TAG_NOT_FOUND: Tag not found.';
  END IF;

  v_name := CASE WHEN p_name IS NULL THEN v_tag.name ELSE app_private.normalize_tag_name(p_name) END;
  v_color := CASE WHEN p_color IS NULL THEN v_tag.color ELSE app_private.normalize_tag_color(p_color) END;

  IF v_name = v_tag.name AND v_color = v_tag.color THEN
    RETURN app_private.contact_tag_json(v_tag) || jsonb_build_object(
      'created_at', v_tag.created_at,
      'updated_at', v_tag.updated_at,
      'deleted_at', v_tag.deleted_at
    );
  END IF;

  BEGIN
    UPDATE public.contact_tags
    SET
      name = v_name,
      color = v_color,
      updated_by = v_member_id
    WHERE id = p_tag_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_tag;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'TAG_NAME_TAKEN: A tag with this name already exists.';
  END;

  IF p_name IS NOT NULL THEN
    SELECT array_agg(a.contact_id)
    INTO v_contact_ids
    FROM public.contact_tag_assignments a
    WHERE a.workspace_id = p_workspace_id
      AND a.tag_id = p_tag_id;

    IF v_contact_ids IS NOT NULL THEN
      PERFORM app_private.refresh_contact_search_vector(cid)
      FROM unnest(v_contact_ids) AS cid;
    END IF;
  END IF;

  RETURN app_private.contact_tag_json(v_tag) || jsonb_build_object(
    'created_at', v_tag.created_at,
    'updated_at', v_tag.updated_at,
    'deleted_at', v_tag.deleted_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_contact_tag(
  p_workspace_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_tag public.contact_tags;
  v_row record;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT t.*
  INTO v_tag
  FROM public.contact_tags t
  WHERE t.id = p_tag_id
    AND t.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAG_NOT_FOUND: Tag not found.';
  END IF;

  IF v_tag.deleted_at IS NOT NULL THEN
    RETURN app_private.contact_tag_json(v_tag) || jsonb_build_object(
      'created_at', v_tag.created_at,
      'updated_at', v_tag.updated_at,
      'deleted_at', v_tag.deleted_at
    );
  END IF;

  FOR v_row IN
    SELECT a.contact_id
    FROM public.contact_tag_assignments a
    WHERE a.workspace_id = p_workspace_id
      AND a.tag_id = p_tag_id
  LOOP
    DELETE FROM public.contact_tag_assignments a
    WHERE a.workspace_id = p_workspace_id
      AND a.tag_id = p_tag_id
      AND a.contact_id = v_row.contact_id;

    PERFORM app_private.emit_customer_timeline_event(
      p_workspace_id,
      v_row.contact_id,
      'tag_removed',
      'operator',
      jsonb_build_object(
        'v', 1,
        'tag_id', p_tag_id,
        'tag_name', v_tag.name,
        'source', 'tag_deleted'
      ),
      NULL,
      NULL,
      v_member_id,
      now(),
      NULL
    );

    PERFORM app_private.refresh_contact_search_vector(v_row.contact_id);
  END LOOP;

  UPDATE public.contact_tags
  SET
    deleted_at = now(),
    updated_by = v_member_id
  WHERE id = p_tag_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_tag;

  RETURN app_private.contact_tag_json(v_tag) || jsonb_build_object(
    'created_at', v_tag.created_at,
    'updated_at', v_tag.updated_at,
    'deleted_at', v_tag.deleted_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.assign_contact_tag(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_contact public.contacts;
  v_tag public.contact_tags;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  SELECT t.*
  INTO v_tag
  FROM public.contact_tags t
  WHERE t.id = p_tag_id
    AND t.workspace_id = p_workspace_id
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAG_NOT_FOUND: Tag not found.';
  END IF;

  -- Idempotent under concurrency: ON CONFLICT DO NOTHING avoids unique-violation
  -- races when two operators assign the same tag simultaneously.
  INSERT INTO public.contact_tag_assignments (
    workspace_id, contact_id, tag_id, assigned_by
  ) VALUES (
    p_workspace_id, p_contact_id, p_tag_id, v_member_id
  )
  ON CONFLICT (workspace_id, contact_id, tag_id) DO NOTHING;

  IF NOT FOUND THEN
    -- Already assigned (this session or a concurrent writer). No timeline spam.
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  PERFORM app_private.emit_customer_timeline_event(
    p_workspace_id,
    p_contact_id,
    'tag_added',
    'operator',
    jsonb_build_object(
      'v', 1,
      'tag_id', p_tag_id,
      'tag_name', v_tag.name,
      'tag_color', v_tag.color
    ),
    NULL,
    NULL,
    v_member_id,
    now(),
    NULL
  );

  PERFORM app_private.refresh_contact_search_vector(p_contact_id);
  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.unassign_contact_tag(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_contact public.contacts;
  v_tag public.contact_tags;
  v_deleted integer;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  SELECT t.*
  INTO v_tag
  FROM public.contact_tags t
  WHERE t.id = p_tag_id
    AND t.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAG_NOT_FOUND: Tag not found.';
  END IF;

  DELETE FROM public.contact_tag_assignments a
  WHERE a.workspace_id = p_workspace_id
    AND a.contact_id = p_contact_id
    AND a.tag_id = p_tag_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  PERFORM app_private.emit_customer_timeline_event(
    p_workspace_id,
    p_contact_id,
    'tag_removed',
    'operator',
    jsonb_build_object(
      'v', 1,
      'tag_id', p_tag_id,
      'tag_name', v_tag.name,
      'tag_color', v_tag.color
    ),
    NULL,
    NULL,
    v_member_id,
    now(),
    NULL
  );

  PERFORM app_private.refresh_contact_search_vector(p_contact_id);
  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Company RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_companies(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer;
  v_q text;
  v_before_name text;
  v_before_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 50);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 100 THEN
    v_limit := 100;
  END IF;

  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');

  IF p_query ? 'before'
     AND p_query -> 'before' IS NOT NULL
     AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_name := lower(p_query -> 'before' ->> 'name');
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_name IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_QUERY: Invalid before cursor.';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      app_private.company_json(q.company_row)
        || jsonb_build_object(
          'created_at', (q.company_row).created_at,
          'updated_at', (q.company_row).updated_at,
          'contact_count', q.contact_count
        )
      ORDER BY lower((q.company_row).name), (q.company_row).id
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT
      co AS company_row,
      (
        SELECT count(*)::integer
        FROM public.contacts c
        WHERE c.workspace_id = p_workspace_id
          AND c.company_id = co.id
      ) AS contact_count
    FROM public.companies co
    WHERE co.workspace_id = p_workspace_id
      AND co.deleted_at IS NULL
      AND (
        v_q IS NULL
        OR co.name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR coalesce(co.domain, '') ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR v_q OPERATOR(extensions.<%) co.name
      )
      AND (
        v_before_name IS NULL
        OR lower(co.name) > v_before_name
        OR (lower(co.name) = v_before_name AND co.id > v_before_id)
      )
    ORDER BY lower(co.name), co.id
    LIMIT v_limit + 1
  ) q;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    SELECT jsonb_agg(value ORDER BY ord)
    INTO v_rows
    FROM (
      SELECT value, ord
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(value, ord)
      WHERE ord <= v_limit
    ) trimmed;
  END IF;

  IF v_has_more AND jsonb_array_length(v_rows) > 0 THEN
    v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
    v_next := jsonb_build_object(
      'name', v_last ->> 'name',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_rows, '[]'::jsonb),
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_company(
  p_workspace_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_company public.companies;
  v_contact_count integer;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  SELECT co.*
  INTO v_company
  FROM public.companies co
  WHERE co.id = p_company_id
    AND co.workspace_id = p_workspace_id
    AND co.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
  END IF;

  SELECT count(*)::integer
  INTO v_contact_count
  FROM public.contacts c
  WHERE c.workspace_id = p_workspace_id
    AND c.company_id = p_company_id;

  RETURN app_private.company_json(v_company) || jsonb_build_object(
    'created_at', v_company.created_at,
    'updated_at', v_company.updated_at,
    'contact_count', v_contact_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.create_company(
  p_workspace_id uuid,
  p_name text,
  p_domain text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_size text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_name text;
  v_domain text;
  v_website text;
  v_industry text;
  v_size text;
  v_company public.companies;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_name := app_private.bounded_text(app_private.strip_html_plain(p_name), 200);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'COMPANY_NAME_REQUIRED: Company name is required (1–200 characters).';
  END IF;

  v_domain := app_private.normalize_company_domain(p_domain);
  v_website := app_private.normalize_company_website(p_website);
  v_industry := app_private.bounded_text(app_private.strip_html_plain(p_industry), 120);
  v_size := app_private.normalize_company_size(p_size);

  BEGIN
    INSERT INTO public.companies (
      workspace_id, name, domain, website, industry, size, created_by, updated_by
    ) VALUES (
      p_workspace_id, v_name, v_domain, v_website, v_industry, v_size, v_member_id, v_member_id
    )
    RETURNING * INTO v_company;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'COMPANY_DOMAIN_TAKEN: A company with this domain already exists.';
  END;

  RETURN app_private.company_json(v_company) || jsonb_build_object(
    'created_at', v_company.created_at,
    'updated_at', v_company.updated_at,
    'contact_count', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_company(
  p_workspace_id uuid,
  p_company_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_company public.companies;
  v_name text;
  v_domain text;
  v_website text;
  v_industry text;
  v_size text;
  v_name_changed boolean := false;
  v_contact_ids uuid[];
  v_contact_count integer;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH: patch must be an object.';
  END IF;

  SELECT co.*
  INTO v_company
  FROM public.companies co
  WHERE co.id = p_company_id
    AND co.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR v_company.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
  END IF;

  IF p_patch ? 'name' THEN
    v_name := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'name'), 200);
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'COMPANY_NAME_REQUIRED: Company name is required (1–200 characters).';
    END IF;
    v_name_changed := v_name IS DISTINCT FROM v_company.name;
  ELSE
    v_name := v_company.name;
  END IF;

  IF p_patch ? 'domain' THEN
    IF p_patch -> 'domain' = 'null'::jsonb THEN
      v_domain := NULL;
    ELSE
      v_domain := app_private.normalize_company_domain(p_patch ->> 'domain');
    END IF;
  ELSE
    v_domain := v_company.domain;
  END IF;

  IF p_patch ? 'website' THEN
    IF p_patch -> 'website' = 'null'::jsonb THEN
      v_website := NULL;
    ELSE
      v_website := app_private.normalize_company_website(p_patch ->> 'website');
    END IF;
  ELSE
    v_website := v_company.website;
  END IF;

  IF p_patch ? 'industry' THEN
    IF p_patch -> 'industry' = 'null'::jsonb THEN
      v_industry := NULL;
    ELSE
      v_industry := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'industry'), 120);
    END IF;
  ELSE
    v_industry := v_company.industry;
  END IF;

  IF p_patch ? 'size' THEN
    IF p_patch -> 'size' = 'null'::jsonb THEN
      v_size := NULL;
    ELSE
      v_size := app_private.normalize_company_size(p_patch ->> 'size');
    END IF;
  ELSE
    v_size := v_company.size;
  END IF;

  IF v_name = v_company.name
     AND v_domain IS NOT DISTINCT FROM v_company.domain
     AND v_website IS NOT DISTINCT FROM v_company.website
     AND v_industry IS NOT DISTINCT FROM v_company.industry
     AND v_size IS NOT DISTINCT FROM v_company.size THEN
    SELECT count(*)::integer
    INTO v_contact_count
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.company_id = p_company_id;

    RETURN app_private.company_json(v_company) || jsonb_build_object(
      'created_at', v_company.created_at,
      'updated_at', v_company.updated_at,
      'contact_count', v_contact_count
    );
  END IF;

  BEGIN
    UPDATE public.companies
    SET
      name = v_name,
      domain = v_domain,
      website = v_website,
      industry = v_industry,
      size = v_size,
      updated_by = v_member_id
    WHERE id = p_company_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_company;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'COMPANY_DOMAIN_TAKEN: A company with this domain already exists.';
  END;

  IF v_name_changed THEN
    SELECT array_agg(c.id)
    INTO v_contact_ids
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND c.company_id = p_company_id;

    IF v_contact_ids IS NOT NULL THEN
      PERFORM app_private.refresh_contact_search_vector(cid)
      FROM unnest(v_contact_ids) AS cid;
    END IF;
  END IF;

  SELECT count(*)::integer
  INTO v_contact_count
  FROM public.contacts c
  WHERE c.workspace_id = p_workspace_id
    AND c.company_id = p_company_id;

  RETURN app_private.company_json(v_company) || jsonb_build_object(
    'created_at', v_company.created_at,
    'updated_at', v_company.updated_at,
    'contact_count', v_contact_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_company(
  p_workspace_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_company public.companies;
  v_contact_ids uuid[];
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT co.*
  INTO v_company
  FROM public.companies co
  WHERE co.id = p_company_id
    AND co.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
  END IF;

  IF v_company.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_company.id,
      'name', v_company.name,
      'domain', v_company.domain,
      'website', v_company.website,
      'industry', v_company.industry,
      'size', v_company.size,
      'created_at', v_company.created_at,
      'updated_at', v_company.updated_at,
      'deleted_at', v_company.deleted_at,
      'contact_count', 0
    );
  END IF;

  SELECT array_agg(c.id)
  INTO v_contact_ids
  FROM public.contacts c
  WHERE c.workspace_id = p_workspace_id
    AND c.company_id = p_company_id;

  -- Soft delete does not fire FK ON DELETE; unlink contacts explicitly.
  -- Intentionally does NOT emit per-contact company_unlinked timeline events:
  -- bulk soft-delete would spam every linked contact's timeline. Explicit
  -- unlink_contact_company / update_contact_profile company_id=null still emit
  -- company_unlinked for the single contact being changed.
  UPDATE public.contacts c
  SET company_id = NULL, updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.company_id = p_company_id;

  UPDATE public.companies
  SET
    deleted_at = now(),
    updated_by = v_member_id
  WHERE id = p_company_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_company;

  IF v_contact_ids IS NOT NULL THEN
    PERFORM app_private.refresh_contact_search_vector(cid)
    FROM unnest(v_contact_ids) AS cid;
  END IF;

  RETURN jsonb_build_object(
    'id', v_company.id,
    'name', v_company.name,
    'domain', v_company.domain,
    'website', v_company.website,
    'industry', v_company.industry,
    'size', v_company.size,
    'created_at', v_company.created_at,
    'updated_at', v_company.updated_at,
    'deleted_at', v_company.deleted_at,
    'contact_count', 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.link_contact_company(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_contact public.contacts;
  v_company public.companies;
  v_old_company_id uuid;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  SELECT co.*
  INTO v_company
  FROM public.companies co
  WHERE co.id = p_company_id
    AND co.workspace_id = p_workspace_id
    AND co.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
  END IF;

  IF v_contact.company_id IS NOT DISTINCT FROM p_company_id THEN
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  v_old_company_id := v_contact.company_id;

  UPDATE public.contacts c
  SET company_id = p_company_id, updated_at = now()
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  RETURNING * INTO v_contact;

  PERFORM app_private.emit_customer_timeline_event(
    p_workspace_id,
    p_contact_id,
    'company_linked',
    'operator',
    jsonb_build_object(
      'v', 1,
      'company_id', p_company_id,
      'company_name', v_company.name,
      'previous_company_id', v_old_company_id
    ),
    NULL,
    NULL,
    v_member_id,
    now(),
    NULL
  );

  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.unlink_contact_company(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_contact public.contacts;
  v_old_company_id uuid;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  IF v_contact.company_id IS NULL THEN
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  v_old_company_id := v_contact.company_id;

  UPDATE public.contacts c
  SET company_id = NULL, updated_at = now()
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id;

  PERFORM app_private.emit_customer_timeline_event(
    p_workspace_id,
    p_contact_id,
    'company_unlinked',
    'operator',
    jsonb_build_object(
      'v', 1,
      'previous_company_id', v_old_company_id
    ),
    NULL,
    NULL,
    v_member_id,
    now(),
    NULL
  );

  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;


-- ---------------------------------------------------------------------------
-- Custom field definition + value RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_custom_field_definitions(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_items jsonb := '[]'::jsonb;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  SELECT COALESCE(
    jsonb_agg(
      app_private.custom_field_definition_json(d)
      ORDER BY d.sort_order, lower(d.label), d.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.custom_field_definitions d
  WHERE d.workspace_id = p_workspace_id
    AND d.deleted_at IS NULL;

  RETURN jsonb_build_object('items', COALESCE(v_items, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_private.create_custom_field_definition(
  p_workspace_id uuid,
  p_key text,
  p_label text,
  p_field_type text,
  p_options_json jsonb DEFAULT '[]'::jsonb,
  p_sort_order integer DEFAULT 0,
  p_is_required boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_key text;
  v_label text;
  v_type public.app_custom_field_type;
  v_options jsonb;
  v_sort integer;
  v_def public.custom_field_definitions;
BEGIN
  PERFORM app_private.require_crm_definitions_manage(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_key := app_private.normalize_custom_field_key(p_key);
  v_label := app_private.bounded_text(app_private.strip_html_plain(p_label), 120);
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'INVALID_FIELD_LABEL: Label is required (1–120 characters).';
  END IF;

  BEGIN
    v_type := lower(btrim(p_field_type))::public.app_custom_field_type;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_FIELD_TYPE: field_type must be text, number, boolean, date, or select.';
  END;

  IF v_type = 'select' THEN
    v_options := app_private.normalize_select_options(p_options_json);
    IF jsonb_array_length(v_options) < 1 THEN
      RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: select fields require at least one option.';
    END IF;
  ELSE
    v_options := '[]'::jsonb;
  END IF;

  v_sort := COALESCE(p_sort_order, 0);
  IF v_sort < -100000 OR v_sort > 100000 THEN
    RAISE EXCEPTION 'INVALID_SORT_ORDER: sort_order must be between -100000 and 100000.';
  END IF;

  BEGIN
    INSERT INTO public.custom_field_definitions (
      workspace_id, key, label, field_type, options_json, sort_order, is_required,
      created_by, updated_by
    ) VALUES (
      p_workspace_id, v_key, v_label, v_type, v_options, v_sort,
      COALESCE(p_is_required, false), v_member_id, v_member_id
    )
    RETURNING * INTO v_def;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'FIELD_KEY_TAKEN: A custom field with this key already exists.';
  END;

  RETURN app_private.custom_field_definition_json(v_def);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_custom_field_definition(
  p_workspace_id uuid,
  p_field_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_def public.custom_field_definitions;
  v_label text;
  v_options jsonb;
  v_sort integer;
  v_required boolean;
  v_contact_ids uuid[];
BEGIN
  PERFORM app_private.require_crm_definitions_manage(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PATCH: patch must be an object.';
  END IF;

  IF p_patch ? 'key' THEN
    RAISE EXCEPTION 'FIELD_KEY_IMMUTABLE: Custom field key cannot be changed after create.';
  END IF;

  IF p_patch ? 'field_type' THEN
    RAISE EXCEPTION 'FIELD_TYPE_IMMUTABLE: Custom field type cannot be changed after create.';
  END IF;

  SELECT d.*
  INTO v_def
  FROM public.custom_field_definitions d
  WHERE d.id = p_field_id
    AND d.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND OR v_def.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: Custom field definition not found.';
  END IF;

  IF p_patch ? 'label' THEN
    v_label := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'label'), 120);
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'INVALID_FIELD_LABEL: Label is required (1–120 characters).';
    END IF;
  ELSE
    v_label := v_def.label;
  END IF;

  IF p_patch ? 'options' OR p_patch ? 'options_json' THEN
    IF v_def.field_type <> 'select' THEN
      RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: options are only valid for select fields.';
    END IF;
    v_options := app_private.normalize_select_options(
      COALESCE(p_patch -> 'options', p_patch -> 'options_json')
    );
    IF jsonb_array_length(v_options) < 1 THEN
      RAISE EXCEPTION 'INVALID_FIELD_OPTIONS: select fields require at least one option.';
    END IF;
  ELSE
    v_options := v_def.options_json;
  END IF;

  IF p_patch ? 'sort_order' THEN
    v_sort := COALESCE((p_patch ->> 'sort_order')::integer, v_def.sort_order);
    IF v_sort < -100000 OR v_sort > 100000 THEN
      RAISE EXCEPTION 'INVALID_SORT_ORDER: sort_order must be between -100000 and 100000.';
    END IF;
  ELSE
    v_sort := v_def.sort_order;
  END IF;

  IF p_patch ? 'is_required' THEN
    v_required := COALESCE((p_patch ->> 'is_required')::boolean, v_def.is_required);
  ELSE
    v_required := v_def.is_required;
  END IF;

  IF v_label = v_def.label
     AND v_options = v_def.options_json
     AND v_sort = v_def.sort_order
     AND v_required = v_def.is_required THEN
    RETURN app_private.custom_field_definition_json(v_def);
  END IF;

  UPDATE public.custom_field_definitions
  SET
    label = v_label,
    options_json = v_options,
    sort_order = v_sort,
    is_required = v_required,
    updated_by = v_member_id
  WHERE id = p_field_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_def;

  -- Drop select values that are no longer in options.
  -- Capture affected contacts BEFORE delete so search_vector refresh includes
  -- contacts whose orphaned values were removed (otherwise stale option text remains).
  IF v_def.field_type = 'select' AND (p_patch ? 'options' OR p_patch ? 'options_json') THEN
    SELECT array_agg(DISTINCT v.contact_id)
    INTO v_contact_ids
    FROM public.custom_field_values v
    WHERE v.workspace_id = p_workspace_id
      AND v.field_id = p_field_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_def.options_json) opt(val)
        WHERE opt.val = v.value_select
      );

    DELETE FROM public.custom_field_values v
    WHERE v.workspace_id = p_workspace_id
      AND v.field_id = p_field_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_def.options_json) opt(val)
        WHERE opt.val = v.value_select
      );

    IF v_contact_ids IS NOT NULL THEN
      PERFORM app_private.refresh_contact_search_vector(cid)
      FROM unnest(v_contact_ids) AS cid;
    END IF;
  ELSIF p_patch ? 'label' THEN
    SELECT array_agg(DISTINCT v.contact_id)
    INTO v_contact_ids
    FROM public.custom_field_values v
    WHERE v.workspace_id = p_workspace_id
      AND v.field_id = p_field_id;

    IF v_contact_ids IS NOT NULL THEN
      PERFORM app_private.refresh_contact_search_vector(cid)
      FROM unnest(v_contact_ids) AS cid;
    END IF;
  END IF;

  RETURN app_private.custom_field_definition_json(v_def);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_custom_field_definition(
  p_workspace_id uuid,
  p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_def public.custom_field_definitions;
  v_contact_ids uuid[];
BEGIN
  PERFORM app_private.require_crm_definitions_manage(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT d.*
  INTO v_def
  FROM public.custom_field_definitions d
  WHERE d.id = p_field_id
    AND d.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: Custom field definition not found.';
  END IF;

  IF v_def.deleted_at IS NOT NULL THEN
    RETURN app_private.custom_field_definition_json(v_def);
  END IF;

  SELECT array_agg(DISTINCT v.contact_id)
  INTO v_contact_ids
  FROM public.custom_field_values v
  WHERE v.workspace_id = p_workspace_id
    AND v.field_id = p_field_id;

  DELETE FROM public.custom_field_values v
  WHERE v.workspace_id = p_workspace_id
    AND v.field_id = p_field_id;

  -- Soft-delete the definition. Values are hard-deleted above without per-contact
  -- custom_field_updated timeline events (bulk cleanup; avoids event spam).
  UPDATE public.custom_field_definitions
  SET
    deleted_at = now(),
    updated_by = v_member_id
  WHERE id = p_field_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_def;

  IF v_contact_ids IS NOT NULL THEN
    PERFORM app_private.refresh_contact_search_vector(cid)
    FROM unnest(v_contact_ids) AS cid;
  END IF;

  RETURN app_private.custom_field_definition_json(v_def);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.set_contact_custom_field_value(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_field_id uuid,
  p_value jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_contact public.contacts;
  v_def public.custom_field_definitions;
  v_existing public.custom_field_values;
  v_value_text text;
  v_value_number numeric;
  v_value_boolean boolean;
  v_value_date date;
  v_value_select text;
  v_from jsonb;
  v_to jsonb;
  v_clear boolean := false;
BEGIN
  PERFORM app_private.require_crm_write_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_contact
  FROM public.contacts c
  WHERE c.id = p_contact_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTACT_NOT_FOUND: Contact not found.';
  END IF;

  SELECT d.*
  INTO v_def
  FROM public.custom_field_definitions d
  WHERE d.id = p_field_id
    AND d.workspace_id = p_workspace_id
    AND d.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FIELD_NOT_FOUND: Custom field definition not found.';
  END IF;

  SELECT v.*
  INTO v_existing
  FROM public.custom_field_values v
  WHERE v.workspace_id = p_workspace_id
    AND v.contact_id = p_contact_id
    AND v.field_id = p_field_id
  FOR UPDATE;

  IF FOUND THEN
    v_from := app_private.custom_field_value_as_jsonb(v_def, v_existing);
  ELSE
    v_from := NULL;
  END IF;

  IF p_value IS NULL OR p_value = 'null'::jsonb THEN
    v_clear := true;
  END IF;

  IF v_clear THEN
    IF v_existing.id IS NULL THEN
      RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
    END IF;

    DELETE FROM public.custom_field_values v
    WHERE v.id = v_existing.id;

    PERFORM app_private.emit_customer_timeline_event(
      p_workspace_id,
      p_contact_id,
      'custom_field_updated',
      'operator',
      jsonb_build_object(
        'v', 1,
        'field_id', p_field_id,
        'key', v_def.key,
        'field_type', v_def.field_type,
        'from', v_from,
        'to', NULL
      ),
      NULL,
      NULL,
      v_member_id,
      now(),
      NULL
    );

    PERFORM app_private.refresh_contact_search_vector(p_contact_id);
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  CASE v_def.field_type
    WHEN 'text' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: text value must be a string.';
      END IF;
      v_value_text := app_private.bounded_text(app_private.strip_html_plain(p_value #>> '{}'), 2000);
      IF v_value_text IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: text value must be 1–2000 characters.';
      END IF;
      v_to := to_jsonb(v_value_text);

    WHEN 'number' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: number value must be a JSON number.';
      END IF;
      v_value_number := (p_value #>> '{}')::numeric;
      v_to := to_jsonb(v_value_number);

    WHEN 'boolean' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: boolean value must be a JSON boolean.';
      END IF;
      v_value_boolean := (p_value #>> '{}')::boolean;
      v_to := to_jsonb(v_value_boolean);

    WHEN 'date' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: date value must be an ISO date string (YYYY-MM-DD).';
      END IF;
      -- Strict calendar date only — reject Postgres relative tokens (today/tomorrow)
      -- and other non-ISO forms even when ::date would accept them.
      IF (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: date value must be YYYY-MM-DD.';
      END IF;
      BEGIN
        v_value_date := (p_value #>> '{}')::date;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'INVALID_FIELD_VALUE: date value must be a valid calendar date (YYYY-MM-DD).';
      END;
      -- Round-trip check: reject impossible dates like 2024-02-31 that coerce.
      IF to_char(v_value_date, 'YYYY-MM-DD') IS DISTINCT FROM (p_value #>> '{}') THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: date value must be a valid calendar date (YYYY-MM-DD).';
      END IF;
      v_to := to_jsonb(to_char(v_value_date, 'YYYY-MM-DD'));

    WHEN 'select' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: select value must be a string.';
      END IF;
      v_value_select := app_private.bounded_text(app_private.strip_html_plain(p_value #>> '{}'), 64);
      IF v_value_select IS NULL THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: select value is required.';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_def.options_json) opt(val)
        WHERE opt.val = v_value_select
      ) THEN
        RAISE EXCEPTION 'INVALID_FIELD_VALUE: select value is not in options.';
      END IF;
      v_to := to_jsonb(v_value_select);

    ELSE
      RAISE EXCEPTION 'INVALID_FIELD_TYPE: Unknown field type.';
  END CASE;

  IF v_from IS NOT DISTINCT FROM v_to THEN
    RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
  END IF;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.custom_field_values (
      workspace_id, contact_id, field_id,
      value_text, value_number, value_boolean, value_date, value_select
    ) VALUES (
      p_workspace_id, p_contact_id, p_field_id,
      v_value_text, v_value_number, v_value_boolean, v_value_date, v_value_select
    );
  ELSE
    UPDATE public.custom_field_values v
    SET
      value_text = v_value_text,
      value_number = v_value_number,
      value_boolean = v_value_boolean,
      value_date = v_value_date,
      value_select = v_value_select
    WHERE v.id = v_existing.id;
  END IF;

  PERFORM app_private.emit_customer_timeline_event(
    p_workspace_id,
    p_contact_id,
    'custom_field_updated',
    'operator',
    jsonb_build_object(
      'v', 1,
      'field_id', p_field_id,
      'key', v_def.key,
      'field_type', v_def.field_type,
      'from', v_from,
      'to', v_to
    ),
    NULL,
    NULL,
    v_member_id,
    now(),
    NULL
  );

  PERFORM app_private.refresh_contact_search_vector(p_contact_id);
  RETURN app_private.build_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.clear_contact_custom_field_value(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.set_contact_custom_field_value(
    p_workspace_id,
    p_contact_id,
    p_field_id,
    NULL
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- Extend update_visitor_profile for CRM patch keys (return shape unchanged)
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
  v_before public.contacts;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_e164 text;
  v_job_title text;
  v_locale text;
  v_country_code char(2);
  v_company_id uuid;
  v_company public.companies;
  v_changes jsonb := '[]'::jsonb;
  v_member_id uuid;
  v_old_company_id uuid;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch must be an object';
  END IF;

  IF NOT (
    p_patch ? 'name'
    OR p_patch ? 'email'
    OR p_patch ? 'phone'
    OR p_patch ? 'phone_e164'
    OR p_patch ? 'job_title'
    OR p_patch ? 'locale'
    OR p_patch ? 'country_code'
    OR p_patch ? 'company_id'
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

  v_before := v_contact;
  v_old_company_id := v_contact.company_id;

  IF p_patch ? 'name' THEN
    IF p_patch -> 'name' = 'null'::jsonb THEN
      v_name := NULL;
    ELSE
      v_name := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'name'), 120);
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
      v_phone := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'phone'), 64);
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

  IF p_patch ? 'job_title' THEN
    IF p_patch -> 'job_title' = 'null'::jsonb THEN
      v_job_title := NULL;
    ELSE
      v_job_title := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'job_title'), 120);
    END IF;
  END IF;

  IF p_patch ? 'locale' THEN
    IF p_patch -> 'locale' = 'null'::jsonb THEN
      v_locale := NULL;
    ELSE
      v_locale := app_private.bounded_text(app_private.strip_html_plain(p_patch ->> 'locale'), 35);
    END IF;
  END IF;

  IF p_patch ? 'country_code' THEN
    IF p_patch -> 'country_code' = 'null'::jsonb THEN
      v_country_code := NULL;
    ELSE
      v_country_code := app_private.normalize_country_code(p_patch ->> 'country_code');
    END IF;
  END IF;

  IF p_patch ? 'company_id' THEN
    IF p_patch -> 'company_id' = 'null'::jsonb OR NULLIF(p_patch ->> 'company_id', '') IS NULL THEN
      v_company_id := NULL;
    ELSE
      BEGIN
        v_company_id := (p_patch ->> 'company_id')::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'INVALID_COMPANY_ID: company_id must be a uuid or null.';
      END;

      SELECT co.*
      INTO v_company
      FROM public.companies co
      WHERE co.id = v_company_id
        AND co.workspace_id = p_workspace_id
        AND co.deleted_at IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'COMPANY_NOT_FOUND: Company not found.';
      END IF;
    END IF;
  END IF;

  BEGIN
    UPDATE public.contacts c
    SET
      name = CASE WHEN p_patch ? 'name' THEN v_name ELSE c.name END,
      email = CASE WHEN p_patch ? 'email' THEN v_email ELSE c.email END,
      phone = CASE WHEN p_patch ? 'phone' THEN v_phone ELSE c.phone END,
      phone_e164 = CASE WHEN p_patch ? 'phone_e164' THEN v_phone_e164 ELSE c.phone_e164 END,
      job_title = CASE WHEN p_patch ? 'job_title' THEN v_job_title ELSE c.job_title END,
      locale = CASE WHEN p_patch ? 'locale' THEN v_locale ELSE c.locale END,
      country_code = CASE WHEN p_patch ? 'country_code' THEN v_country_code ELSE c.country_code END,
      company_id = CASE WHEN p_patch ? 'company_id' THEN v_company_id ELSE c.company_id END,
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

  IF p_patch ? 'name' AND v_before.name IS DISTINCT FROM v_contact.name THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'name', 'from', v_before.name, 'to', v_contact.name)
    );
  END IF;
  IF p_patch ? 'email' AND v_before.email IS DISTINCT FROM v_contact.email THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'email', 'from', v_before.email, 'to', v_contact.email)
    );
  END IF;
  IF p_patch ? 'phone' AND v_before.phone IS DISTINCT FROM v_contact.phone THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'phone', 'from', v_before.phone, 'to', v_contact.phone)
    );
  END IF;
  IF p_patch ? 'job_title' AND v_before.job_title IS DISTINCT FROM v_contact.job_title THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'job_title', 'from', v_before.job_title, 'to', v_contact.job_title)
    );
  END IF;
  IF p_patch ? 'locale' AND v_before.locale IS DISTINCT FROM v_contact.locale THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'locale', 'from', v_before.locale, 'to', v_contact.locale)
    );
  END IF;
  IF p_patch ? 'country_code' AND v_before.country_code IS DISTINCT FROM v_contact.country_code THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'country_code', 'from', v_before.country_code, 'to', v_contact.country_code)
    );
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    PERFORM app_private.emit_customer_timeline_event(
      p_workspace_id,
      v_contact.id,
      'visitor_profile_updated',
      'operator',
      jsonb_build_object(
        'v', 1,
        'changes', v_changes,
        'source', 'operator'
      ),
      v_conversation.visitor_session_id,
      v_conversation.id,
      v_member_id,
      now(),
      'contact:' || v_contact.id::text || ':profile:' || md5(v_changes::text) || ':' || floor(extract(epoch FROM now()) * 1000)::text
    );
  END IF;

  IF p_patch ? 'company_id' AND v_old_company_id IS DISTINCT FROM v_contact.company_id THEN
    IF v_contact.company_id IS NOT NULL THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'company_linked',
        'operator',
        jsonb_build_object(
          'v', 1,
          'company_id', v_contact.company_id,
          'previous_company_id', v_old_company_id
        ),
        v_conversation.visitor_session_id,
        v_conversation.id,
        v_member_id,
        now(),
        NULL
      );
    ELSE
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'company_unlinked',
        'operator',
        jsonb_build_object(
          'v', 1,
          'previous_company_id', v_old_company_id
        ),
        v_conversation.visitor_session_id,
        v_conversation.id,
        v_member_id,
        now(),
        NULL
      );
    END IF;
  END IF;

  -- Backward compatible: still returns visitorProfileSchema shape (no CRM extras).
  RETURN app_private.visitor_profile_json(v_contact);
END;
$$;

COMMENT ON FUNCTION app_private.update_visitor_profile(uuid, uuid, jsonb) IS
  'Operator profile patch. Accepts name/email/phone/phone_e164 plus CRM keys '
  'job_title/locale/country_code/company_id. Emits visitor_profile_updated and '
  'company_linked/unlinked only on real changes. Does not bump last_seen_at. '
  'Returns visitorProfileSchema JSON (unchanged shape for conversation sidebar).';

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_contact_profile(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_contacts(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_contacts(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_contact_profile(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_contact_profile(p_workspace_id, p_contact_id, p_patch);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_contact_tags(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_contact_tags(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_contact_tag(
  p_workspace_id uuid,
  p_name text,
  p_color text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_contact_tag(p_workspace_id, p_name, p_color);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_contact_tag(
  p_workspace_id uuid,
  p_tag_id uuid,
  p_name text DEFAULT NULL,
  p_color text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_contact_tag(p_workspace_id, p_tag_id, p_name, p_color);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_contact_tag(
  p_workspace_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_contact_tag(p_workspace_id, p_tag_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_contact_tag(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.assign_contact_tag(p_workspace_id, p_contact_id, p_tag_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_contact_tag(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_tag_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.unassign_contact_tag(p_workspace_id, p_contact_id, p_tag_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_companies(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_companies(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_company(
  p_workspace_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_company(p_workspace_id, p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_company(
  p_workspace_id uuid,
  p_name text,
  p_domain text DEFAULT NULL,
  p_website text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_size text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_company(
    p_workspace_id, p_name, p_domain, p_website, p_industry, p_size
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_company(
  p_workspace_id uuid,
  p_company_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_company(p_workspace_id, p_company_id, p_patch);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_company(
  p_workspace_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_company(p_workspace_id, p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.link_contact_company(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_company_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.link_contact_company(p_workspace_id, p_contact_id, p_company_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_contact_company(
  p_workspace_id uuid,
  p_contact_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.unlink_contact_company(p_workspace_id, p_contact_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_custom_field_definitions(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_custom_field_definitions(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_custom_field_definition(
  p_workspace_id uuid,
  p_key text,
  p_label text,
  p_field_type text,
  p_options_json jsonb DEFAULT '[]'::jsonb,
  p_sort_order integer DEFAULT 0,
  p_is_required boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_custom_field_definition(
    p_workspace_id, p_key, p_label, p_field_type, p_options_json, p_sort_order, p_is_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_custom_field_definition(
  p_workspace_id uuid,
  p_field_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_custom_field_definition(p_workspace_id, p_field_id, p_patch);
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_custom_field_definition(
  p_workspace_id uuid,
  p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_custom_field_definition(p_workspace_id, p_field_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_contact_custom_field_value(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_field_id uuid,
  p_value jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.set_contact_custom_field_value(
    p_workspace_id, p_contact_id, p_field_id, p_value
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_contact_custom_field_value(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.clear_contact_custom_field_value(
    p_workspace_id, p_contact_id, p_field_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: public wrappers
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.get_contact_profile(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_contact_profile(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_contact_profile(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_contacts(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_contacts(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_contacts(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.update_contact_profile(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_contact_profile(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_contact_profile(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_contact_tags(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_contact_tags(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_contact_tags(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.create_contact_tag(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_contact_tag(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_contact_tag(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_contact_tag(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_contact_tag(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_contact_tag(uuid, uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_contact_tag(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_contact_tag(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_contact_tag(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_contact_tag(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_contact_tag(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_contact_tag(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.unassign_contact_tag(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unassign_contact_tag(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unassign_contact_tag(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_companies(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_companies(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_companies(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_company(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_company(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_company(uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_company(uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_company(uuid, text, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.update_company(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_company(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_company(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_company(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_company(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.link_contact_company(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_contact_company(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_contact_company(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.unlink_contact_company(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlink_contact_company(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlink_contact_company(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_custom_field_definitions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_custom_field_definitions(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_custom_field_definitions(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_custom_field_definition(uuid, text, text, text, jsonb, integer, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.update_custom_field_definition(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_custom_field_definition(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_custom_field_definition(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_custom_field_definition(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_custom_field_definition(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_custom_field_definition(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.set_contact_custom_field_value(uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_contact_custom_field_value(uuid, uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_contact_custom_field_value(uuid, uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.clear_contact_custom_field_value(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_contact_custom_field_value(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_contact_custom_field_value(uuid, uuid, uuid) TO authenticated;

-- update_visitor_profile already granted to authenticated; reaffirm after replace.
REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_visitor_profile(uuid, uuid, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS: SELECT for accessible members; no direct writes
-- ---------------------------------------------------------------------------

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;

ALTER TABLE public.contact_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tags FORCE ROW LEVEL SECURITY;

ALTER TABLE public.contact_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_tag_assignments FORCE ROW LEVEL SECURITY;

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_definitions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_field_values FORCE ROW LEVEL SECURITY;

CREATE POLICY companies_select_authenticated
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY contact_tags_select_authenticated
  ON public.contact_tags
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY contact_tag_assignments_select_authenticated
  ON public.contact_tag_assignments
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY custom_field_definitions_select_authenticated
  ON public.custom_field_definitions
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY custom_field_values_select_authenticated
  ON public.custom_field_values
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

REVOKE ALL ON TABLE public.companies FROM PUBLIC;
REVOKE ALL ON TABLE public.companies FROM anon;
REVOKE ALL ON TABLE public.companies FROM authenticated;
GRANT SELECT ON TABLE public.companies TO authenticated;

REVOKE ALL ON TABLE public.contact_tags FROM PUBLIC;
REVOKE ALL ON TABLE public.contact_tags FROM anon;
REVOKE ALL ON TABLE public.contact_tags FROM authenticated;
GRANT SELECT ON TABLE public.contact_tags TO authenticated;

REVOKE ALL ON TABLE public.contact_tag_assignments FROM PUBLIC;
REVOKE ALL ON TABLE public.contact_tag_assignments FROM anon;
REVOKE ALL ON TABLE public.contact_tag_assignments FROM authenticated;
GRANT SELECT ON TABLE public.contact_tag_assignments TO authenticated;

REVOKE ALL ON TABLE public.custom_field_definitions FROM PUBLIC;
REVOKE ALL ON TABLE public.custom_field_definitions FROM anon;
REVOKE ALL ON TABLE public.custom_field_definitions FROM authenticated;
GRANT SELECT ON TABLE public.custom_field_definitions TO authenticated;

REVOKE ALL ON TABLE public.custom_field_values FROM PUBLIC;
REVOKE ALL ON TABLE public.custom_field_values FROM anon;
REVOKE ALL ON TABLE public.custom_field_values FROM authenticated;
GRANT SELECT ON TABLE public.custom_field_values TO authenticated;

-- ---------------------------------------------------------------------------
-- Lock down app_private EXECUTE after CREATE OR REPLACE (repo standard)
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

-- Intentional helpers used by RLS policies / authenticated clients.
GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
