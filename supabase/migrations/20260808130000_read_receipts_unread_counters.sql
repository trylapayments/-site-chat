-- =============================================================================
-- Read receipts + unread counters (conversation-level cursors)
--
-- Design:
--   - No per-message delivery/seen writes. Receipt state is derived from
--     conversation-level last_delivered_sequence / last_read_sequence.
--   - Operator unread is denormalized on conversation_member_reads.unread_count
--     for O(1) list/badge reads (increment on visitor message, clear on mark).
--   - Visitor cursor lives in conversation_visitor_reads (one row per conversation).
--   - mark_* RPCs are monotonic (GREATEST) and no-op when the cursor does not advance.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- conversations: visitor_message_count for O(1) unread bootstrap
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS visitor_message_count bigint NOT NULL DEFAULT 0;

UPDATE public.conversations c
SET visitor_message_count = sub.cnt
FROM (
  SELECT
    m.conversation_id,
    count(*)::bigint AS cnt
  FROM public.messages m
  WHERE m.sender_type = 'visitor'
    AND m.is_internal = false
  GROUP BY m.conversation_id
) sub
WHERE c.id = sub.conversation_id
  AND c.visitor_message_count <> sub.cnt;

-- ---------------------------------------------------------------------------
-- conversation_member_reads: delivered + unread_count
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversation_member_reads
  ADD COLUMN IF NOT EXISTS last_delivered_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.conversation_member_reads
  DROP CONSTRAINT IF EXISTS chk_conversation_member_reads_delivered_sequence;

ALTER TABLE public.conversation_member_reads
  ADD CONSTRAINT chk_conversation_member_reads_delivered_sequence
  CHECK (last_delivered_sequence >= 0);

ALTER TABLE public.conversation_member_reads
  DROP CONSTRAINT IF EXISTS chk_conversation_member_reads_unread_count;

ALTER TABLE public.conversation_member_reads
  ADD CONSTRAINT chk_conversation_member_reads_unread_count
  CHECK (unread_count >= 0);

-- Backfill unread_count from existing visitor messages beyond last_read_sequence.
UPDATE public.conversation_member_reads r
SET unread_count = sub.cnt
FROM (
  SELECT
    r2.id AS read_id,
    (
      SELECT count(*)::integer
      FROM public.messages m
      WHERE m.conversation_id = r2.conversation_id
        AND m.sender_type = 'visitor'
        AND m.is_internal = false
        AND m.sequence_number > r2.last_read_sequence
    ) AS cnt
  FROM public.conversation_member_reads r2
) sub
WHERE r.id = sub.read_id
  AND r.unread_count <> sub.cnt;

-- ---------------------------------------------------------------------------
-- conversation_visitor_reads
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversation_visitor_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  visitor_session_id uuid NOT NULL,
  last_read_sequence bigint NOT NULL DEFAULT 0,
  last_delivered_sequence bigint NOT NULL DEFAULT 0,
  last_read_at timestamptz,
  last_delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_visitor_reads_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT uq_conversation_visitor_reads_conversation UNIQUE (conversation_id),
  CONSTRAINT fk_conversation_visitor_reads_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conversation_visitor_reads_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_conversation_visitor_reads_read_sequence CHECK (last_read_sequence >= 0),
  CONSTRAINT chk_conversation_visitor_reads_delivered_sequence CHECK (last_delivered_sequence >= 0)
);

