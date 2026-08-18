-- Global Search hardening (follow-up to 20260818160000_global_search.sql)
-- - Workspace-scoped message GIN; attachment workspace+filename btree
-- - Sanitize source_url in conversation search_vector; drop assignee label
-- - Short queries: exact/prefix only (no FTS / no substring body scans)
-- - Long queries: staged candidate cap for messages / notes / attachments
-- - Safe ranking via position()/equality (no unescaped LIKE wildcards)
-- - list_messages optional around_message_id centered window
-- See docs/GLOBAL-SEARCH.md.

CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. Indexes
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_messages_search_vector;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_search_vector
  ON public.messages USING gin (workspace_id, search_vector);

-- Keep body trigram + workspace chronology (idempotent).
CREATE INDEX IF NOT EXISTS idx_messages_body_trgm
  ON public.messages USING gin (body extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created
  ON public.messages (workspace_id, created_at DESC, id DESC);

-- Attachments: exact/prefix via (workspace_id, lower(filename)); keep filename
-- gin_trgm for substring ILIKE. btree_gin is available if a composite
-- (workspace_id, filename gin_trgm_ops) index is added later.
CREATE INDEX IF NOT EXISTS idx_message_attachments_workspace_filename
  ON public.message_attachments (workspace_id, lower(filename));

CREATE INDEX IF NOT EXISTS idx_message_attachments_filename_trgm
  ON public.message_attachments USING gin (filename extensions.gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_message_attachments_workspace_created
  ON public.message_attachments (workspace_id, created_at DESC, id DESC);

-- Conversations: keep search_vector GIN (workspace filter applied first in RPC).
CREATE INDEX IF NOT EXISTS idx_conversations_search_vector
  ON public.conversations USING gin (search_vector);

-- ---------------------------------------------------------------------------
-- 2. refresh_conversation_search_vector (sanitize URL; no assignee label)
-- ---------------------------------------------------------------------------

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
  v_sanitized_source_url text;
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

  -- NULL-safe: sanitize_page_url returns NULL for NULL / unsafe input.
  v_sanitized_source_url := app_private.sanitize_page_url(v_conv.source_url);

  -- Intentionally omit assignee display label: member email/name can go
  -- stale relative to assignment without a reliable refresh path, and
  -- couples search_vector to auth.users identity churn.
  v_document := concat_ws(
    ' ',
    v_conv.id::text,
    v_contact_public_id,
    v_contact_name,
    v_contact_email,
    v_contact_phone,
    v_conv.subject,
    v_sanitized_source_url,
    v_conv.last_message_preview
  );

  v_vector := to_tsvector('english', coalesce(v_document, ''));

  UPDATE public.conversations c
  SET search_vector = v_vector
  WHERE c.id = v_conv.id
    AND c.search_vector IS DISTINCT FROM v_vector;
END;
$$;

COMMENT ON FUNCTION app_private.refresh_conversation_search_vector(uuid) IS
  'Rebuilds conversations.search_vector from id, contact public_id/name/'
  'email/phone, subject, sanitize_page_url(source_url), and last_message_preview. '
  'Does not include assignee display label (avoids stale assignee email coupling).';

COMMENT ON COLUMN public.conversations.search_vector IS
  'FTS over conversation id, contact identity, sanitize_page_url(source_url), '
  'last_message_preview, and subject. Assignee label intentionally omitted. No secrets.';

-- assigned_to no longer affects the vector; stop firing on assignment-only updates.
CREATE OR REPLACE FUNCTION app_private.trg_conversations_refresh_search_vector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.contact_id IS NOT DISTINCT FROM NEW.contact_id
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
  AFTER INSERT OR UPDATE OF contact_id, subject, source_url,
    last_message_preview, referrer
  ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_conversations_refresh_search_vector();

-- Re-backfill all conversation vectors with sanitized URL and without assignee.
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
      app_private.sanitize_page_url(c.source_url),
      c.last_message_preview
    ),
    ''
  )
)
FROM public.contacts ct
WHERE ct.id = c.contact_id
  AND ct.workspace_id = c.workspace_id;

