-- Global Search (PR #34 / product PR #32)
-- Workspace-wide operator search across contacts, conversations, messages,
-- internal notes, and attachments. Authorization enforced in SECURITY DEFINER
-- RPC. Reuses contacts.search_vector and internal_notes.search_vector.
-- See docs/GLOBAL-SEARCH.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Messages: generated FTS vector + GIN (+ trigram for short/partial queries)
-- ---------------------------------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED;

COMMENT ON COLUMN public.messages.search_vector IS
  'Generated FTS over message body for operator global search.';

CREATE INDEX IF NOT EXISTS idx_messages_search_vector
  ON public.messages USING gin (search_vector);

CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
  ON public.messages USING gin (body extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
  ON public.messages (workspace_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Conversations: trigger-maintained search_vector (safe metadata only)
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

COMMENT ON COLUMN public.conversations.search_vector IS
  'FTS over conversation id, contact identity, sanitized source_url, '
  'last_message_preview, subject, and assignee display label. No secrets.';

CREATE INDEX IF NOT EXISTS idx_conversations_search_vector
  ON public.conversations USING gin (search_vector);

CREATE INDEX IF NOT EXISTS idx_conversations_source_url_trgm
  ON public.conversations USING gin (source_url extensions.gin_trgm_ops)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_preview_trgm
  ON public.conversations USING gin (last_message_preview extensions.gin_trgm_ops)
  WHERE last_message_preview IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Attachments: trigram on safe filename (+ mime for optional match)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_message_attachments_filename_trgm
  ON public.message_attachments USING gin (filename extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_message_attachments_workspace_created
  ON public.message_attachments (workspace_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- Contacts: trigram support for prefix/substring (complements search_vector)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_name_trgm
  ON public.contacts USING gin (name extensions.gin_trgm_ops)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm
  ON public.contacts USING gin (email extensions.gin_trgm_ops)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm
  ON public.contacts USING gin (phone extensions.gin_trgm_ops)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_job_title_trgm
  ON public.contacts USING gin (job_title extensions.gin_trgm_ops)
  WHERE job_title IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_public_id
  ON public.contacts (workspace_id, public_id);

-- ---------------------------------------------------------------------------
-- Notes: trigram on body for partial matches (FTS GIN already exists)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_internal_notes_body_trgm
  ON public.internal_notes USING gin (body extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.escape_like_pattern(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_');
$$;

CREATE OR REPLACE FUNCTION app_private.normalize_phone_digits(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(p_text, ''), '\D', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION app_private.safe_search_snippet(
  p_document text,
  p_query text,
  p_max_chars integer DEFAULT 160
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_doc text;
  v_q text;
  v_pos integer;
  v_start integer;
  v_len integer;
  v_max integer;
  v_snippet text;
BEGIN
  v_doc := COALESCE(p_document, '');
  v_q := NULLIF(trim(COALESCE(p_query, '')), '');
  v_max := GREATEST(COALESCE(p_max_chars, 160), 40);

  -- Strip any angle brackets so snippets never carry HTML into the UI.
  v_doc := regexp_replace(v_doc, '[<>]', '', 'g');

  IF char_length(v_doc) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_q IS NULL THEN
    RETURN left(v_doc, v_max);
  END IF;

  v_pos := position(lower(v_q) IN lower(v_doc));
  IF v_pos > 0 THEN
    v_start := GREATEST(v_pos - 40, 1);
    v_len := LEAST(char_length(v_doc) - v_start + 1, v_max);
    v_snippet := substring(v_doc FROM v_start FOR v_len);
    IF v_start > 1 THEN
      v_snippet := '…' || v_snippet;
    END IF;
    IF v_start + v_len - 1 < char_length(v_doc) THEN
      v_snippet := v_snippet || '…';
    END IF;
    RETURN v_snippet;
  END IF;

  RETURN left(v_doc, v_max);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.refresh_conversation_search_vector(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conv public.conversations;
  v_contact_name text;
  v_contact_email text;
  v_contact_phone text;
  v_contact_public_id text;
  v_assignee_label text;
  v_document text;
  v_vector tsvector;
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN;
  END IF;

  SELECT c.*
  INTO v_conv
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT ct.name, ct.email, ct.phone, ct.public_id
  INTO v_contact_name, v_contact_email, v_contact_phone, v_contact_public_id
  FROM public.contacts ct
  WHERE ct.id = v_conv.contact_id
    AND ct.workspace_id = v_conv.workspace_id;

  IF v_conv.assigned_to IS NOT NULL THEN
    v_assignee_label := app_private.member_display_label(v_conv.assigned_to);
  END IF;

  v_document := concat_ws(
    ' ',
    v_conv.id::text,
    v_contact_public_id,
    v_contact_name,
    v_contact_email,
    v_contact_phone,
    v_conv.subject,
    v_conv.source_url,
    v_conv.last_message_preview,
    v_assignee_label
  );

  v_vector := to_tsvector('english', coalesce(v_document, ''));

  UPDATE public.conversations c
  SET search_vector = v_vector
  WHERE c.id = v_conv.id
    AND c.search_vector IS DISTINCT FROM v_vector;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_conversations_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.contact_id IS NOT DISTINCT FROM NEW.contact_id
     AND OLD.assigned_to IS NOT DISTINCT FROM NEW.assigned_to
     AND OLD.subject IS NOT DISTINCT FROM NEW.subject
     AND OLD.source_url IS NOT DISTINCT FROM NEW.source_url
     AND OLD.last_message_preview IS NOT DISTINCT FROM NEW.last_message_preview
     AND OLD.referrer IS NOT DISTINCT FROM NEW.referrer THEN
    RETURN NULL;
  END IF;

  PERFORM app_private.refresh_conversation_search_vector(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_refresh_search_vector ON public.conversations;
CREATE TRIGGER trg_conversations_refresh_search_vector
  AFTER INSERT OR UPDATE OF contact_id, assigned_to, subject, source_url,
    last_message_preview, referrer
  ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_conversations_refresh_search_vector();

CREATE OR REPLACE FUNCTION app_private.trg_contacts_refresh_conversation_search_vectors()
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
     AND OLD.public_id IS NOT DISTINCT FROM NEW.public_id THEN
    RETURN NULL;
  END IF;

  PERFORM app_private.refresh_conversation_search_vector(c.id)
  FROM public.conversations c
  WHERE c.workspace_id = NEW.workspace_id
    AND c.contact_id = NEW.id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_contacts_refresh_conversation_search_vectors ON public.contacts;
CREATE TRIGGER trg_contacts_refresh_conversation_search_vectors
  AFTER UPDATE OF name, email, phone, public_id
  ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_contacts_refresh_conversation_search_vectors();

-- Backfill conversation search vectors for existing rows (bounded batches via set).
UPDATE public.conversations c
SET search_vector = to_tsvector(
  'english',
  coalesce(
    concat_ws(
      ' ',
      c.id::text,
      ct.public_id,
      ct.name,
      ct.email,
      ct.phone,
      c.subject,
      c.source_url,
      c.last_message_preview,
      CASE
        WHEN c.assigned_to IS NOT NULL THEN app_private.member_display_label(c.assigned_to)
        ELSE NULL
      END
    ),
    ''
  )
)
FROM public.contacts ct
WHERE ct.id = c.contact_id
  AND ct.workspace_id = c.workspace_id
  AND c.search_vector IS NULL;

UPDATE public.conversations c
SET search_vector = to_tsvector(
  'english',
  coalesce(
    concat_ws(
      ' ',
      c.id::text,
      c.subject,
      c.source_url,
      c.last_message_preview,
      CASE
        WHEN c.assigned_to IS NOT NULL THEN app_private.member_display_label(c.assigned_to)
        ELSE NULL
      END
    ),
    ''
  )
)
WHERE c.contact_id IS NULL
  AND c.search_vector IS NULL;

-- ---------------------------------------------------------------------------
-- Result row builder
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.global_search_hit_json(
  p_type text,
  p_id uuid,
  p_title text,
  p_subtitle text,
  p_snippet text,
  p_timestamp timestamptz,
  p_conversation_id uuid,
  p_contact_id uuid,
  p_message_id uuid,
  p_rank double precision
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'type', p_type,
    'id', p_id,
    'title', COALESCE(p_title, ''),
    'subtitle', p_subtitle,
    'snippet', p_snippet,
    'timestamp', CASE WHEN p_timestamp IS NULL THEN NULL ELSE p_timestamp END,
    'conversation_id', p_conversation_id,
    'contact_id', p_contact_id,
    'message_id', p_message_id,
    'rank', ROUND(COALESCE(p_rank, 0)::numeric, 4)
  );
$$;

-- ---------------------------------------------------------------------------
-- Core RPC
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.global_search(
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
  v_role public.app_member_role;
  v_q text;
  v_q_like text;
  v_q_lower text;
  v_q_digits text;
  v_category text;
  v_limit integer;
  v_include_contacts boolean;
  v_include_conversations boolean;
  v_include_messages boolean;
  v_include_notes boolean;
  v_include_attachments boolean;
  v_can_search_notes boolean;
  v_is_viewer boolean;
  v_tsquery tsquery;
  v_contacts jsonb := '[]'::jsonb;
  v_conversations jsonb := '[]'::jsonb;
  v_messages jsonb := '[]'::jsonb;
  v_notes jsonb := '[]'::jsonb;
  v_attachments jsonb := '[]'::jsonb;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);
  v_is_viewer := v_role = 'viewer';
  v_can_search_notes := v_role IS NOT NULL AND v_role <> 'viewer';

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');
  IF v_q IS NOT NULL AND char_length(v_q) > 200 THEN
    RAISE EXCEPTION 'INVALID_QUERY: Search query is too long.';
  END IF;

  -- Empty query: return empty groups (palette must never dump unbounded rows).
  IF v_q IS NULL THEN
    RETURN jsonb_build_object(
      'q', '',
      'category', COALESCE(NULLIF(p_query ->> 'category', ''), 'all'),
      'limit_per_type', LEAST(GREATEST(COALESCE((p_query ->> 'limit_per_type')::integer, 5), 1), 25),
      'can_search_notes', v_can_search_notes,
      'groups', jsonb_build_object(
        'contacts', '[]'::jsonb,
        'conversations', '[]'::jsonb,
        'messages', '[]'::jsonb,
        'notes', '[]'::jsonb,
        'attachments', '[]'::jsonb
      )
    );
  END IF;

  v_limit := COALESCE((p_query ->> 'limit_per_type')::integer, 5);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 25 THEN
    v_limit := 25;
  END IF;

  v_category := lower(COALESCE(NULLIF(trim(p_query ->> 'category'), ''), 'all'));
  IF v_category NOT IN (
    'all', 'contacts', 'conversations', 'messages', 'notes', 'attachments'
  ) THEN
    RAISE EXCEPTION 'INVALID_QUERY: category must be all|contacts|conversations|messages|notes|attachments.';
  END IF;

  -- Viewers requesting notes get an empty notes group (no existence leak via error).
  v_include_contacts := v_category IN ('all', 'contacts');
  v_include_conversations := v_category IN ('all', 'conversations');
  v_include_messages := v_category IN ('all', 'messages');
  v_include_notes := v_category IN ('all', 'notes') AND v_can_search_notes;
  v_include_attachments := v_category IN ('all', 'attachments');

  v_q_like := app_private.escape_like_pattern(v_q);
  v_q_lower := lower(v_q);
  v_q_digits := app_private.normalize_phone_digits(v_q);
  BEGIN
    v_tsquery := plainto_tsquery('english', v_q);
  EXCEPTION
    WHEN others THEN
      v_tsquery := NULL;
  END;

  -- Contacts (reuse CRM search_vector)
  IF v_include_contacts THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_contacts
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'contact',
          c.id,
          COALESCE(NULLIF(c.name, ''), NULLIF(c.email, ''), c.public_id, 'Contact'),
          COALESCE(c.email, c.phone, c.job_title),
          app_private.safe_search_snippet(
            concat_ws(' · ', c.name, c.email, c.phone, c.job_title),
            v_q,
            160
          ),
          COALESCE(c.last_seen_at, c.updated_at, c.created_at),
          NULL,
          c.id,
          NULL,
          CASE
            WHEN c.email IS NOT NULL AND lower(c.email) = v_q_lower THEN 100
            WHEN c.public_id IS NOT NULL AND lower(c.public_id) = v_q_lower THEN 100
            WHEN v_q_digits IS NOT NULL
              AND char_length(v_q_digits) >= 7
              AND app_private.normalize_phone_digits(c.phone) = v_q_digits THEN 100
            WHEN c.name IS NOT NULL AND lower(c.name) = v_q_lower THEN 90
            WHEN c.email IS NOT NULL AND lower(c.email) LIKE v_q_lower || '%' THEN 80
            WHEN c.name IS NOT NULL AND lower(c.name) LIKE v_q_lower || '%' THEN 75
            WHEN c.public_id IS NOT NULL AND lower(c.public_id) LIKE v_q_lower || '%' THEN 70
            WHEN v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(c.search_vector, v_tsquery) * 20)
            WHEN c.name ILIKE '%' || v_q_like || '%' ESCAPE '\'
              OR c.email ILIKE '%' || v_q_like || '%' ESCAPE '\'
              OR c.phone ILIKE '%' || v_q_like || '%' ESCAPE '\'
              OR c.job_title ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 40
            ELSE 30
          END
        ) AS hit,
        CASE
          WHEN c.email IS NOT NULL AND lower(c.email) = v_q_lower THEN 100
          WHEN c.public_id IS NOT NULL AND lower(c.public_id) = v_q_lower THEN 100
          WHEN v_q_digits IS NOT NULL
            AND char_length(v_q_digits) >= 7
            AND app_private.normalize_phone_digits(c.phone) = v_q_digits THEN 100
          WHEN c.name IS NOT NULL AND lower(c.name) = v_q_lower THEN 90
          WHEN c.email IS NOT NULL AND lower(c.email) LIKE v_q_lower || '%' THEN 80
          WHEN c.name IS NOT NULL AND lower(c.name) LIKE v_q_lower || '%' THEN 75
          WHEN c.public_id IS NOT NULL AND lower(c.public_id) LIKE v_q_lower || '%' THEN 70
          WHEN v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(c.search_vector, v_tsquery) * 20)
          WHEN c.name ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR c.email ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR c.phone ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR c.job_title ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 40
          ELSE 30
        END AS hit_rank,
        COALESCE(c.last_seen_at, c.updated_at, c.created_at) AS hit_ts,
        c.id AS hit_id
      FROM public.contacts c
      WHERE c.workspace_id = p_workspace_id
        AND (
          (c.email IS NOT NULL AND lower(c.email) = v_q_lower)
          OR (c.public_id IS NOT NULL AND lower(c.public_id) = v_q_lower)
          OR (
            v_q_digits IS NOT NULL
            AND char_length(v_q_digits) >= 7
            AND app_private.normalize_phone_digits(c.phone) = v_q_digits
          )
          OR (v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery)
          OR c.name ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.email ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.phone ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.job_title ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.public_id ILIKE '%' || v_q_like || '%' ESCAPE '\'
        )
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- Conversations
  IF v_include_conversations THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_conversations
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'conversation',
          c.id,
          COALESCE(
            NULLIF(ct.name, ''),
            NULLIF(ct.email, ''),
            NULLIF(c.subject, ''),
            'Conversation'
          ),
          COALESCE(
            NULLIF(c.source_url, ''),
            CASE WHEN c.assigned_to IS NOT NULL
              THEN 'Assigned to ' || app_private.member_display_label(c.assigned_to)
              ELSE NULL
            END,
            c.status::text
          ),
          app_private.safe_search_snippet(
            COALESCE(c.last_message_preview, c.source_url, c.subject),
            v_q,
            160
          ),
          COALESCE(c.last_message_at, c.updated_at, c.created_at),
          c.id,
          c.contact_id,
          NULL,
          CASE
            WHEN c.id::text = v_q THEN 100
            WHEN ct.email IS NOT NULL AND lower(ct.email) = v_q_lower THEN 95
            WHEN ct.public_id IS NOT NULL AND lower(ct.public_id) = v_q_lower THEN 95
            WHEN ct.name IS NOT NULL AND lower(ct.name) = v_q_lower THEN 85
            WHEN c.id::text LIKE v_q || '%' THEN 80
            WHEN v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(c.search_vector, v_tsquery) * 20)
            ELSE 35
          END
        ) AS hit,
        CASE
          WHEN c.id::text = v_q THEN 100
          WHEN ct.email IS NOT NULL AND lower(ct.email) = v_q_lower THEN 95
          WHEN ct.public_id IS NOT NULL AND lower(ct.public_id) = v_q_lower THEN 95
          WHEN ct.name IS NOT NULL AND lower(ct.name) = v_q_lower THEN 85
          WHEN c.id::text LIKE v_q || '%' THEN 80
          WHEN v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(c.search_vector, v_tsquery) * 20)
          ELSE 35
        END AS hit_rank,
        COALESCE(c.last_message_at, c.updated_at, c.created_at) AS hit_ts,
        c.id AS hit_id
      FROM public.conversations c
      LEFT JOIN public.contacts ct
        ON ct.id = c.contact_id
       AND ct.workspace_id = c.workspace_id
      WHERE c.workspace_id = p_workspace_id
        AND (
          c.id::text = v_q
          OR c.id::text ILIKE v_q_like || '%' ESCAPE '\'
          OR (v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery)
          OR c.source_url ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.last_message_preview ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR c.subject ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR ct.name ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR ct.email ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR ct.public_id ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR (
            c.assigned_to IS NOT NULL
            AND app_private.member_display_label(c.assigned_to)
              ILIKE '%' || v_q_like || '%' ESCAPE '\'
          )
        )
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- Messages (exclude internal legacy flags for viewers)
  IF v_include_messages THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_messages
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'message',
          m.id,
          COALESCE(NULLIF(ct.name, ''), NULLIF(ct.email, ''), 'Message'),
          m.sender_type::text,
          app_private.safe_search_snippet(m.body, v_q, 160),
          m.created_at,
          m.conversation_id,
          c.contact_id,
          m.id,
          CASE
            WHEN lower(m.body) = v_q_lower THEN 90
            WHEN lower(m.body) LIKE v_q_lower || '%' THEN 70
            WHEN v_tsquery IS NOT NULL AND m.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(m.search_vector, v_tsquery) * 25)
            ELSE 35
          END
        ) AS hit,
        CASE
          WHEN lower(m.body) = v_q_lower THEN 90
          WHEN lower(m.body) LIKE v_q_lower || '%' THEN 70
          WHEN v_tsquery IS NOT NULL AND m.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(m.search_vector, v_tsquery) * 25)
          ELSE 35
        END AS hit_rank,
        m.created_at AS hit_ts,
        m.id AS hit_id
      FROM public.messages m
      INNER JOIN public.conversations c
        ON c.id = m.conversation_id
       AND c.workspace_id = m.workspace_id
      LEFT JOIN public.contacts ct
        ON ct.id = c.contact_id
       AND ct.workspace_id = c.workspace_id
      WHERE m.workspace_id = p_workspace_id
        AND (NOT v_is_viewer OR m.is_internal = false)
        AND (
          (v_tsquery IS NOT NULL AND m.search_vector @@ v_tsquery)
          OR m.body ILIKE '%' || v_q_like || '%' ESCAPE '\'
        )
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- Internal notes (messaging roles only; soft-deleted excluded)
  IF v_include_notes THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_notes
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'note',
          n.id,
          'Internal note',
          COALESCE(
            app_private.member_display_label(n.author_member_id),
            'Note'
          ),
          app_private.safe_search_snippet(n.body, v_q, 160),
          COALESCE(n.updated_at, n.created_at),
          n.conversation_id,
          c.contact_id,
          NULL,
          CASE
            WHEN lower(n.body) = v_q_lower THEN 90
            WHEN lower(n.body) LIKE v_q_lower || '%' THEN 70
            WHEN v_tsquery IS NOT NULL AND n.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(n.search_vector, v_tsquery) * 25)
            ELSE 35
          END
        ) AS hit,
        CASE
          WHEN lower(n.body) = v_q_lower THEN 90
          WHEN lower(n.body) LIKE v_q_lower || '%' THEN 70
          WHEN v_tsquery IS NOT NULL AND n.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(n.search_vector, v_tsquery) * 25)
          ELSE 35
        END AS hit_rank,
        COALESCE(n.updated_at, n.created_at) AS hit_ts,
        n.id AS hit_id
      FROM public.internal_notes n
      INNER JOIN public.conversations c
        ON c.id = n.conversation_id
       AND c.workspace_id = n.workspace_id
      WHERE n.workspace_id = p_workspace_id
        AND n.deleted_at IS NULL
        AND (
          (v_tsquery IS NOT NULL AND n.search_vector @@ v_tsquery)
          OR n.body ILIKE '%' || v_q_like || '%' ESCAPE '\'
        )
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- Attachments (safe metadata only; never storage_key / signed URLs)
  IF v_include_attachments THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_attachments
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'attachment',
          a.id,
          a.filename,
          COALESCE(a.mime_type, a.kind::text),
          app_private.safe_search_snippet(
            concat_ws(' · ', a.filename, a.mime_type),
            v_q,
            160
          ),
          a.created_at,
          a.conversation_id,
          c.contact_id,
          a.message_id,
          CASE
            WHEN lower(a.filename) = v_q_lower THEN 95
            WHEN lower(a.filename) LIKE v_q_lower || '%' THEN 80
            WHEN a.filename ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN
              45 + (extensions.similarity(lower(a.filename), v_q_lower) * 30)
            WHEN a.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 30
            ELSE 25
          END
        ) AS hit,
        CASE
          WHEN lower(a.filename) = v_q_lower THEN 95
          WHEN lower(a.filename) LIKE v_q_lower || '%' THEN 80
          WHEN a.filename ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN
            45 + (extensions.similarity(lower(a.filename), v_q_lower) * 30)
          WHEN a.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 30
          ELSE 25
        END AS hit_rank,
        a.created_at AS hit_ts,
        a.id AS hit_id
      FROM public.message_attachments a
      INNER JOIN public.messages m
        ON m.id = a.message_id
       AND m.workspace_id = a.workspace_id
      INNER JOIN public.conversations c
        ON c.id = a.conversation_id
       AND c.workspace_id = a.workspace_id
      WHERE a.workspace_id = p_workspace_id
        AND (NOT v_is_viewer OR m.is_internal = false)
        AND (
          a.filename ILIKE '%' || v_q_like || '%' ESCAPE '\'
          OR a.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\'
        )
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  RETURN jsonb_build_object(
    'q', v_q,
    'category', v_category,
    'limit_per_type', v_limit,
    'can_search_notes', v_can_search_notes,
    'groups', jsonb_build_object(
      'contacts', COALESCE(v_contacts, '[]'::jsonb),
      'conversations', COALESCE(v_conversations, '[]'::jsonb),
      'messages', COALESCE(v_messages, '[]'::jsonb),
      'notes', COALESCE(v_notes, '[]'::jsonb),
      'attachments', COALESCE(v_attachments, '[]'::jsonb)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.global_search(
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
  RETURN app_private.global_search(p_workspace_id, p_query);
END;
$$;

COMMENT ON FUNCTION public.global_search(uuid, jsonb) IS
  'Operator global search. Workspace-isolated; notes hidden from viewers; '
  'anon/visitor cannot execute.';

REVOKE ALL ON FUNCTION public.global_search(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.global_search(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