CREATE INDEX IF NOT EXISTS idx_conversation_visitor_reads_workspace
  ON public.conversation_visitor_reads (workspace_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_visitor_reads_session
  ON public.conversation_visitor_reads (visitor_session_id);

DROP TRIGGER IF EXISTS trg_conversation_visitor_reads_set_updated_at
  ON public.conversation_visitor_reads;

CREATE TRIGGER trg_conversation_visitor_reads_set_updated_at
  BEFORE UPDATE ON public.conversation_visitor_reads
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.conversation_visitor_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_visitor_reads_select_authenticated
  ON public.conversation_visitor_reads;

-- Operators may SELECT visitor receipt cursors for conversations in their workspace.
CREATE POLICY conversation_visitor_reads_select_authenticated
  ON public.conversation_visitor_reads
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

GRANT SELECT ON TABLE public.conversation_visitor_reads TO authenticated;
REVOKE ALL ON TABLE public.conversation_visitor_reads FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.conversation_visitor_reads FROM authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication: operator multi-tab unread sync via CDC
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_member_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_member_reads;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversation_visitor_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_visitor_reads;
  END IF;
END;
$$;

-- Replica identity for filtered CDC (member_id / conversation_id filters).
ALTER TABLE public.conversation_member_reads REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_visitor_reads REPLICA IDENTITY FULL;

-- ---------------------------------------------------------------------------
-- Helpers: unread count + peer receipt aggregates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.conversation_unread_count(
  p_conversation_id uuid,
  p_member_id uuid,
  p_last_read_sequence bigint,
  p_stored_unread_count integer,
  p_has_read_row boolean,
  p_visitor_message_count bigint
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_has_read_row THEN GREATEST(COALESCE(p_stored_unread_count, 0), 0)
    ELSE GREATEST(COALESCE(p_visitor_message_count, 0), 0)::integer
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.conversation_has_unread(
  p_conversation_id uuid,
  p_member_id uuid,
  p_last_read_sequence bigint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.sender_type = 'visitor'
      AND m.is_internal = false
      AND m.sequence_number > COALESCE(p_last_read_sequence, 0)
  );
$$;

CREATE OR REPLACE FUNCTION app_private.agent_receipt_cursors(p_conversation_id uuid)
RETURNS TABLE (
  last_read_sequence bigint,
  last_delivered_sequence bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE(max(r.last_read_sequence), 0)::bigint AS last_read_sequence,
    COALESCE(max(r.last_delivered_sequence), 0)::bigint AS last_delivered_sequence
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id;
$$;

CREATE OR REPLACE FUNCTION app_private.visitor_receipt_cursors(p_conversation_id uuid)
RETURNS TABLE (
  last_read_sequence bigint,
  last_delivered_sequence bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    COALESCE(r.last_read_sequence, 0)::bigint AS last_read_sequence,
    COALESCE(r.last_delivered_sequence, 0)::bigint AS last_delivered_sequence
  FROM public.conversation_visitor_reads r
  WHERE r.conversation_id = p_conversation_id
  UNION ALL
  SELECT 0::bigint, 0::bigint
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.conversation_visitor_reads r2
    WHERE r2.conversation_id = p_conversation_id
  )
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: maintain visitor_message_count + member unread_count on visitor msgs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.on_visitor_message_unread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.sender_type = 'visitor' AND NEW.is_internal = false THEN
    UPDATE public.conversations
    SET visitor_message_count = visitor_message_count + 1,
        updated_at = now()
    WHERE id = NEW.conversation_id
      AND workspace_id = NEW.workspace_id;

    UPDATE public.conversation_member_reads
    SET unread_count = unread_count + 1,
        updated_at = now()
    WHERE conversation_id = NEW.conversation_id
      AND workspace_id = NEW.workspace_id
      AND last_read_sequence < NEW.sequence_number;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_visitor_unread ON public.messages;

CREATE TRIGGER trg_messages_visitor_unread
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION app_private.on_visitor_message_unread();

-- ---------------------------------------------------------------------------
-- build_conversation_list_item / detail — add unread_count + receipt cursors
-- Drop prior 3-arg signatures so defaults do not create silent overloads.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS app_private.build_conversation_list_item(
  public.conversations,
  uuid,
  bigint
);

DROP FUNCTION IF EXISTS app_private.build_conversation_detail(
  public.conversations,
  uuid,
  bigint
);

CREATE OR REPLACE FUNCTION app_private.build_conversation_list_item(
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
  v_contact jsonb;
  v_assigned jsonb;
  v_unread integer;
BEGIN
  IF p_conversation.contact_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'email', c.email
    )
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = p_conversation.contact_id;
  ELSE
    v_contact := NULL;
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

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact,
    'last_message_at', p_conversation.last_message_at,
    'last_message_preview', p_conversation.last_message_preview,
    'message_count', p_conversation.message_count,
    'has_unread', v_unread > 0,
    'unread_count', v_unread,
    'created_at', p_conversation.created_at
  );
END;
$$;

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
  v_contact jsonb;
  v_assigned jsonb;
  v_unread integer;
  v_visitor_read bigint;
  v_visitor_delivered bigint;
  v_agent_read bigint;
  v_agent_delivered bigint;
BEGIN
  IF p_conversation.contact_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'email', c.email,
      'phone', c.phone
    )
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = p_conversation.contact_id;
  ELSE
    v_contact := NULL;
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

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact,
    'visitor_session_id', p_conversation.visitor_session_id,
    'visitor_realtime_topic',
      'widget-conversation:' || p_conversation.visitor_realtime_topic_key,
    'visitor_ephemeral_topic',
      'widget-ephemeral:' || p_conversation.visitor_realtime_topic_key,
    'source_url', p_conversation.source_url,
    'message_count', p_conversation.message_count,
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

-- Update list_conversations to pass stored unread_count
CREATE OR REPLACE FUNCTION app_private.list_conversations(
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
  v_member_id uuid;
  v_page integer;
  v_page_size integer;
  v_offset integer;
  v_sort_field text;
  v_sort_direction text;
  v_status public.app_conversation_status;
  v_assignment text;
  v_search text;
  v_total integer;
  v_items jsonb;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_page := GREATEST(COALESCE((p_query ->> 'page')::integer, 1), 1);
  v_page_size := LEAST(GREATEST(COALESCE((p_query ->> 'pageSize')::integer, 25), 1), 100);
  v_offset := (v_page - 1) * v_page_size;

  v_sort_field := COALESCE(NULLIF(p_query ->> 'sort', ''), '-last_message_at');
  IF v_sort_field LIKE '-%' THEN
    v_sort_direction := 'desc';
    v_sort_field := ltrim(v_sort_field, '-');
  ELSE
    v_sort_direction := 'asc';
  END IF;
  IF v_sort_field NOT IN ('last_message_at', 'created_at', 'status') THEN
    RAISE EXCEPTION 'Invalid sort field';
  END IF;

  IF p_query ? 'status' AND p_query ->> 'status' IS NOT NULL AND p_query ->> 'status' <> '' THEN
    v_status := (p_query ->> 'status')::public.app_conversation_status;
  END IF;

  v_assignment := NULLIF(p_query ->> 'assignment', '');
  IF v_assignment IS NOT NULL AND v_assignment NOT IN ('all', 'unassigned', 'assigned_to_me') THEN
    RAISE EXCEPTION 'Invalid assignment filter';
  END IF;

  v_search := NULLIF(trim(p_query ->> 'q'), '');
  IF v_search IS NOT NULL AND length(v_search) > 200 THEN
    RAISE EXCEPTION 'Search query too long';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM public.conversations c
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id
  WHERE c.workspace_id = p_workspace_id
    AND (v_status IS NULL OR c.status = v_status)
    AND (
      v_assignment IS NULL
      OR v_assignment = 'all'
      OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
      OR (v_assignment = 'assigned_to_me' AND c.assigned_to = v_member_id)
    )
    AND (
      v_search IS NULL
      OR ct.name ILIKE '%' || v_search || '%'
      OR ct.email ILIKE '%' || v_search || '%'
      OR c.last_message_preview ILIKE '%' || v_search || '%'
    );

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      app_private.build_conversation_list_item(
        c,
        v_member_id,
        COALESCE(r.last_read_sequence, 0),
        r.unread_count,
        r.id IS NOT NULL
      ) AS item
    FROM public.conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.conversation_member_reads r
      ON r.conversation_id = c.id
     AND r.member_id = v_member_id
    WHERE c.workspace_id = p_workspace_id
      AND (v_status IS NULL OR c.status = v_status)
      AND (
        v_assignment IS NULL
        OR v_assignment = 'all'
        OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
        OR (v_assignment = 'assigned_to_me' AND c.assigned_to = v_member_id)
      )
      AND (
        v_search IS NULL
        OR ct.name ILIKE '%' || v_search || '%'
        OR ct.email ILIKE '%' || v_search || '%'
        OR c.last_message_preview ILIKE '%' || v_search || '%'
      )
    ORDER BY
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'asc' THEN c.status END ASC,
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'desc' THEN c.status END DESC,
      CASE WHEN v_sort_field = 'last_message_at' AND v_sort_direction = 'desc' THEN c.last_message_at END DESC NULLS LAST,
      CASE WHEN v_sort_field = 'last_message_at' AND v_sort_direction = 'asc' THEN c.last_message_at END ASC NULLS LAST,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'desc' THEN c.created_at END DESC,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN c.created_at END ASC
    LIMIT v_page_size
    OFFSET v_offset
  ) listed;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
END;
$$;

-- get_conversation path uses build_conversation_detail — update callers that pass 3 args.
-- Existing get_conversation already selects last_read_sequence; update it to pass unread.

CREATE OR REPLACE FUNCTION app_private.get_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_conversation public.conversations;
  v_last_read_sequence bigint;
  v_unread_count integer;
  v_has_read_row boolean;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.*
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT r.last_read_sequence, r.unread_count, true
  INTO v_last_read_sequence, v_unread_count, v_has_read_row
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  IF NOT FOUND THEN
    v_last_read_sequence := 0;
    v_unread_count := NULL;
    v_has_read_row := false;
  END IF;

  RETURN app_private.build_conversation_detail(
    v_conversation,
    v_member_id,
    v_last_read_sequence,
    v_unread_count,
    v_has_read_row
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- mark_conversation_read — no-op when cursor does not advance; return unread_count
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.mark_conversation_read(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_through_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_through bigint;
  v_max_sequence bigint;
  v_existing_sequence bigint;
  v_existing_unread integer;
  v_has_row boolean := false;
  v_visitor_message_count bigint;
  v_unread integer;
  v_updated boolean := false;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT c.visitor_message_count
  INTO v_visitor_message_count
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT COALESCE(max(m.sequence_number), 0)
  INTO v_max_sequence
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.workspace_id = p_workspace_id;

  v_through := v_max_sequence;
  IF p_through_sequence IS NOT NULL THEN
    v_through := LEAST(p_through_sequence, v_max_sequence);
  END IF;

  SELECT r.last_read_sequence, r.unread_count, true
  INTO v_existing_sequence, v_existing_unread, v_has_row
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  IF NOT FOUND THEN
    v_existing_sequence := 0;
    v_existing_unread := NULL;
    v_has_row := false;
  END IF;

  -- Reopening an already-read conversation must not write.
  IF v_has_row AND v_through <= v_existing_sequence THEN
    RETURN jsonb_build_object(
      'last_read_sequence', v_existing_sequence,
      'has_unread', COALESCE(v_existing_unread, 0) > 0,
      'unread_count', COALESCE(v_existing_unread, 0),
      'updated', false
    );
  END IF;

  -- Full catch-up → O(1) clear. Partial → indexed count of remaining unread.
  IF v_through >= v_max_sequence THEN
    v_unread := 0;
  ELSE
    SELECT count(*)::integer
    INTO v_unread
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.workspace_id = p_workspace_id
      AND m.sender_type = 'visitor'
      AND m.is_internal = false
      AND m.sequence_number > v_through;
  END IF;

  INSERT INTO public.conversation_member_reads (
    workspace_id,
    conversation_id,
    member_id,
    last_read_sequence,
    last_delivered_sequence,
    unread_count,
    last_read_at
  )
  VALUES (
    p_workspace_id,
    p_conversation_id,
    v_member_id,
    v_through,
    v_through,
    v_unread,
    now()
  )
  ON CONFLICT (conversation_id, member_id) DO UPDATE
  SET
    last_read_sequence = GREATEST(
      public.conversation_member_reads.last_read_sequence,
      EXCLUDED.last_read_sequence
    ),
    last_delivered_sequence = GREATEST(
      public.conversation_member_reads.last_delivered_sequence,
      EXCLUDED.last_delivered_sequence
    ),
    unread_count = EXCLUDED.unread_count,
    last_read_at = now(),
    updated_at = now();

  v_updated := true;

  SELECT r.last_read_sequence, r.unread_count
  INTO v_through, v_unread
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  RETURN jsonb_build_object(
    'last_read_sequence', v_through,
    'has_unread', v_unread > 0,
    'unread_count', v_unread,
    'updated', v_updated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_through_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.mark_conversation_read(
    p_workspace_id,
    p_conversation_id,
    p_through_sequence
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- mark_conversation_delivered (operator) — advance delivered cursor only
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.mark_conversation_delivered(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_through_sequence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_through bigint;
  v_max_sequence bigint;
  v_existing bigint;
  v_has_row boolean := false;
  v_visitor_count integer;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT COALESCE(max(m.sequence_number), 0)
  INTO v_max_sequence
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.workspace_id = p_workspace_id;

  v_through := LEAST(GREATEST(COALESCE(p_through_sequence, 0), 0), v_max_sequence);

  SELECT r.last_delivered_sequence, true
  INTO v_existing, v_has_row
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  IF NOT FOUND THEN
    v_existing := 0;
    v_has_row := false;
  END IF;

  IF v_has_row AND v_through <= v_existing THEN
    RETURN jsonb_build_object(
      'last_delivered_sequence', v_existing,
      'updated', false
    );
  END IF;

  SELECT count(*)::integer
  INTO v_visitor_count
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.workspace_id = p_workspace_id
    AND m.sender_type = 'visitor'
    AND m.is_internal = false;

  INSERT INTO public.conversation_member_reads (
    workspace_id,
    conversation_id,
    member_id,
    last_read_sequence,
    last_delivered_sequence,
    unread_count,
    last_read_at
  )
  VALUES (
    p_workspace_id,
    p_conversation_id,
    v_member_id,
    0,
    v_through,
    v_visitor_count,
    now()
  )
  ON CONFLICT (conversation_id, member_id) DO UPDATE
  SET
    last_delivered_sequence = GREATEST(
      public.conversation_member_reads.last_delivered_sequence,
      EXCLUDED.last_delivered_sequence
    ),
    updated_at = now();

  SELECT r.last_delivered_sequence
  INTO v_through
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  RETURN jsonb_build_object(
    'last_delivered_sequence', COALESCE(v_through, 0),
    'updated', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_conversation_delivered(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_through_sequence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.mark_conversation_delivered(
    p_workspace_id,
    p_conversation_id,
    p_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_delivered(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_delivered(uuid, uuid, bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_inbox_unread_total — global badge (O(conversations with read rows) + stub)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.get_inbox_unread_total(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_total integer;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT COALESCE(sum(unread), 0)::integer
  INTO v_total
  FROM (
    SELECT app_private.conversation_unread_count(
      c.id,
      v_member_id,
      COALESCE(r.last_read_sequence, 0),
      r.unread_count,
      r.id IS NOT NULL,
      c.visitor_message_count
    ) AS unread
    FROM public.conversations c
    LEFT JOIN public.conversation_member_reads r
      ON r.conversation_id = c.id
     AND r.member_id = v_member_id
    WHERE c.workspace_id = p_workspace_id
  ) counts;

  RETURN jsonb_build_object('unread_total', v_total);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inbox_unread_total(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_inbox_unread_total(p_workspace_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_inbox_unread_total(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inbox_unread_total(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Visitor receipt RPCs (service_role only — widget API)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_mark_conversation_receipt(
  p_workspace_id uuid,
  p_session_token text,
  p_kind text,
  p_through_sequence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_conversation public.conversations;
  v_through bigint;
  v_max_sequence bigint;
  v_existing_read bigint := 0;
  v_existing_delivered bigint := 0;
  v_has_row boolean := false;
  v_updated boolean := false;
  v_kind text;
BEGIN
  v_kind := lower(trim(p_kind));
  IF v_kind NOT IN ('delivered', 'read') THEN
    RAISE EXCEPTION 'Invalid receipt kind';
  END IF;

  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  -- Only agent (and system) sequences matter for visitor receipts of operator replies,
  -- but cursors are conversation-global sequence numbers for O(1) derivation.
  SELECT COALESCE(max(m.sequence_number), 0)
  INTO v_max_sequence
  FROM public.messages m
  WHERE m.conversation_id = v_conversation.id
    AND m.workspace_id = p_workspace_id
    AND m.is_internal = false;

  v_through := LEAST(GREATEST(COALESCE(p_through_sequence, 0), 0), v_max_sequence);

  SELECT
    r.last_read_sequence,
    r.last_delivered_sequence,
    true
  INTO v_existing_read, v_existing_delivered, v_has_row
  FROM public.conversation_visitor_reads r
  WHERE r.conversation_id = v_conversation.id;

  IF NOT FOUND THEN
    v_existing_read := 0;
    v_existing_delivered := 0;
    v_has_row := false;
  END IF;

  IF v_kind = 'delivered' THEN
    IF v_has_row AND v_through <= v_existing_delivered THEN
      RETURN jsonb_build_object(
        'last_delivered_sequence', v_existing_delivered,
        'last_read_sequence', v_existing_read,
        'updated', false
      );
    END IF;

    INSERT INTO public.conversation_visitor_reads (
      workspace_id,
      conversation_id,
      visitor_session_id,
      last_read_sequence,
      last_delivered_sequence,
      last_delivered_at
    )
    VALUES (
      p_workspace_id,
      v_conversation.id,
      v_session.id,
      0,
      v_through,
      now()
    )
    ON CONFLICT (conversation_id) DO UPDATE
    SET
      last_delivered_sequence = GREATEST(
        public.conversation_visitor_reads.last_delivered_sequence,
        EXCLUDED.last_delivered_sequence
      ),
      last_delivered_at = CASE
        WHEN EXCLUDED.last_delivered_sequence > public.conversation_visitor_reads.last_delivered_sequence
          THEN now()
        ELSE public.conversation_visitor_reads.last_delivered_at
      END,
      visitor_session_id = EXCLUDED.visitor_session_id,
      updated_at = now();

    v_updated := true;
  ELSE
    -- read implies delivered through the same sequence
    IF v_has_row AND v_through <= v_existing_read THEN
      RETURN jsonb_build_object(
        'last_delivered_sequence', v_existing_delivered,
        'last_read_sequence', v_existing_read,
        'updated', false
      );
    END IF;

    INSERT INTO public.conversation_visitor_reads (
      workspace_id,
      conversation_id,
      visitor_session_id,
      last_read_sequence,
      last_delivered_sequence,
      last_read_at,
      last_delivered_at
    )
    VALUES (
      p_workspace_id,
      v_conversation.id,
      v_session.id,
      v_through,
      v_through,
      now(),
      now()
    )
    ON CONFLICT (conversation_id) DO UPDATE
    SET
      last_read_sequence = GREATEST(
        public.conversation_visitor_reads.last_read_sequence,
        EXCLUDED.last_read_sequence
      ),
      last_delivered_sequence = GREATEST(
        public.conversation_visitor_reads.last_delivered_sequence,
        EXCLUDED.last_delivered_sequence
      ),
      last_read_at = CASE
        WHEN EXCLUDED.last_read_sequence > public.conversation_visitor_reads.last_read_sequence
          THEN now()
        ELSE public.conversation_visitor_reads.last_read_at
      END,
      last_delivered_at = CASE
        WHEN EXCLUDED.last_delivered_sequence > public.conversation_visitor_reads.last_delivered_sequence
          THEN now()
        ELSE public.conversation_visitor_reads.last_delivered_at
      END,
      visitor_session_id = EXCLUDED.visitor_session_id,
      updated_at = now();

    v_updated := true;
  END IF;

  SELECT r.last_read_sequence, r.last_delivered_sequence
  INTO v_existing_read, v_existing_delivered
  FROM public.conversation_visitor_reads r
  WHERE r.conversation_id = v_conversation.id;

  RETURN jsonb_build_object(
    'last_delivered_sequence', COALESCE(v_existing_delivered, 0),
    'last_read_sequence', COALESCE(v_existing_read, 0),
    'updated', v_updated
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_mark_conversation_receipt(
  p_workspace_id uuid,
  p_session_token text,
  p_kind text,
  p_through_sequence bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_mark_conversation_receipt(
    p_workspace_id,
    p_session_token,
    p_kind,
    p_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.widget_mark_conversation_receipt(uuid, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_mark_conversation_receipt(uuid, text, text, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_mark_conversation_receipt(uuid, text, text, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- Widget list messages: include peer (agent) receipt cursors for UI derivation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_list_visitor_messages(
  p_workspace_id uuid,
  p_session_token text,
  p_limit integer DEFAULT 50,
  p_before_sequence bigint DEFAULT NULL,
  p_after_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_conversation public.conversations;
  v_items jsonb;
  v_oldest_sequence bigint;
  v_has_older boolean;
  v_fetched_count integer;
  v_agent_read bigint;
  v_agent_delivered bigint;
  v_visitor_read bigint;
  v_visitor_delivered bigint;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'Invalid message limit';
  END IF;

  IF p_before_sequence IS NOT NULL AND p_after_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot use before_sequence and after_sequence together';
  END IF;

  v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

  IF v_conversation IS NULL THEN
    RETURN jsonb_build_object(
      'items', '[]'::jsonb,
      'has_older', false,
      'oldest_sequence', NULL,
      'agent_last_read_sequence', 0,
      'agent_last_delivered_sequence', 0,
      'visitor_last_read_sequence', 0,
      'visitor_last_delivered_sequence', 0
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(m)::jsonb ORDER BY m.sequence_number ASC), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      msg.id,
      msg.sequence_number,
      msg.sender_type,
      msg.body,
      msg.client_message_id,
      msg.created_at
    FROM public.messages msg
    WHERE msg.conversation_id = v_conversation.id
      AND msg.workspace_id = p_workspace_id
      AND msg.is_internal = false
      AND msg.sender_type IN ('visitor', 'agent', 'system')
      AND (p_before_sequence IS NULL OR msg.sequence_number < p_before_sequence)
      AND (p_after_sequence IS NULL OR msg.sequence_number > p_after_sequence)
    ORDER BY
      CASE WHEN p_after_sequence IS NOT NULL THEN msg.sequence_number END ASC,
      CASE WHEN p_after_sequence IS NULL THEN msg.sequence_number END DESC
    LIMIT p_limit
  ) m;

  SELECT count(*)
  INTO v_fetched_count
  FROM jsonb_array_elements(v_items);

  IF v_fetched_count > 0 AND p_after_sequence IS NULL THEN
    SELECT (elem ->> 'sequence_number')::bigint
    INTO v_oldest_sequence
    FROM jsonb_array_elements(v_items) AS elem
    ORDER BY (elem ->> 'sequence_number')::bigint ASC
    LIMIT 1;

    SELECT EXISTS (
      SELECT 1
      FROM public.messages msg
      WHERE msg.conversation_id = v_conversation.id
        AND msg.workspace_id = p_workspace_id
        AND msg.is_internal = false
        AND msg.sender_type IN ('visitor', 'agent', 'system')
        AND msg.sequence_number < v_oldest_sequence
    )
    INTO v_has_older;
  ELSE
    v_oldest_sequence := NULL;
    v_has_older := false;
  END IF;

  SELECT a.last_read_sequence, a.last_delivered_sequence
  INTO v_agent_read, v_agent_delivered
  FROM app_private.agent_receipt_cursors(v_conversation.id) a;

  SELECT v.last_read_sequence, v.last_delivered_sequence
  INTO v_visitor_read, v_visitor_delivered
  FROM app_private.visitor_receipt_cursors(v_conversation.id) v;

  RETURN jsonb_build_object(
    'items', v_items,
    'has_older', COALESCE(v_has_older, false),
    'oldest_sequence', v_oldest_sequence,
    'agent_last_read_sequence', COALESCE(v_agent_read, 0),
    'agent_last_delivered_sequence', COALESCE(v_agent_delivered, 0),
    'visitor_last_read_sequence', COALESCE(v_visitor_read, 0),
    'visitor_last_delivered_sequence', COALESCE(v_visitor_delivered, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_list_visitor_messages(
  p_workspace_id uuid,
  p_session_token text,
  p_limit integer DEFAULT 50,
  p_before_sequence bigint DEFAULT NULL,
  p_after_sequence bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_list_visitor_messages(
    p_workspace_id,
    p_session_token,
    p_limit,
    p_before_sequence,
    p_after_sequence
  );
END;
$$;
