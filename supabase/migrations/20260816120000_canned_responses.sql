-- Canned responses (shared + personal snippets, folders, favorites)
-- Operator productivity entity: soft delete, shortcut autocomplete, fuzzy search,
-- usage counters and realtime catch-up.
-- See docs/CANNED-RESPONSES.md and docs/adr/ADR-007-canned-responses.md.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

-- Trigram similarity powers the composer's typo-tolerant snippet search.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Enum: canned response visibility
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'app_canned_visibility'
  ) THEN
    CREATE TYPE public.app_canned_visibility AS ENUM (
      'workspace',
      'personal'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.canned_response_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  visibility public.app_canned_visibility NOT NULL,
  owner_member_id uuid,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_canned_response_folders_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_canned_response_folders_name_length CHECK (
    char_length(name) >= 1 AND char_length(name) <= 100
  ),
  CONSTRAINT chk_canned_response_folders_owner_visibility CHECK (
    (visibility = 'workspace' AND owner_member_id IS NULL)
    OR (visibility = 'personal' AND owner_member_id IS NOT NULL)
  ),
  -- Personal data leaves with the member: personal folders are removed when the
  -- owning membership row is deleted.
  CONSTRAINT fk_canned_response_folders_owner_workspace
    FOREIGN KEY (owner_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE,
  -- Authorship is column-scoped SET NULL so shared folders survive member removal.
  CONSTRAINT fk_canned_response_folders_created_by_workspace
    FOREIGN KEY (created_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT fk_canned_response_folders_updated_by_workspace
    FOREIGN KEY (updated_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (updated_by)
);

COMMENT ON TABLE public.canned_response_folders IS
  'Grouping for canned responses. Shared (workspace) folders are managed by owner/admin; personal folders belong to one member.';
COMMENT ON COLUMN public.canned_response_folders.visibility IS
  'workspace = shared with the whole workspace; personal = private to owner_member_id.';
COMMENT ON COLUMN public.canned_response_folders.owner_member_id IS
  'NULL for workspace folders, required for personal folders. Personal folders cascade-delete with the member.';
COMMENT ON COLUMN public.canned_response_folders.sort_order IS
  'Manual ordering hint; ties break on name.';
COMMENT ON COLUMN public.canned_response_folders.created_by IS
  'Creating member. Nullable only after member removal so shared folders survive.';
COMMENT ON COLUMN public.canned_response_folders.updated_by IS
  'Member of the last edit. NULL when never edited or after member removal.';
COMMENT ON COLUMN public.canned_response_folders.deleted_at IS
  'Soft delete. Listed rows require deleted_at IS NULL.';

CREATE INDEX idx_canned_response_folders_workspace_active
  ON public.canned_response_folders (workspace_id, visibility, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_canned_response_folders_owner_active
  ON public.canned_response_folders (workspace_id, owner_member_id, sort_order, name)
  WHERE deleted_at IS NULL AND visibility = 'personal';

-- Supports the owner FK cascade when a membership row is deleted.
CREATE INDEX idx_canned_response_folders_owner_member
  ON public.canned_response_folders (owner_member_id)
  WHERE owner_member_id IS NOT NULL;

-- Tombstone / catch-up scans. Soft delete bumps updated_at via
-- trg_canned_response_folders_set_updated_at.
CREATE INDEX idx_canned_response_folders_tombstones
  ON public.canned_response_folders (workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;

CREATE TRIGGER trg_canned_response_folders_set_updated_at
  BEFORE UPDATE ON public.canned_response_folders
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.canned_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  visibility public.app_canned_visibility NOT NULL,
  owner_member_id uuid,
  folder_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  shortcut text,
  usage_count integer NOT NULL DEFAULT 0,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(shortcut, '') || ' ' || coalesce(body, '')
    )
  ) STORED,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_canned_responses_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_canned_responses_title_length CHECK (
    char_length(title) >= 1 AND char_length(title) <= 200
  ),
  CONSTRAINT chk_canned_responses_body_length CHECK (
    char_length(body) >= 1 AND char_length(body) <= 4000
  ),
  CONSTRAINT chk_canned_responses_shortcut_format CHECK (
    shortcut IS NULL OR shortcut ~ '^[a-z0-9][a-z0-9_-]{0,63}$'
  ),
  CONSTRAINT chk_canned_responses_usage_count CHECK (usage_count >= 0),
  CONSTRAINT chk_canned_responses_owner_visibility CHECK (
    (visibility = 'workspace' AND owner_member_id IS NULL)
    OR (visibility = 'personal' AND owner_member_id IS NOT NULL)
  ),
  CONSTRAINT fk_canned_responses_owner_workspace
    FOREIGN KEY (owner_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_canned_responses_created_by_workspace
    FOREIGN KEY (created_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (created_by),
  CONSTRAINT fk_canned_responses_updated_by_workspace
    FOREIGN KEY (updated_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (updated_by),
  -- Hard folder deletion only happens through workspace cascade; soft delete is
  -- handled explicitly by soft_delete_canned_response_folder.
  CONSTRAINT fk_canned_responses_folder_workspace
    FOREIGN KEY (folder_id, workspace_id)
    REFERENCES public.canned_response_folders (id, workspace_id)
    ON DELETE SET NULL (folder_id)
);

COMMENT ON TABLE public.canned_responses IS
  'Reusable reply snippets. Shared (workspace) snippets are managed by owner/admin; personal snippets belong to one member.';
COMMENT ON COLUMN public.canned_responses.visibility IS
  'workspace = usable by every member; personal = visible only to owner_member_id.';
COMMENT ON COLUMN public.canned_responses.owner_member_id IS
  'NULL for workspace snippets, required for personal snippets. Personal snippets cascade-delete with the member.';
COMMENT ON COLUMN public.canned_responses.folder_id IS
  'Optional folder in the same workspace and the same visibility/owner scope. Cleared when the folder is soft-deleted.';
COMMENT ON COLUMN public.canned_responses.shortcut IS
  'Composer trigger stored WITHOUT the leading slash, lowercase (^[a-z0-9][a-z0-9_-]{0,63}$). Unique per workspace (shared) or per member (personal).';
COMMENT ON COLUMN public.canned_responses.usage_count IS
  'Incremented by record_canned_response_usage. Deliberately does not bump updated_at.';
COMMENT ON COLUMN public.canned_responses.search_vector IS
  'Generated FTS vector over title + shortcut + body, complemented by a trigram index for fuzzy search.';
COMMENT ON COLUMN public.canned_responses.created_by IS
  'Creating member. Nullable only after member removal so shared snippets survive.';
COMMENT ON COLUMN public.canned_responses.updated_by IS
  'Member of the last content edit. NULL when never edited or after member removal.';
COMMENT ON COLUMN public.canned_responses.deleted_at IS
  'Soft delete. Listed/searchable rows require deleted_at IS NULL.';

-- Shared shortcuts are unique workspace-wide; personal shortcuts are unique per
-- member, so a member may shadow a shared shortcut with their own.
CREATE UNIQUE INDEX uq_canned_responses_workspace_shortcut
  ON public.canned_responses (workspace_id, shortcut)
  WHERE deleted_at IS NULL AND visibility = 'workspace' AND shortcut IS NOT NULL;

CREATE UNIQUE INDEX uq_canned_responses_personal_shortcut
  ON public.canned_responses (workspace_id, owner_member_id, shortcut)
  WHERE deleted_at IS NULL AND visibility = 'personal' AND shortcut IS NOT NULL;

CREATE INDEX idx_canned_responses_workspace_active
  ON public.canned_responses (workspace_id, visibility, title, id)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_canned_responses_owner_active
  ON public.canned_responses (workspace_id, owner_member_id, title, id)
  WHERE deleted_at IS NULL AND visibility = 'personal';

CREATE INDEX idx_canned_responses_folder
  ON public.canned_responses (workspace_id, folder_id)
  WHERE deleted_at IS NULL AND folder_id IS NOT NULL;

-- Supports the owner FK cascade when a membership row is deleted.
CREATE INDEX idx_canned_responses_owner_member
  ON public.canned_responses (owner_member_id)
  WHERE owner_member_id IS NOT NULL;

CREATE INDEX idx_canned_responses_search_vector
  ON public.canned_responses USING gin (search_vector)
  WHERE deleted_at IS NULL;

-- Fuzzy composer search. The expression must match list_canned_responses
-- exactly for the index to be used.
CREATE INDEX idx_canned_responses_trgm
  ON public.canned_responses
  USING gin (
    (title || ' ' || coalesce(shortcut, '') || ' ' || body) extensions.gin_trgm_ops
  )
  WHERE deleted_at IS NULL;

CREATE INDEX idx_canned_responses_tombstones
  ON public.canned_responses (workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;

-- usage_count bumps intentionally do NOT touch updated_at: a hot snippet would
-- otherwise re-enter every catch-up window and broadcast a realtime UPDATE on
-- each insertion. Counters converge on the next full list.
CREATE TRIGGER trg_canned_responses_set_updated_at
  BEFORE UPDATE ON public.canned_responses
  FOR EACH ROW
  WHEN (
    OLD.title IS DISTINCT FROM NEW.title
    OR OLD.body IS DISTINCT FROM NEW.body
    OR OLD.shortcut IS DISTINCT FROM NEW.shortcut
    OR OLD.folder_id IS DISTINCT FROM NEW.folder_id
    OR OLD.visibility IS DISTINCT FROM NEW.visibility
    OR OLD.owner_member_id IS DISTINCT FROM NEW.owner_member_id
    OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at
  )
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.canned_response_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  canned_response_id uuid NOT NULL,
  member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_canned_response_favorites_member_response
    UNIQUE (member_id, canned_response_id),
  CONSTRAINT fk_canned_response_favorites_response_workspace
    FOREIGN KEY (canned_response_id, workspace_id)
    REFERENCES public.canned_responses (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_canned_response_favorites_member_workspace
    FOREIGN KEY (member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.canned_response_favorites IS
  'Per-member pins. Favorited snippets sort first in the composer picker.';
COMMENT ON COLUMN public.canned_response_favorites.member_id IS
  'Owning member. Rows are private to that member (RLS) and cascade on removal.';

CREATE INDEX idx_canned_response_favorites_member
  ON public.canned_response_favorites (workspace_id, member_id, created_at DESC);

CREATE INDEX idx_canned_response_favorites_response
  ON public.canned_response_favorites (canned_response_id);

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

ALTER TABLE public.canned_response_folders REPLICA IDENTITY FULL;
ALTER TABLE public.canned_responses REPLICA IDENTITY FULL;
ALTER TABLE public.canned_response_favorites REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'canned_response_folders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.canned_response_folders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'canned_responses'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.canned_responses;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'canned_response_favorites'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.canned_response_favorites;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

-- Any active member may read canned responses (viewers included: reading a
-- snippet is not the same as inserting it into a reply).
CREATE OR REPLACE FUNCTION app_private.require_canned_view_access(p_workspace_id uuid)
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

-- Using a snippet implies sending a reply, which viewers cannot do.
CREATE OR REPLACE FUNCTION app_private.require_canned_use_access(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  v_role := app_private.require_canned_view_access(p_workspace_id);
  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'FORBIDDEN: Viewers cannot use canned responses.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.require_workspace_canned_manage(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  v_role := app_private.require_canned_view_access(p_workspace_id);
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: Only owners and admins can manage shared canned responses.';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_canned_shortcut(p_shortcut text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_shortcut text;
BEGIN
  -- Operators type "/greet"; storage is slash-free and lowercase so the composer
  -- can match either form.
  v_shortcut := lower(trim(COALESCE(p_shortcut, '')));
  v_shortcut := trim(ltrim(v_shortcut, '/'));

  IF v_shortcut = '' THEN
    RETURN NULL;
  END IF;

  IF v_shortcut !~ '^[a-z0-9][a-z0-9_-]{0,63}$' THEN
    RAISE EXCEPTION 'INVALID_SHORTCUT: Shortcut must be 1–64 characters using lowercase letters, digits, hyphen or underscore, and start with a letter or digit.';
  END IF;

  RETURN v_shortcut;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_canned_visibility(p_visibility text)
RETURNS public.app_canned_visibility
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_visibility text;
BEGIN
  v_visibility := lower(trim(COALESCE(p_visibility, '')));

  IF v_visibility = '' THEN
    RETURN 'workspace'::public.app_canned_visibility;
  END IF;

  IF v_visibility NOT IN ('workspace', 'personal') THEN
    RAISE EXCEPTION 'INVALID_VISIBILITY: Visibility must be "workspace" or "personal".';
  END IF;

  RETURN v_visibility::public.app_canned_visibility;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.assert_can_manage_canned_response(
  p_response public.canned_responses
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF p_response.visibility = 'workspace' THEN
    PERFORM app_private.require_workspace_canned_manage(p_response.workspace_id);
    RETURN;
  END IF;

  PERFORM app_private.require_canned_use_access(p_response.workspace_id);
  v_member_id := app_private.get_caller_member_id(p_response.workspace_id);

  IF v_member_id IS NULL OR p_response.owner_member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Personal canned responses can only be managed by their owner.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.assert_can_manage_canned_folder(
  p_folder public.canned_response_folders
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
BEGIN
  IF p_folder.visibility = 'workspace' THEN
    PERFORM app_private.require_workspace_canned_manage(p_folder.workspace_id);
    RETURN;
  END IF;

  PERFORM app_private.require_canned_use_access(p_folder.workspace_id);
  v_member_id := app_private.get_caller_member_id(p_folder.workspace_id);

  IF v_member_id IS NULL OR p_folder.owner_member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION 'FORBIDDEN: Personal folders can only be managed by their owner.';
  END IF;
END;
$$;

-- A snippet may only live in a folder of the same workspace and the same
-- visibility/owner scope, otherwise a personal snippet could leak into a shared
-- folder listing (or vice versa).
CREATE OR REPLACE FUNCTION app_private.assert_canned_folder_scope(
  p_workspace_id uuid,
  p_folder_id uuid,
  p_visibility public.app_canned_visibility,
  p_owner_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_folder public.canned_response_folders;
BEGIN
  IF p_folder_id IS NULL THEN
    RETURN;
  END IF;

  SELECT f.*
  INTO v_folder
  FROM public.canned_response_folders f
  WHERE f.id = p_folder_id
    AND f.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FOLDER_NOT_FOUND: Canned response folder not found.';
  END IF;

  IF v_folder.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FOLDER_DELETED: Canned response folder is deleted.';
  END IF;

  IF v_folder.visibility <> p_visibility THEN
    RAISE EXCEPTION 'FOLDER_SCOPE_MISMATCH: Folder visibility does not match the canned response.';
  END IF;

  IF p_visibility = 'personal'
     AND v_folder.owner_member_id IS DISTINCT FROM p_owner_member_id THEN
    RAISE EXCEPTION 'FOLDER_SCOPE_MISMATCH: Personal folder belongs to another member.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.build_canned_response_item(
  p_response public.canned_responses,
  p_caller_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_favorited boolean := false;
BEGIN
  IF p_caller_member_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.canned_response_favorites f
      WHERE f.canned_response_id = p_response.id
        AND f.member_id = p_caller_member_id
    )
    INTO v_is_favorited;
  END IF;

  RETURN jsonb_build_object(
    'id', p_response.id,
    'workspace_id', p_response.workspace_id,
    'visibility', p_response.visibility,
    'owner_member_id', p_response.owner_member_id,
    'owner_display_label', CASE
      WHEN p_response.owner_member_id IS NULL THEN NULL
      ELSE COALESCE(
        app_private.member_display_label(p_response.owner_member_id),
        'Former member'
      )
    END,
    'folder_id', p_response.folder_id,
    'title', p_response.title,
    'body', p_response.body,
    'shortcut', p_response.shortcut,
    'usage_count', p_response.usage_count,
    'is_favorited', v_is_favorited,
    'created_by', p_response.created_by,
    'created_by_display_label', COALESCE(
      app_private.member_display_label(p_response.created_by),
      'Former member'
    ),
    'updated_by', p_response.updated_by,
    'updated_by_display_label', app_private.member_display_label(p_response.updated_by),
    'created_at', p_response.created_at,
    'updated_at', p_response.updated_at,
    'deleted_at', p_response.deleted_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.build_canned_folder_item(
  p_folder public.canned_response_folders
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response_count integer;
BEGIN
  SELECT count(*)
  INTO v_response_count
  FROM public.canned_responses r
  WHERE r.workspace_id = p_folder.workspace_id
    AND r.folder_id = p_folder.id
    AND r.deleted_at IS NULL;

  RETURN jsonb_build_object(
    'id', p_folder.id,
    'workspace_id', p_folder.workspace_id,
    'visibility', p_folder.visibility,
    'owner_member_id', p_folder.owner_member_id,
    'owner_display_label', CASE
      WHEN p_folder.owner_member_id IS NULL THEN NULL
      ELSE COALESCE(
        app_private.member_display_label(p_folder.owner_member_id),
        'Former member'
      )
    END,
    'name', p_folder.name,
    'sort_order', p_folder.sort_order,
    'response_count', v_response_count,
    'created_by', p_folder.created_by,
    'created_by_display_label', COALESCE(
      app_private.member_display_label(p_folder.created_by),
      'Former member'
    ),
    'updated_by', p_folder.updated_by,
    'updated_by_display_label', app_private.member_display_label(p_folder.updated_by),
    'created_at', p_folder.created_at,
    'updated_at', p_folder.updated_at,
    'deleted_at', p_folder.deleted_at
  );
END;
$$;

-- Loads a snippet the caller is allowed to see (shared, or their own personal).
CREATE OR REPLACE FUNCTION app_private.get_visible_canned_response(
  p_workspace_id uuid,
  p_id uuid,
  p_member_id uuid,
  p_include_deleted boolean DEFAULT false
)
RETURNS public.canned_responses
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_response public.canned_responses;
BEGIN
  SELECT r.*
  INTO v_response
  FROM public.canned_responses r
  WHERE r.id = p_id
    AND r.workspace_id = p_workspace_id
    AND (
      r.visibility = 'workspace'
      OR (p_member_id IS NOT NULL AND r.owner_member_id = p_member_id)
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANNED_NOT_FOUND: Canned response not found.';
  END IF;

  IF v_response.deleted_at IS NOT NULL AND NOT p_include_deleted THEN
    RAISE EXCEPTION 'CANNED_DELETED: Canned response is deleted.';
  END IF;

  RETURN v_response;
END;
$$;

-- ---------------------------------------------------------------------------
-- List RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_canned_responses(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_limit integer;
  v_visibility text;
  v_favorites_only boolean;
  v_include_folders boolean;
  v_authoritative boolean;
  v_catch_up_since timestamptz;
  v_folder_mode text := 'any';
  v_folder_id uuid;
  v_q text;
  v_q_like text;
  v_shortcut_q text;
  v_shortcut_like text;
  v_items jsonb := '[]'::jsonb;
  v_folders jsonb := '[]'::jsonb;
  v_tombstones jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_server_watermark timestamptz;
  v_row record;
  v_count integer := 0;
  v_folder_raw text;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE((p_query ->> 'limit')::integer, 100), 1), 200);
  v_favorites_only := COALESCE((p_query ->> 'favorites_only')::boolean, false);
  v_include_folders := COALESCE((p_query ->> 'include_folders')::boolean, true);
  v_authoritative := COALESCE((p_query ->> 'authoritative')::boolean, false);

  v_visibility := lower(COALESCE(NULLIF(p_query ->> 'visibility', ''), 'all'));
  IF v_visibility NOT IN ('all', 'workspace', 'personal') THEN
    RAISE EXCEPTION 'INVALID_VISIBILITY: Visibility filter must be "workspace", "personal" or "all".';
  END IF;

  IF NULLIF(p_query ->> 'catch_up_since', '') IS NOT NULL THEN
    v_catch_up_since := (p_query ->> 'catch_up_since')::timestamptz;
  END IF;

  -- folder_id: absent / JSON null => no filter, "none" => unfiled only,
  -- uuid => that folder.
  v_folder_raw := NULLIF(p_query ->> 'folder_id', '');
  IF v_folder_raw IS NOT NULL THEN
    IF lower(v_folder_raw) = 'none' THEN
      v_folder_mode := 'none';
    ELSE
      BEGIN
        v_folder_id := v_folder_raw::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'INVALID_QUERY: folder_id must be a uuid or "none".';
      END;
      v_folder_mode := 'id';
    END IF;
  END IF;

  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');
  IF v_q IS NOT NULL THEN
    IF char_length(v_q) > 200 THEN
      RAISE EXCEPTION 'INVALID_QUERY: Search query is too long.';
    END IF;
    -- Escape LIKE metacharacters so a literal "%" cannot match everything.
    v_q_like := replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
    -- The composer sends what the operator typed ("/ref"); shortcuts are stored
    -- slash-free, so match them on their own normalized form.
    v_shortcut_q := NULLIF(lower(trim(ltrim(v_q, '/'))), '');
    v_shortcut_like :=
      replace(replace(replace(v_shortcut_q, '\', '\\'), '%', '\%'), '_', '\_');
  END IF;

  FOR v_row IN
    SELECT s.resp, s.is_favorited, s.rank
    FROM (
      SELECT
        r AS resp,
        (fav.id IS NOT NULL) AS is_favorited,
        CASE
          WHEN v_q IS NULL THEN 0::double precision
          ELSE
            -- Exact shortcut wins outright, then a shortcut prefix, then
            -- trigram closeness and FTS rank, with a small nudge for favorites.
            (CASE
              WHEN r.shortcut IS NULL OR v_shortcut_q IS NULL THEN 0.0
              WHEN r.shortcut = v_shortcut_q THEN 1.0
              WHEN r.shortcut LIKE v_shortcut_like || '%' THEN 0.5
              ELSE 0.0
            END)
            + 0.6 * extensions.similarity(
                r.title || ' ' || coalesce(r.shortcut, '') || ' ' || r.body,
                v_q
              )
            + 0.4 * ts_rank(r.search_vector, plainto_tsquery('english', v_q))
            + (CASE WHEN fav.id IS NOT NULL THEN 0.15 ELSE 0.0 END)
        END AS rank
      FROM public.canned_responses r
      LEFT JOIN public.canned_response_favorites fav
        ON fav.canned_response_id = r.id
       AND fav.member_id = v_member_id
      WHERE r.workspace_id = p_workspace_id
        AND r.deleted_at IS NULL
        AND (
          (r.visibility = 'workspace' AND v_visibility IN ('all', 'workspace'))
          OR (
            r.visibility = 'personal'
            AND r.owner_member_id = v_member_id
            AND v_visibility IN ('all', 'personal')
          )
        )
        AND (
          v_folder_mode = 'any'
          OR (v_folder_mode = 'none' AND r.folder_id IS NULL)
          OR (v_folder_mode = 'id' AND r.folder_id = v_folder_id)
        )
        AND (NOT v_favorites_only OR fav.id IS NOT NULL)
        AND (
          v_catch_up_since IS NULL
          OR v_authoritative
          OR r.updated_at >= v_catch_up_since
        )
        AND (
          v_q IS NULL
          OR r.title ILIKE '%' || v_q_like || '%'
          OR coalesce(r.shortcut, '') ILIKE '%' || v_q_like || '%'
          OR r.body ILIKE '%' || v_q_like || '%'
          OR (
            v_shortcut_q IS NOT NULL
            AND r.shortcut IS NOT NULL
            AND r.shortcut LIKE v_shortcut_like || '%'
          )
          OR (r.title || ' ' || coalesce(r.shortcut, '') || ' ' || r.body)
             OPERATOR(extensions.%) v_q
          OR r.search_vector @@ plainto_tsquery('english', v_q)
        )
    ) s
    ORDER BY
      CASE WHEN v_q IS NOT NULL THEN s.rank END DESC NULLS LAST,
      CASE WHEN v_q IS NULL AND s.is_favorited THEN 0 ELSE 1 END ASC,
      lower((s.resp).title) ASC,
      (s.resp).id ASC
    LIMIT v_limit + 1
  LOOP
    v_count := v_count + 1;
    IF v_count > v_limit THEN
      v_has_more := true;
      EXIT;
    END IF;
    v_items := v_items || jsonb_build_array(
      app_private.build_canned_response_item(v_row.resp, v_member_id)
    );
  END LOOP;

  IF v_include_folders THEN
    SELECT COALESCE(
      jsonb_agg(
        app_private.build_canned_folder_item(f)
        ORDER BY f.visibility, f.sort_order, lower(f.name), f.id
      ),
      '[]'::jsonb
    )
    INTO v_folders
    FROM public.canned_response_folders f
    WHERE f.workspace_id = p_workspace_id
      AND f.deleted_at IS NULL
      AND (
        (f.visibility = 'workspace' AND v_visibility IN ('all', 'workspace'))
        OR (
          f.visibility = 'personal'
          AND f.owner_member_id = v_member_id
          AND v_visibility IN ('all', 'personal')
        )
      );
  END IF;

  -- Soft-delete tombstones for reconnect windows. Without catch_up_since there
  -- is no unbounded deleted-row scan.
  IF v_catch_up_since IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        app_private.build_canned_response_item(r, v_member_id)
        ORDER BY r.updated_at ASC, r.id ASC
      ),
      '[]'::jsonb
    )
    INTO v_tombstones
    FROM public.canned_responses r
    WHERE r.workspace_id = p_workspace_id
      AND r.deleted_at IS NOT NULL
      AND r.updated_at >= v_catch_up_since
      AND (
        r.visibility = 'workspace'
        OR r.owner_member_id = v_member_id
      );
  END IF;

  -- DB cursor only: never clock_timestamp()/now(), which can skip concurrent
  -- soft deletes forever.
  SELECT MAX(ts)
  INTO v_server_watermark
  FROM (
    SELECT v_catch_up_since AS ts
    WHERE v_catch_up_since IS NOT NULL
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_tombstones, '[]'::jsonb)) AS elem
  ) s;

  RETURN
    jsonb_build_object(
      'items', COALESCE(v_items, '[]'::jsonb),
      'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
      'has_more', v_has_more,
      'authoritative', v_authoritative,
      'server_watermark', to_jsonb(v_server_watermark)
    )
    || CASE
         WHEN v_include_folders
           THEN jsonb_build_object('folders', COALESCE(v_folders, '[]'::jsonb))
         ELSE '{}'::jsonb
       END;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.list_canned_response_folders(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_limit integer;
  v_visibility text;
  v_authoritative boolean;
  v_catch_up_since timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_tombstones jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_server_watermark timestamptz;
  v_row public.canned_response_folders;
  v_count integer := 0;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE((p_query ->> 'limit')::integer, 200), 1), 500);
  v_authoritative := COALESCE((p_query ->> 'authoritative')::boolean, false);

  v_visibility := lower(COALESCE(NULLIF(p_query ->> 'visibility', ''), 'all'));
  IF v_visibility NOT IN ('all', 'workspace', 'personal') THEN
    RAISE EXCEPTION 'INVALID_VISIBILITY: Visibility filter must be "workspace", "personal" or "all".';
  END IF;

  IF NULLIF(p_query ->> 'catch_up_since', '') IS NOT NULL THEN
    v_catch_up_since := (p_query ->> 'catch_up_since')::timestamptz;
  END IF;

  FOR v_row IN
    SELECT f.*
    FROM public.canned_response_folders f
    WHERE f.workspace_id = p_workspace_id
      AND f.deleted_at IS NULL
      AND (
        (f.visibility = 'workspace' AND v_visibility IN ('all', 'workspace'))
        OR (
          f.visibility = 'personal'
          AND f.owner_member_id = v_member_id
          AND v_visibility IN ('all', 'personal')
        )
      )
      AND (
        v_catch_up_since IS NULL
        OR v_authoritative
        OR f.updated_at >= v_catch_up_since
      )
    ORDER BY f.visibility, f.sort_order, lower(f.name), f.id
    LIMIT v_limit + 1
  LOOP
    v_count := v_count + 1;
    IF v_count > v_limit THEN
      v_has_more := true;
      EXIT;
    END IF;
    v_items := v_items || jsonb_build_array(app_private.build_canned_folder_item(v_row));
  END LOOP;

  IF v_catch_up_since IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        app_private.build_canned_folder_item(f)
        ORDER BY f.updated_at ASC, f.id ASC
      ),
      '[]'::jsonb
    )
    INTO v_tombstones
    FROM public.canned_response_folders f
    WHERE f.workspace_id = p_workspace_id
      AND f.deleted_at IS NOT NULL
      AND f.updated_at >= v_catch_up_since
      AND (
        f.visibility = 'workspace'
        OR f.owner_member_id = v_member_id
      );
  END IF;

  SELECT MAX(ts)
  INTO v_server_watermark
  FROM (
    SELECT v_catch_up_since AS ts
    WHERE v_catch_up_since IS NOT NULL
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_tombstones, '[]'::jsonb)) AS elem
  ) s;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
    'has_more', v_has_more,
    'authoritative', v_authoritative,
    'server_watermark', to_jsonb(v_server_watermark)
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_canned_response(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_response public.canned_responses;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_response := app_private.get_visible_canned_response(
    p_workspace_id,
    p_id,
    v_member_id,
    false
  );

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Canned response mutations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.create_canned_response(
  p_workspace_id uuid,
  p_title text,
  p_body text,
  p_shortcut text DEFAULT NULL,
  p_visibility text DEFAULT 'workspace',
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_visibility public.app_canned_visibility;
  v_owner_member_id uuid;
  v_title text;
  v_body text;
  v_shortcut text;
  v_response public.canned_responses;
BEGIN
  v_visibility := app_private.normalize_canned_visibility(p_visibility);

  IF v_visibility = 'workspace' THEN
    PERFORM app_private.require_workspace_canned_manage(p_workspace_id);
  ELSE
    PERFORM app_private.require_canned_use_access(p_workspace_id);
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member.';
  END IF;

  -- Personal snippets always belong to the caller; ownership is never client-supplied.
  IF v_visibility = 'personal' THEN
    v_owner_member_id := v_member_id;
  END IF;

  v_title := trim(COALESCE(p_title, ''));
  IF v_title = '' OR char_length(v_title) > 200 THEN
    RAISE EXCEPTION 'INVALID_TITLE: Title must be 1–200 characters.';
  END IF;

  v_body := trim(COALESCE(p_body, ''));
  IF v_body = '' OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'INVALID_BODY: Body must be 1–4000 characters.';
  END IF;

  v_shortcut := app_private.normalize_canned_shortcut(p_shortcut);

  PERFORM app_private.assert_canned_folder_scope(
    p_workspace_id,
    p_folder_id,
    v_visibility,
    v_owner_member_id
  );

  BEGIN
    INSERT INTO public.canned_responses (
      workspace_id,
      visibility,
      owner_member_id,
      folder_id,
      title,
      body,
      shortcut,
      created_by
    )
    VALUES (
      p_workspace_id,
      v_visibility,
      v_owner_member_id,
      p_folder_id,
      v_title,
      v_body,
      v_shortcut,
      v_member_id
    )
    RETURNING * INTO v_response;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'SHORTCUT_TAKEN: Shortcut "%" is already in use.', v_shortcut;
  END;

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_canned_response(
  p_workspace_id uuid,
  p_id uuid,
  p_title text,
  p_body text,
  p_shortcut text,
  p_folder_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_response public.canned_responses;
  v_title text;
  v_body text;
  v_shortcut text;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT r.*
  INTO v_response
  FROM public.canned_responses r
  WHERE r.id = p_id
    AND r.workspace_id = p_workspace_id
    AND (
      r.visibility = 'workspace'
      OR (v_member_id IS NOT NULL AND r.owner_member_id = v_member_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANNED_NOT_FOUND: Canned response not found.';
  END IF;

  IF v_response.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CANNED_DELETED: Canned response is deleted.';
  END IF;

  PERFORM app_private.assert_can_manage_canned_response(v_response);

  v_title := trim(COALESCE(p_title, ''));
  IF v_title = '' OR char_length(v_title) > 200 THEN
    RAISE EXCEPTION 'INVALID_TITLE: Title must be 1–200 characters.';
  END IF;

  v_body := trim(COALESCE(p_body, ''));
  IF v_body = '' OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'INVALID_BODY: Body must be 1–4000 characters.';
  END IF;

  v_shortcut := app_private.normalize_canned_shortcut(p_shortcut);

  -- Visibility is immutable: moving a snippet between shared and personal would
  -- change who may manage it and which shortcut uniqueness applies.
  PERFORM app_private.assert_canned_folder_scope(
    p_workspace_id,
    p_folder_id,
    v_response.visibility,
    v_response.owner_member_id
  );

  IF v_response.title = v_title
     AND v_response.body = v_body
     AND v_response.shortcut IS NOT DISTINCT FROM v_shortcut
     AND v_response.folder_id IS NOT DISTINCT FROM p_folder_id THEN
    RETURN app_private.build_canned_response_item(v_response, v_member_id);
  END IF;

  BEGIN
    UPDATE public.canned_responses
    SET
      title = v_title,
      body = v_body,
      shortcut = v_shortcut,
      folder_id = p_folder_id,
      updated_by = v_member_id
    WHERE id = p_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_response;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'SHORTCUT_TAKEN: Shortcut "%" is already in use.', v_shortcut;
  END;

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_canned_response(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_response public.canned_responses;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT r.*
  INTO v_response
  FROM public.canned_responses r
  WHERE r.id = p_id
    AND r.workspace_id = p_workspace_id
    AND (
      r.visibility = 'workspace'
      OR (v_member_id IS NOT NULL AND r.owner_member_id = v_member_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CANNED_NOT_FOUND: Canned response not found.';
  END IF;

  PERFORM app_private.assert_can_manage_canned_response(v_response);

  -- Idempotent: a repeated delete must not move the tombstone watermark.
  IF v_response.deleted_at IS NOT NULL THEN
    RETURN app_private.build_canned_response_item(v_response, v_member_id);
  END IF;

  UPDATE public.canned_responses
  SET
    deleted_at = now(),
    updated_by = v_member_id
  WHERE id = p_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_response;

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.set_canned_response_favorite(
  p_workspace_id uuid,
  p_id uuid,
  p_favorited boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_response public.canned_responses;
BEGIN
  PERFORM app_private.require_canned_use_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member.';
  END IF;

  v_response := app_private.get_visible_canned_response(
    p_workspace_id,
    p_id,
    v_member_id,
    false
  );

  IF COALESCE(p_favorited, false) THEN
    INSERT INTO public.canned_response_favorites (
      workspace_id,
      canned_response_id,
      member_id
    )
    VALUES (p_workspace_id, v_response.id, v_member_id)
    ON CONFLICT (member_id, canned_response_id) DO NOTHING;
  ELSE
    DELETE FROM public.canned_response_favorites f
    WHERE f.canned_response_id = v_response.id
      AND f.member_id = v_member_id;
  END IF;

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.record_canned_response_usage(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_response public.canned_responses;
BEGIN
  PERFORM app_private.require_canned_use_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_response := app_private.get_visible_canned_response(
    p_workspace_id,
    p_id,
    v_member_id,
    false
  );

  -- Read-modify-write free: concurrent insertions each add exactly one.
  UPDATE public.canned_responses
  SET usage_count = usage_count + 1
  WHERE id = v_response.id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_response;

  RETURN app_private.build_canned_response_item(v_response, v_member_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Folder mutations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.create_canned_response_folder(
  p_workspace_id uuid,
  p_name text,
  p_visibility text,
  p_sort_order integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_visibility public.app_canned_visibility;
  v_owner_member_id uuid;
  v_name text;
  v_sort_order integer;
  v_folder public.canned_response_folders;
BEGIN
  v_visibility := app_private.normalize_canned_visibility(p_visibility);

  IF v_visibility = 'workspace' THEN
    PERFORM app_private.require_workspace_canned_manage(p_workspace_id);
  ELSE
    PERFORM app_private.require_canned_use_access(p_workspace_id);
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member.';
  END IF;

  IF v_visibility = 'personal' THEN
    v_owner_member_id := v_member_id;
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  IF v_name = '' OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'INVALID_NAME: Folder name must be 1–100 characters.';
  END IF;

  v_sort_order := COALESCE(p_sort_order, 0);
  IF v_sort_order < -100000 OR v_sort_order > 100000 THEN
    RAISE EXCEPTION 'INVALID_SORT_ORDER: sort_order must be between -100000 and 100000.';
  END IF;

  INSERT INTO public.canned_response_folders (
    workspace_id,
    visibility,
    owner_member_id,
    name,
    sort_order,
    created_by
  )
  VALUES (
    p_workspace_id,
    v_visibility,
    v_owner_member_id,
    v_name,
    v_sort_order,
    v_member_id
  )
  RETURNING * INTO v_folder;

  RETURN app_private.build_canned_folder_item(v_folder);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_canned_response_folder(
  p_workspace_id uuid,
  p_id uuid,
  p_name text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_folder public.canned_response_folders;
  v_name text;
  v_sort_order integer;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT f.*
  INTO v_folder
  FROM public.canned_response_folders f
  WHERE f.id = p_id
    AND f.workspace_id = p_workspace_id
    AND (
      f.visibility = 'workspace'
      OR (v_member_id IS NOT NULL AND f.owner_member_id = v_member_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FOLDER_NOT_FOUND: Canned response folder not found.';
  END IF;

  IF v_folder.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'FOLDER_DELETED: Canned response folder is deleted.';
  END IF;

  PERFORM app_private.assert_can_manage_canned_folder(v_folder);

  v_name := trim(COALESCE(p_name, ''));
  IF v_name = '' OR char_length(v_name) > 100 THEN
    RAISE EXCEPTION 'INVALID_NAME: Folder name must be 1–100 characters.';
  END IF;

  v_sort_order := COALESCE(p_sort_order, v_folder.sort_order);
  IF v_sort_order < -100000 OR v_sort_order > 100000 THEN
    RAISE EXCEPTION 'INVALID_SORT_ORDER: sort_order must be between -100000 and 100000.';
  END IF;

  IF v_folder.name = v_name AND v_folder.sort_order = v_sort_order THEN
    RETURN app_private.build_canned_folder_item(v_folder);
  END IF;

  UPDATE public.canned_response_folders
  SET
    name = v_name,
    sort_order = v_sort_order,
    updated_by = v_member_id
  WHERE id = p_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_folder;

  RETURN app_private.build_canned_folder_item(v_folder);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_canned_response_folder(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_folder public.canned_response_folders;
BEGIN
  PERFORM app_private.require_canned_view_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT f.*
  INTO v_folder
  FROM public.canned_response_folders f
  WHERE f.id = p_id
    AND f.workspace_id = p_workspace_id
    AND (
      f.visibility = 'workspace'
      OR (v_member_id IS NOT NULL AND f.owner_member_id = v_member_id)
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FOLDER_NOT_FOUND: Canned response folder not found.';
  END IF;

  PERFORM app_private.assert_can_manage_canned_folder(v_folder);

  IF v_folder.deleted_at IS NOT NULL THEN
    RETURN app_private.build_canned_folder_item(v_folder);
  END IF;

  -- Soft delete never fires the folder FK, so unfile the snippets explicitly.
  -- Deleting a folder must not delete the snippets inside it.
  UPDATE public.canned_responses
  SET
    folder_id = NULL,
    updated_by = v_member_id
  WHERE workspace_id = p_workspace_id
    AND folder_id = p_id
    AND deleted_at IS NULL;

  UPDATE public.canned_response_folders
  SET
    deleted_at = now(),
    updated_by = v_member_id
  WHERE id = p_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_folder;

  RETURN app_private.build_canned_folder_item(v_folder);
END;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.list_canned_responses(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_canned_responses(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_canned_response(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_canned_response(p_workspace_id, p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_canned_response(
  p_workspace_id uuid,
  p_title text,
  p_body text,
  p_shortcut text DEFAULT NULL,
  p_visibility text DEFAULT 'workspace',
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_canned_response(
    p_workspace_id,
    p_title,
    p_body,
    p_shortcut,
    p_visibility,
    p_folder_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_canned_response(
  p_workspace_id uuid,
  p_id uuid,
  p_title text,
  p_body text,
  p_shortcut text,
  p_folder_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_canned_response(
    p_workspace_id,
    p_id,
    p_title,
    p_body,
    p_shortcut,
    p_folder_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_canned_response(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_canned_response(p_workspace_id, p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_canned_response_folders(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_canned_response_folders(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_canned_response_folder(
  p_workspace_id uuid,
  p_name text,
  p_visibility text,
  p_sort_order integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_canned_response_folder(
    p_workspace_id,
    p_name,
    p_visibility,
    p_sort_order
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_canned_response_folder(
  p_workspace_id uuid,
  p_id uuid,
  p_name text,
  p_sort_order integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_canned_response_folder(
    p_workspace_id,
    p_id,
    p_name,
    p_sort_order
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_canned_response_folder(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_canned_response_folder(p_workspace_id, p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_canned_response_favorite(
  p_workspace_id uuid,
  p_id uuid,
  p_favorited boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.set_canned_response_favorite(p_workspace_id, p_id, p_favorited);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_canned_response_usage(
  p_workspace_id uuid,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.record_canned_response_usage(p_workspace_id, p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.list_canned_responses(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_canned_response(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_canned_response(uuid, text, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_canned_response(uuid, uuid, text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_canned_response(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_canned_response_folders(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_canned_response_folder(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_canned_response_folder(uuid, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_canned_response_folder(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_canned_response_favorite(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_canned_response_usage(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_canned_responses(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_canned_response(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_canned_response(uuid, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_canned_response(uuid, uuid, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_canned_response(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_canned_response_folders(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_canned_response_folder(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_canned_response_folder(uuid, uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_canned_response_folder(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_canned_response_favorite(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_canned_response_usage(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.canned_response_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canned_response_favorites ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.canned_response_folders FROM PUBLIC;
REVOKE ALL ON TABLE public.canned_responses FROM PUBLIC;
REVOKE ALL ON TABLE public.canned_response_favorites FROM PUBLIC;

GRANT SELECT ON TABLE public.canned_response_folders TO authenticated;
GRANT SELECT ON TABLE public.canned_responses TO authenticated;
GRANT SELECT ON TABLE public.canned_response_favorites TO authenticated;

-- Shared snippets are readable by every active member; personal snippets only
-- by their owner. Writes go through the RPCs.
CREATE POLICY canned_responses_select_authenticated
  ON public.canned_responses
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND (
      visibility = 'workspace'
      OR owner_member_id = app_private.get_caller_member_id(workspace_id)
    )
  );

CREATE POLICY canned_response_folders_select_authenticated
  ON public.canned_response_folders
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND (
      visibility = 'workspace'
      OR owner_member_id = app_private.get_caller_member_id(workspace_id)
    )
  );

CREATE POLICY canned_response_favorites_select_authenticated
  ON public.canned_response_favorites
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND member_id = app_private.get_caller_member_id(workspace_id)
  );

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