UPDATE public.conversations c
SET search_vector = to_tsvector(
  'english',
  coalesce(
    concat_ws(
      ' ',
      c.id::text,
      c.subject,
      app_private.sanitize_page_url(c.source_url),
      c.last_message_preview
    ),
    ''
  )
)
WHERE c.contact_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3. app_private.global_search (hardened)
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
  -- MIN_FUZZY_LEN = 3 (char_length); below this: exact/prefix only, no body scans.
  -- CANDIDATE_CAP = least(greatest(limit_per_type * 20, 50), 200)
  v_role public.app_member_role;
  v_q text;
  v_q_like text;
  v_q_lower text;
  v_q_digits text;
  v_category text;
  v_limit integer;
  v_candidate_cap integer;
  v_is_short boolean;
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

  v_candidate_cap := LEAST(GREATEST(v_limit * 20, 50), 200);
  v_is_short := char_length(v_q) < 3;

  v_category := lower(COALESCE(NULLIF(trim(p_query ->> 'category'), ''), 'all'));
  IF v_category NOT IN (
    'all', 'contacts', 'conversations', 'messages', 'notes', 'attachments'
  ) THEN
    RAISE EXCEPTION 'INVALID_QUERY: category must be all|contacts|conversations|messages|notes|attachments.';
  END IF;

  -- Viewers requesting notes get an empty notes group (no existence leak via error).
  v_include_contacts := v_category IN ('all', 'contacts');
  v_include_conversations := v_category IN ('all', 'conversations');
  v_include_messages := v_category IN ('all', 'messages') AND NOT v_is_short;
  v_include_notes := v_category IN ('all', 'notes') AND v_can_search_notes AND NOT v_is_short;
  v_include_attachments := v_category IN ('all', 'attachments') AND NOT v_is_short;

  v_q_like := app_private.escape_like_pattern(v_q);
  v_q_lower := lower(v_q);
  v_q_digits := app_private.normalize_phone_digits(v_q);
  BEGIN
    v_tsquery := plainto_tsquery('english', v_q);
  EXCEPTION
    WHEN others THEN
      v_tsquery := NULL;
  END;

  -- -------------------------------------------------------------------------
  -- Contacts
  -- -------------------------------------------------------------------------
  IF v_include_contacts THEN
    IF v_is_short THEN
      -- Exact / prefix only — no FTS, no %q% substring.
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
              WHEN c.email IS NOT NULL AND position(v_q_lower IN lower(c.email)) = 1 THEN 80
              WHEN c.name IS NOT NULL AND position(v_q_lower IN lower(c.name)) = 1 THEN 75
              WHEN c.public_id IS NOT NULL AND position(v_q_lower IN lower(c.public_id)) = 1 THEN 70
              WHEN c.phone IS NOT NULL AND position(v_q_lower IN lower(c.phone)) = 1 THEN 65
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
            WHEN c.email IS NOT NULL AND position(v_q_lower IN lower(c.email)) = 1 THEN 80
            WHEN c.name IS NOT NULL AND position(v_q_lower IN lower(c.name)) = 1 THEN 75
            WHEN c.public_id IS NOT NULL AND position(v_q_lower IN lower(c.public_id)) = 1 THEN 70
            WHEN c.phone IS NOT NULL AND position(v_q_lower IN lower(c.phone)) = 1 THEN 65
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
            OR (c.email IS NOT NULL AND position(v_q_lower IN lower(c.email)) = 1)
            OR (c.public_id IS NOT NULL AND position(v_q_lower IN lower(c.public_id)) = 1)
            OR (c.name IS NOT NULL AND position(v_q_lower IN lower(c.name)) = 1)
            OR (c.phone IS NOT NULL AND position(v_q_lower IN lower(c.phone)) = 1)
          )
        ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
        LIMIT v_limit
      ) ranked;
    ELSE
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
              WHEN c.email IS NOT NULL AND position(v_q_lower IN lower(c.email)) = 1 THEN 80
              WHEN c.name IS NOT NULL AND position(v_q_lower IN lower(c.name)) = 1 THEN 75
              WHEN c.public_id IS NOT NULL AND position(v_q_lower IN lower(c.public_id)) = 1 THEN 70
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
            WHEN c.email IS NOT NULL AND position(v_q_lower IN lower(c.email)) = 1 THEN 80
            WHEN c.name IS NOT NULL AND position(v_q_lower IN lower(c.name)) = 1 THEN 75
            WHEN c.public_id IS NOT NULL AND position(v_q_lower IN lower(c.public_id)) = 1 THEN 70
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
  END IF;

  -- -------------------------------------------------------------------------
  -- Conversations (no assignee label in WHERE; subtitle omits assignee lookup)
  -- -------------------------------------------------------------------------
  IF v_include_conversations THEN
    IF v_is_short THEN
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
            COALESCE(NULLIF(c.source_url, ''), c.status::text),
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
              WHEN position(v_q_lower IN lower(c.id::text)) = 1 THEN 80
              ELSE 35
            END
          ) AS hit,
          CASE
            WHEN c.id::text = v_q THEN 100
            WHEN ct.email IS NOT NULL AND lower(ct.email) = v_q_lower THEN 95
            WHEN ct.public_id IS NOT NULL AND lower(ct.public_id) = v_q_lower THEN 95
            WHEN position(v_q_lower IN lower(c.id::text)) = 1 THEN 80
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
            OR position(v_q_lower IN lower(c.id::text)) = 1
            OR (ct.email IS NOT NULL AND lower(ct.email) = v_q_lower)
            OR (ct.public_id IS NOT NULL AND lower(ct.public_id) = v_q_lower)
          )
        ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
        LIMIT v_limit
      ) ranked;
    ELSE
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
            COALESCE(NULLIF(c.source_url, ''), c.status::text),
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
              WHEN position(v_q_lower IN lower(c.id::text)) = 1 THEN 80
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
            WHEN position(v_q_lower IN lower(c.id::text)) = 1 THEN 80
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
            OR position(v_q_lower IN lower(c.id::text)) = 1
            OR (v_tsquery IS NOT NULL AND c.search_vector @@ v_tsquery)
            OR c.source_url ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR c.last_message_preview ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR c.subject ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR ct.name ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR ct.email ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR ct.public_id ILIKE '%' || v_q_like || '%' ESCAPE '\'
          )
        ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
        LIMIT v_limit
      ) ranked;
    END IF;
  END IF;

  -- -------------------------------------------------------------------------
  -- Messages — staged candidate cap, then rank (long queries only)
  -- -------------------------------------------------------------------------
  IF v_include_messages THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_messages
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'message',
          cand.id,
          COALESCE(NULLIF(ct.name, ''), NULLIF(ct.email, ''), 'Message'),
          cand.sender_type::text,
          app_private.safe_search_snippet(cand.body, v_q, 160),
          cand.created_at,
          cand.conversation_id,
          c.contact_id,
          cand.id,
          CASE
            WHEN lower(cand.body) = v_q_lower THEN 90
            WHEN position(v_q_lower IN lower(cand.body)) = 1 THEN 70
            WHEN v_tsquery IS NOT NULL AND cand.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(cand.search_vector, v_tsquery) * 25)
            ELSE 35
          END
        ) AS hit,
        CASE
          WHEN lower(cand.body) = v_q_lower THEN 90
          WHEN position(v_q_lower IN lower(cand.body)) = 1 THEN 70
          WHEN v_tsquery IS NOT NULL AND cand.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(cand.search_vector, v_tsquery) * 25)
          ELSE 35
        END AS hit_rank,
        cand.created_at AS hit_ts,
        cand.id AS hit_id
      FROM (
        SELECT
          m.id,
          m.body,
          m.created_at,
          m.conversation_id,
          m.sender_type,
          m.search_vector,
          m.workspace_id
        FROM public.messages m
        WHERE m.workspace_id = p_workspace_id
          AND (NOT v_is_viewer OR m.is_internal = false)
          AND (
            (v_tsquery IS NOT NULL AND m.search_vector @@ v_tsquery)
            OR m.body ILIKE '%' || v_q_like || '%' ESCAPE '\'
          )
        ORDER BY m.created_at DESC
        LIMIT v_candidate_cap
      ) cand
      INNER JOIN public.conversations c
        ON c.id = cand.conversation_id
       AND c.workspace_id = cand.workspace_id
      LEFT JOIN public.contacts ct
        ON ct.id = c.contact_id
       AND ct.workspace_id = c.workspace_id
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- -------------------------------------------------------------------------
  -- Notes — staged; soft-deleted excluded; messaging roles only
  -- -------------------------------------------------------------------------
  IF v_include_notes THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_notes
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'note',
          cand.id,
          'Internal note',
          COALESCE(
            app_private.member_display_label(cand.author_member_id),
            'Note'
          ),
          app_private.safe_search_snippet(cand.body, v_q, 160),
          COALESCE(cand.updated_at, cand.created_at),
          cand.conversation_id,
          c.contact_id,
          NULL,
          CASE
            WHEN lower(cand.body) = v_q_lower THEN 90
            WHEN position(v_q_lower IN lower(cand.body)) = 1 THEN 70
            WHEN v_tsquery IS NOT NULL AND cand.search_vector @@ v_tsquery THEN
              50 + (ts_rank_cd(cand.search_vector, v_tsquery) * 25)
            ELSE 35
          END
        ) AS hit,
        CASE
          WHEN lower(cand.body) = v_q_lower THEN 90
          WHEN position(v_q_lower IN lower(cand.body)) = 1 THEN 70
          WHEN v_tsquery IS NOT NULL AND cand.search_vector @@ v_tsquery THEN
            50 + (ts_rank_cd(cand.search_vector, v_tsquery) * 25)
          ELSE 35
        END AS hit_rank,
        COALESCE(cand.updated_at, cand.created_at) AS hit_ts,
        cand.id AS hit_id
      FROM (
        SELECT
          n.id,
          n.body,
          n.created_at,
          n.updated_at,
          n.conversation_id,
          n.author_member_id,
          n.search_vector,
          n.workspace_id
        FROM public.internal_notes n
        WHERE n.workspace_id = p_workspace_id
          AND n.deleted_at IS NULL
          AND (
            (v_tsquery IS NOT NULL AND n.search_vector @@ v_tsquery)
            OR n.body ILIKE '%' || v_q_like || '%' ESCAPE '\'
          )
        ORDER BY COALESCE(n.updated_at, n.created_at) DESC
        LIMIT v_candidate_cap
      ) cand
      INNER JOIN public.conversations c
        ON c.id = cand.conversation_id
       AND c.workspace_id = cand.workspace_id
      ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id
      LIMIT v_limit
    ) ranked;
  END IF;

  -- -------------------------------------------------------------------------
  -- Attachments — staged; never expose storage_key
  -- -------------------------------------------------------------------------
  IF v_include_attachments THEN
    SELECT COALESCE(jsonb_agg(hit ORDER BY hit_rank DESC, hit_ts DESC NULLS LAST, hit_id), '[]'::jsonb)
    INTO v_attachments
    FROM (
      SELECT
        app_private.global_search_hit_json(
          'attachment',
          cand.id,
          cand.filename,
          COALESCE(cand.mime_type, cand.kind::text),
          app_private.safe_search_snippet(
            concat_ws(' · ', cand.filename, cand.mime_type),
            v_q,
            160
          ),
          cand.created_at,
          cand.conversation_id,
          c.contact_id,
          cand.message_id,
          CASE
            WHEN lower(cand.filename) = v_q_lower THEN 95
            WHEN position(v_q_lower IN lower(cand.filename)) = 1 THEN 80
            WHEN cand.filename ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN
              45 + (extensions.similarity(lower(cand.filename), v_q_lower) * 30)
            WHEN cand.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 30
            ELSE 25
          END
        ) AS hit,
        CASE
          WHEN lower(cand.filename) = v_q_lower THEN 95
          WHEN position(v_q_lower IN lower(cand.filename)) = 1 THEN 80
          WHEN cand.filename ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN
            45 + (extensions.similarity(lower(cand.filename), v_q_lower) * 30)
          WHEN cand.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\' THEN 30
          ELSE 25
        END AS hit_rank,
        cand.created_at AS hit_ts,
        cand.id AS hit_id
      FROM (
        SELECT
          a.id,
          a.filename,
          a.mime_type,
          a.kind,
          a.created_at,
          a.conversation_id,
          a.message_id,
          a.workspace_id
        FROM public.message_attachments a
        INNER JOIN public.messages m
          ON m.id = a.message_id
         AND m.workspace_id = a.workspace_id
        WHERE a.workspace_id = p_workspace_id
          AND (NOT v_is_viewer OR m.is_internal = false)
          AND (
            a.filename ILIKE '%' || v_q_like || '%' ESCAPE '\'
            OR a.mime_type ILIKE '%' || v_q_like || '%' ESCAPE '\'
          )
        ORDER BY a.created_at DESC
        LIMIT v_candidate_cap
      ) cand
      INNER JOIN public.conversations c
        ON c.id = cand.conversation_id
       AND c.workspace_id = cand.workspace_id
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

COMMENT ON FUNCTION app_private.global_search(uuid, jsonb) IS
  'Workspace-isolated operator search. Short queries (char_length < 3): '
  'exact/prefix contacts+conversations only. Long queries stage messages/notes/'
  'attachments with candidate cap. Never returns storage_key.';

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

-- ---------------------------------------------------------------------------
-- 4. list_messages — optional around_message_id centered window
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_messages(
  p_workspace_id uuid,
  p_conversation_id uuid,
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
  v_limit integer;
  v_before_sequence bigint;
  v_after_sequence bigint;
  v_around_message_id uuid;
  v_around_sequence bigint;
  v_before_count integer;
  v_after_count integer;
  v_items jsonb;
  v_oldest_sequence bigint;
  v_has_older boolean;
  v_fetched_count integer;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 50);
  IF v_limit < 1 OR v_limit > 50 THEN
    RAISE EXCEPTION 'Invalid message limit';
  END IF;

  IF p_query ? 'before_sequence' AND p_query ->> 'before_sequence' IS NOT NULL THEN
    v_before_sequence := (p_query ->> 'before_sequence')::bigint;
  END IF;

  IF p_query ? 'after_sequence' AND p_query ->> 'after_sequence' IS NOT NULL THEN
    v_after_sequence := (p_query ->> 'after_sequence')::bigint;
  END IF;

  IF p_query ? 'around_message_id' AND p_query ->> 'around_message_id' IS NOT NULL THEN
    v_around_message_id := (p_query ->> 'around_message_id')::uuid;
  END IF;

  IF v_before_sequence IS NOT NULL AND v_after_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot use before_sequence and after_sequence together';
  END IF;

  IF v_around_message_id IS NOT NULL
     AND (v_before_sequence IS NOT NULL OR v_after_sequence IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot use around_message_id with before_sequence or after_sequence';
  END IF;

  IF v_around_message_id IS NOT NULL THEN
    SELECT msg.sequence_number
    INTO v_around_sequence
    FROM public.messages msg
    WHERE msg.id = v_around_message_id
      AND msg.conversation_id = p_conversation_id
      AND msg.workspace_id = p_workspace_id
      AND (v_role <> 'viewer' OR msg.is_internal = false);

    IF v_around_sequence IS NULL THEN
      RAISE EXCEPTION 'Message not found';
    END IF;

    v_before_count := (v_limit - 1) / 2;
    v_after_count := v_limit - v_before_count - 1;

    SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.sequence_number ASC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT *
      FROM (
        SELECT
          msg.id,
          msg.sequence_number,
          msg.sender_type,
          app_private.message_sender_label(msg) AS sender_label,
          msg.body,
          msg.is_internal,
          msg.client_message_id,
          msg.created_at,
          app_private.message_attachments_json(msg.id) AS attachments
        FROM public.messages msg
        WHERE msg.conversation_id = p_conversation_id
          AND msg.workspace_id = p_workspace_id
          AND (v_role <> 'viewer' OR msg.is_internal = false)
          AND msg.sequence_number < v_around_sequence
        ORDER BY msg.sequence_number DESC
        LIMIT v_before_count
      ) older

      UNION ALL

      SELECT
        msg.id,
        msg.sequence_number,
        msg.sender_type,
        app_private.message_sender_label(msg) AS sender_label,
        msg.body,
        msg.is_internal,
        msg.client_message_id,
        msg.created_at,
        app_private.message_attachments_json(msg.id) AS attachments
      FROM public.messages msg
      WHERE msg.conversation_id = p_conversation_id
        AND msg.workspace_id = p_workspace_id
        AND (v_role <> 'viewer' OR msg.is_internal = false)
        AND msg.sequence_number = v_around_sequence

      UNION ALL

      SELECT *
      FROM (
        SELECT
          msg.id,
          msg.sequence_number,
          msg.sender_type,
          app_private.message_sender_label(msg) AS sender_label,
          msg.body,
          msg.is_internal,
          msg.client_message_id,
          msg.created_at,
          app_private.message_attachments_json(msg.id) AS attachments
        FROM public.messages msg
        WHERE msg.conversation_id = p_conversation_id
          AND msg.workspace_id = p_workspace_id
          AND (v_role <> 'viewer' OR msg.is_internal = false)
          AND msg.sequence_number > v_around_sequence
        ORDER BY msg.sequence_number ASC
        LIMIT v_after_count
      ) newer
    ) m;
  ELSE
    SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.sequence_number ASC), '[]'::jsonb)
    INTO v_items
    FROM (
      SELECT
        msg.id,
        msg.sequence_number,
        msg.sender_type,
        app_private.message_sender_label(msg) AS sender_label,
        msg.body,
        msg.is_internal,
        msg.client_message_id,
        msg.created_at,
        app_private.message_attachments_json(msg.id) AS attachments
      FROM public.messages msg
      WHERE msg.conversation_id = p_conversation_id
        AND msg.workspace_id = p_workspace_id
        AND (v_role <> 'viewer' OR msg.is_internal = false)
        AND (v_before_sequence IS NULL OR msg.sequence_number < v_before_sequence)
        AND (v_after_sequence IS NULL OR msg.sequence_number > v_after_sequence)
      ORDER BY
        CASE WHEN v_after_sequence IS NOT NULL THEN msg.sequence_number END ASC,
        CASE WHEN v_after_sequence IS NULL THEN msg.sequence_number END DESC
      LIMIT v_limit
    ) m;
  END IF;

  SELECT count(*)
  INTO v_fetched_count
  FROM jsonb_array_elements(v_items);

  -- around_message_id and before_sequence leave after_sequence NULL, so
  -- has_older / oldest_sequence still reflect the returned window.
  IF v_fetched_count > 0 AND v_after_sequence IS NULL THEN
    SELECT (elem ->> 'sequence_number')::bigint
    INTO v_oldest_sequence
    FROM jsonb_array_elements(v_items) AS elem
    ORDER BY (elem ->> 'sequence_number')::bigint ASC
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.messages msg
      WHERE msg.conversation_id = p_conversation_id
        AND msg.workspace_id = p_workspace_id
        AND (v_role <> 'viewer' OR msg.is_internal = false)
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

COMMENT ON FUNCTION app_private.list_messages(uuid, uuid, jsonb) IS
  'Lists conversation messages with optional before_sequence, after_sequence, '
  'or around_message_id (centered window). Mutually exclusive cursor modes. '
  'Viewers never see is_internal messages. Includes attachment JSON.';

CREATE OR REPLACE FUNCTION public.list_messages(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_messages(p_workspace_id, p_conversation_id, p_query);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.global_search(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.global_search(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.global_search(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.list_messages(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_messages(uuid, uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_messages(uuid, uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
