-- Customer Timeline foundation
-- Durable customer_timeline_events store + DB-side emission + keyset list RPC.
-- See docs/CUSTOMER-TIMELINE.md and docs/adr/ADR-004-customer-timeline-events.md.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE public.customer_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  contact_id uuid NOT NULL,
  visitor_session_id uuid,
  conversation_id uuid,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_member_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{"v":1}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text,
  CONSTRAINT uq_customer_timeline_events_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_customer_timeline_events_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_customer_timeline_events_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_customer_timeline_events_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_customer_timeline_events_actor_member_workspace
    FOREIGN KEY (actor_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_customer_timeline_events_event_type CHECK (
    event_type IN (
      'page_viewed',
      'conversation_started',
      'visitor_message_sent',
      'operator_message_sent',
      'attachment_uploaded',
      'visitor_identified',
      'visitor_profile_updated',
      'conversation_status_changed',
      'conversation_assigned'
    )
  ),
  CONSTRAINT chk_customer_timeline_events_actor_type CHECK (
    actor_type IN ('visitor', 'operator', 'system', 'host')
  ),
  CONSTRAINT chk_customer_timeline_events_metadata_object CHECK (
    jsonb_typeof(metadata_json) = 'object'
  ),
  CONSTRAINT chk_customer_timeline_events_dedupe_key_len CHECK (
    dedupe_key IS NULL OR char_length(dedupe_key) <= 256
  )
);

COMMENT ON TABLE public.customer_timeline_events IS
  'Durable customer/product history events for operator Timeline, CRM, AI context. '
  'Not debug telemetry. Emitted from durable DB actions with dedupe_key idempotency.';

COMMENT ON COLUMN public.customer_timeline_events.metadata_json IS
  'Compact versioned metadata (v). Never store signed URLs, tokens, secrets, or message bodies.';

COMMENT ON COLUMN public.customer_timeline_events.dedupe_key IS
  'Workspace-scoped idempotency key. Retries/conflicts insert once via unique index.';

-- Primary contact timeline lookup (newest first keyset).
CREATE INDEX idx_customer_timeline_events_contact_occurred
  ON public.customer_timeline_events (workspace_id, contact_id, occurred_at DESC, id DESC);

-- Optional conversation-scoped filter within a contact timeline.
CREATE INDEX idx_customer_timeline_events_conversation_occurred
  ON public.customer_timeline_events (workspace_id, conversation_id, occurred_at DESC, id DESC)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX idx_customer_timeline_events_session
  ON public.customer_timeline_events (visitor_session_id)
  WHERE visitor_session_id IS NOT NULL;

CREATE UNIQUE INDEX uq_customer_timeline_events_dedupe
  ON public.customer_timeline_events (workspace_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_timeline_events FORCE ROW LEVEL SECURITY;

CREATE POLICY customer_timeline_events_select_member
  ON public.customer_timeline_events
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

-- No direct INSERT/UPDATE/DELETE for authenticated/anon — SECURITY DEFINER only.
REVOKE ALL ON TABLE public.customer_timeline_events FROM PUBLIC;
REVOKE ALL ON TABLE public.customer_timeline_events FROM anon;
REVOKE ALL ON TABLE public.customer_timeline_events FROM authenticated;
GRANT SELECT ON TABLE public.customer_timeline_events TO authenticated;

-- Realtime: operators subscribe to INSERTs filtered by contact_id (RLS applies).
ALTER TABLE public.customer_timeline_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'customer_timeline_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_timeline_events;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Emit helper (idempotent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.emit_customer_timeline_event(
  p_workspace_id uuid,
  p_contact_id uuid,
  p_event_type text,
  p_actor_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_visitor_session_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_actor_member_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(),
  p_dedupe_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_meta jsonb;
BEGIN
  IF p_workspace_id IS NULL OR p_contact_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Refuse events that cannot be attributed to a workspace contact.
  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = p_contact_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RETURN NULL;
  END IF;

  v_meta := COALESCE(p_metadata, '{}'::jsonb);
  IF jsonb_typeof(v_meta) <> 'object' THEN
    v_meta := '{}'::jsonb;
  END IF;
  IF NOT (v_meta ? 'v') THEN
    v_meta := jsonb_set(v_meta, '{v}', '1'::jsonb, true);
  END IF;

  -- Strip known-dangerous keys if a caller accidentally includes them.
  v_meta := v_meta
    - 'continuity_token'
    - 'continuity_token_hash'
    - 'session_token'
    - 'access_token'
    - 'refresh_token'
    - 'signed_url'
    - 'signedUrl'
    - 'download_url'
    - 'upload_url'
    - 'authorization'
    - 'password'
    - 'secret'
    - 'api_key'
    - 'apiKey'
    - 'prompt'
    - 'raw_prompt'
    - 'body'
    - 'message_body';

  INSERT INTO public.customer_timeline_events (
    workspace_id,
    contact_id,
    visitor_session_id,
    conversation_id,
    event_type,
    actor_type,
    actor_member_id,
    metadata_json,
    occurred_at,
    dedupe_key
  )
  VALUES (
    p_workspace_id,
    p_contact_id,
    p_visitor_session_id,
    p_conversation_id,
    p_event_type,
    p_actor_type,
    p_actor_member_id,
    v_meta,
    COALESCE(p_occurred_at, now()),
    NULLIF(p_dedupe_key, '')
  )
  ON CONFLICT (workspace_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app_private.emit_customer_timeline_event(
  uuid, uuid, text, text, jsonb, uuid, uuid, uuid, timestamptz, text
) IS
  'Insert a customer timeline event. Idempotent on (workspace_id, dedupe_key). '
  'Strips forbidden metadata keys. Returns NULL when skipped/conflicted.';

-- Resolve contact_id for a conversation (denormalized or via session).
CREATE OR REPLACE FUNCTION app_private.timeline_contact_for_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    c.contact_id,
    vs.contact_id
  )
  FROM public.conversations c
  LEFT JOIN public.visitor_sessions vs
    ON vs.id = c.visitor_session_id
   AND vs.workspace_id = c.workspace_id
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: page views
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.trg_visitor_page_views_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  v_contact_id := NEW.contact_id;
  IF v_contact_id IS NULL THEN
    SELECT vs.contact_id
    INTO v_contact_id
    FROM public.visitor_sessions vs
    WHERE vs.id = NEW.visitor_session_id
      AND vs.workspace_id = NEW.workspace_id;
  END IF;

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM app_private.emit_customer_timeline_event(
    NEW.workspace_id,
    v_contact_id,
    'page_viewed',
    'visitor',
    jsonb_build_object(
      'v', 1,
      'url', NEW.url,
      'title', NEW.title,
      'page_view_id', NEW.id
    ),
    NEW.visitor_session_id,
    NULL,
    NULL,
    NEW.created_at,
    'page_view:' || NEW.id::text
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visitor_page_views_timeline
  AFTER INSERT ON public.visitor_page_views
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_visitor_page_views_timeline();

-- ---------------------------------------------------------------------------
-- Triggers: conversations (started / status / assigned)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.trg_conversations_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_label text;
BEGIN
  v_contact_id := COALESCE(
    NEW.contact_id,
    (
      SELECT vs.contact_id
      FROM public.visitor_sessions vs
      WHERE vs.id = NEW.visitor_session_id
        AND vs.workspace_id = NEW.workspace_id
    )
  );

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      'conversation_started',
      'visitor',
      jsonb_build_object(
        'v', 1,
        'channel_type', NEW.channel_type::text
      ),
      NEW.visitor_session_id,
      NEW.id,
      NULL,
      NEW.created_at,
      'conversation:' || NEW.id::text || ':started'
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      'conversation_status_changed',
      CASE
        WHEN app_private.get_caller_member_id(NEW.workspace_id) IS NOT NULL THEN 'operator'
        ELSE 'system'
      END,
      jsonb_build_object(
        'v', 1,
        'from_status', OLD.status::text,
        'to_status', NEW.status::text
      ),
      NEW.visitor_session_id,
      NEW.id,
      app_private.get_caller_member_id(NEW.workspace_id),
      now(),
      'conversation:' || NEW.id::text || ':status:' || OLD.status::text || ':' || NEW.status::text || ':' || floor(extract(epoch FROM now()) * 1000)::text
    );
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    IF NEW.assigned_to IS NOT NULL THEN
      v_label := app_private.member_display_label(NEW.assigned_to);
    ELSE
      v_label := NULL;
    END IF;

    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      'conversation_assigned',
      'operator',
      jsonb_build_object(
        'v', 1,
        'assignee_member_id', NEW.assigned_to,
        'assignee_label', v_label,
        'previous_assignee_member_id', OLD.assigned_to
      ),
      NEW.visitor_session_id,
      NEW.id,
      app_private.get_caller_member_id(NEW.workspace_id),
      now(),
      'conversation:' || NEW.id::text || ':assigned:' || coalesce(NEW.assigned_to::text, 'none') || ':' || floor(extract(epoch FROM now()) * 1000)::text
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_conversations_timeline
  AFTER INSERT OR UPDATE OF status, assigned_to ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_conversations_timeline();

-- ---------------------------------------------------------------------------
-- Triggers: messages (concise; skip attachment-bearing + internal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.trg_messages_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_session_id uuid;
  v_event_type text;
  v_actor_type text;
  v_dedupe text;
BEGIN
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  -- Attachment finalize stores attachments in metadata_json; those emit
  -- attachment_uploaded instead (avoid duplicating the chat transcript).
  IF NEW.metadata_json ? 'attachments' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type = 'visitor' THEN
    v_event_type := 'visitor_message_sent';
    v_actor_type := 'visitor';
  ELSIF NEW.sender_type = 'agent' THEN
    v_event_type := 'operator_message_sent';
    v_actor_type := 'operator';
  ELSE
    RETURN NEW;
  END IF;

  v_contact_id := app_private.timeline_contact_for_conversation(
    NEW.workspace_id,
    NEW.conversation_id
  );

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_session_id := NEW.visitor_session_id;
  IF v_session_id IS NULL THEN
    SELECT c.visitor_session_id
    INTO v_session_id
    FROM public.conversations c
    WHERE c.id = NEW.conversation_id
      AND c.workspace_id = NEW.workspace_id;
  END IF;

  IF NEW.client_message_id IS NOT NULL THEN
    v_dedupe := 'message:client:' || NEW.conversation_id::text || ':' || NEW.client_message_id::text;
  ELSE
    v_dedupe := 'message:' || NEW.id::text;
  END IF;

  PERFORM app_private.emit_customer_timeline_event(
    NEW.workspace_id,
    v_contact_id,
    v_event_type,
    v_actor_type,
    jsonb_build_object(
      'v', 1,
      'message_id', NEW.id,
      'client_message_id', NEW.client_message_id
    ),
    v_session_id,
    NEW.conversation_id,
    NEW.agent_member_id,
    NEW.created_at,
    v_dedupe
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_messages_timeline
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_messages_timeline();

-- ---------------------------------------------------------------------------
-- Triggers: attachments (one event per message; safe filename only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.trg_message_attachments_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_session_id uuid;
  v_message public.messages;
  v_count integer;
  v_filename text;
BEGIN
  -- Emit once per message (first attachment by sort_order / insert).
  IF NEW.sort_order IS NOT NULL AND NEW.sort_order > 0 THEN
    -- Still allow first-inserted when sort_order not zero; dedupe_key handles it.
    NULL;
  END IF;

  SELECT *
  INTO v_message
  FROM public.messages m
  WHERE m.id = NEW.message_id
    AND m.workspace_id = NEW.workspace_id;

  IF NOT FOUND OR v_message.is_internal THEN
    RETURN NEW;
  END IF;

  v_contact_id := app_private.timeline_contact_for_conversation(
    NEW.workspace_id,
    NEW.conversation_id
  );
  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.visitor_session_id
  INTO v_session_id
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id
    AND c.workspace_id = NEW.workspace_id;

  v_count := COALESCE(
    jsonb_array_length(v_message.metadata_json -> 'attachments'),
    1
  );

  v_filename := NEW.filename;
  -- Defense: strip path separators from stored display name.
  v_filename := regexp_replace(COALESCE(v_filename, 'file'), '.*[/\\]', '');
  v_filename := left(v_filename, 255);

  PERFORM app_private.emit_customer_timeline_event(
    NEW.workspace_id,
    v_contact_id,
    'attachment_uploaded',
    CASE WHEN v_message.sender_type = 'agent' THEN 'operator' ELSE 'visitor' END,
    jsonb_build_object(
      'v', 1,
      'message_id', NEW.message_id,
      'filename', v_filename,
      'mime_type', NEW.mime_type,
      'kind', NEW.kind::text,
      'attachment_count', v_count
    ),
    COALESCE(v_message.visitor_session_id, v_session_id),
    NEW.conversation_id,
    v_message.agent_member_id,
    NEW.created_at,
    'message:' || NEW.message_id::text || ':attachment'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_attachments_timeline
  AFTER INSERT ON public.message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_message_attachments_timeline();

-- ---------------------------------------------------------------------------
-- List RPC (keyset pagination)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_customer_timeline(
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
  v_contact_id uuid;
  v_conversation_id uuid;
  v_limit integer;
  v_before_occurred timestamptz;
  v_before_id uuid;
  v_events jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace not accessible';
  END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'query must be an object';
  END IF;

  v_contact_id := NULLIF(p_query ->> 'contact_id', '')::uuid;
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = v_contact_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  v_conversation_id := NULLIF(p_query ->> 'conversation_id', '')::uuid;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 20);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  IF p_query ? 'before' AND p_query -> 'before' IS NOT NULL AND p_query -> 'before' <> 'null'::jsonb THEN
    v_before_occurred := (p_query -> 'before' ->> 'occurred_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_occurred IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'Invalid before cursor';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_event ORDER BY ordinality), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT
      jsonb_build_object(
        'id', e.id,
        'workspace_id', e.workspace_id,
        'contact_id', e.contact_id,
        'visitor_session_id', e.visitor_session_id,
        'conversation_id', e.conversation_id,
        'event_type', e.event_type,
        'actor_type', e.actor_type,
        'actor_member_id', e.actor_member_id,
        'metadata_json', e.metadata_json,
        'occurred_at', e.occurred_at,
        'created_at', e.created_at,
        'dedupe_key', e.dedupe_key
      ) AS row_to_event,
      ordinality
    FROM (
      SELECT e.*
      FROM public.customer_timeline_events e
      WHERE e.workspace_id = p_workspace_id
        AND e.contact_id = v_contact_id
        AND (v_conversation_id IS NULL OR e.conversation_id = v_conversation_id)
        AND (
          v_before_occurred IS NULL
          OR (e.occurred_at, e.id) < (v_before_occurred, v_before_id)
        )
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT v_limit + 1
    ) e
    WITH ORDINALITY AS t(e, ordinality)
  ) ranked
  WHERE ordinality <= v_limit;

  IF (
    SELECT count(*)
    FROM public.customer_timeline_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.contact_id = v_contact_id
      AND (v_conversation_id IS NULL OR e.conversation_id = v_conversation_id)
      AND (
        v_before_occurred IS NULL
        OR (e.occurred_at, e.id) < (v_before_occurred, v_before_id)
      )
  ) > v_limit THEN
    v_has_more := true;
  END IF;

  -- Cheaper has_more: based on fetched page size
  IF jsonb_array_length(v_events) = v_limit THEN
    -- Confirm there is at least one older row beyond the page.
    v_last := v_events -> (jsonb_array_length(v_events) - 1);
    IF v_last IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.customer_timeline_events e
        WHERE e.workspace_id = p_workspace_id
          AND e.contact_id = v_contact_id
          AND (v_conversation_id IS NULL OR e.conversation_id = v_conversation_id)
          AND (e.occurred_at, e.id) < (
            (v_last ->> 'occurred_at')::timestamptz,
            (v_last ->> 'id')::uuid
          )
      ) INTO v_has_more;
    END IF;
  ELSE
    v_has_more := false;
  END IF;

  IF v_has_more AND jsonb_array_length(v_events) > 0 THEN
    v_last := v_events -> (jsonb_array_length(v_events) - 1);
    v_next := jsonb_build_object(
      'occurred_at', v_last ->> 'occurred_at',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'events', v_events,
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$$;

-- Fix list query: the WITH ORDINALITY subquery above is overly complex / possibly wrong.
-- Replace with a clearer implementation.
CREATE OR REPLACE FUNCTION app_private.list_customer_timeline(
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
  v_contact_id uuid;
  v_conversation_id uuid;
  v_limit integer;
  v_before_occurred timestamptz;
  v_before_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace not accessible';
  END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'query must be an object';
  END IF;

  v_contact_id := NULLIF(p_query ->> 'contact_id', '')::uuid;
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = v_contact_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  v_conversation_id := NULLIF(p_query ->> 'conversation_id', '')::uuid;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 20);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  IF p_query ? 'before'
     AND p_query -> 'before' IS NOT NULL
     AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_occurred := (p_query -> 'before' ->> 'occurred_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_occurred IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'Invalid before cursor';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'workspace_id', q.workspace_id,
        'contact_id', q.contact_id,
        'visitor_session_id', q.visitor_session_id,
        'conversation_id', q.conversation_id,
        'event_type', q.event_type,
        'actor_type', q.actor_type,
        'actor_member_id', q.actor_member_id,
        'metadata_json', q.metadata_json,
        'occurred_at', q.occurred_at,
        'created_at', q.created_at,
        'dedupe_key', q.dedupe_key
      )
      ORDER BY q.occurred_at DESC, q.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT e.*
    FROM public.customer_timeline_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.contact_id = v_contact_id
      AND (v_conversation_id IS NULL OR e.conversation_id = v_conversation_id)
      AND (
        v_before_occurred IS NULL
        OR (e.occurred_at < v_before_occurred)
        OR (e.occurred_at = v_before_occurred AND e.id < v_before_id)
      )
    ORDER BY e.occurred_at DESC, e.id DESC
    LIMIT v_limit + 1
  ) q;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    SELECT jsonb_agg(value)
    INTO v_rows
    FROM (
      SELECT value
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(value, ord)
      WHERE ord <= v_limit
      ORDER BY ord
    ) trimmed;
  END IF;

  IF v_has_more AND jsonb_array_length(v_rows) > 0 THEN
    v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
    v_next := jsonb_build_object(
      'occurred_at', v_last ->> 'occurred_at',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_customer_timeline(
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
  RETURN app_private.list_customer_timeline(p_workspace_id, p_query);
END;
$$;

REVOKE ALL ON FUNCTION public.list_customer_timeline(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_customer_timeline(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_customer_timeline(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.list_customer_timeline(uuid, jsonb) IS
  'Operator keyset-paginated customer timeline for a contact. Membership via workspace_is_accessible.';


-- ---------------------------------------------------------------------------
-- Identity emission: widget_identify_visitor (only on actual changes)
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
  v_before public.contacts;
  v_name text;
  v_email text;
  v_phone text;
  v_phone_e164 text;
  v_has_name boolean := false;
  v_has_email boolean := false;
  v_has_phone boolean := false;
  v_has_phone_e164 boolean := false;
  v_changes jsonb := '[]'::jsonb;
  v_was_anonymous boolean := false;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

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

  v_before := v_contact;
  v_was_anonymous := (v_before.email IS NULL AND v_before.name IS NULL AND v_before.phone IS NULL);

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

  UPDATE public.conversations c
  SET
    contact_id = COALESCE(c.contact_id, v_contact.id),
    updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = v_session.id
    AND c.status IN ('open', 'pending');

  -- Timeline: only when profile fields actually change (ignore attributes-only / no-ops).
  IF v_has_name AND v_before.name IS DISTINCT FROM v_contact.name THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'name', 'from', v_before.name, 'to', v_contact.name)
    );
  END IF;
  IF v_has_email AND v_before.email IS DISTINCT FROM v_contact.email THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'email', 'from', v_before.email, 'to', v_contact.email)
    );
  END IF;
  IF v_has_phone AND v_before.phone IS DISTINCT FROM v_contact.phone THEN
    v_changes := v_changes || jsonb_build_array(
      jsonb_build_object('field', 'phone', 'from', v_before.phone, 'to', v_contact.phone)
    );
  END IF;

  IF jsonb_array_length(v_changes) > 0 THEN
    IF v_was_anonymous AND (v_contact.email IS NOT NULL OR v_contact.name IS NOT NULL) THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'visitor_identified',
        'host',
        jsonb_build_object(
          'v', 1,
          'name', v_contact.name,
          'email', v_contact.email,
          'phone', v_contact.phone,
          'changes', v_changes
        ),
        v_session.id,
        NULL,
        NULL,
        now(),
        'contact:' || v_contact.id::text || ':identified:' || md5(v_changes::text)
      );
    ELSE
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact.id,
        'visitor_profile_updated',
        'host',
        jsonb_build_object(
          'v', 1,
          'changes', v_changes,
          'source', 'host'
        ),
        v_session.id,
        NULL,
        NULL,
        now(),
        'contact:' || v_contact.id::text || ':profile:' || md5(v_changes::text) || ':' || floor(extract(epoch FROM now()) * 1000)::text
      );
    END IF;
  END IF;

  RETURN app_private.visitor_profile_json(v_contact);
END;
$$;

COMMENT ON FUNCTION app_private.widget_identify_visitor(
  uuid, text, text, text, text, text, jsonb
) IS
  'Unsigned widget/host identify: patches the session contact only. Does NOT merge contacts '
  'by email. Emits visitor_identified / visitor_profile_updated timeline events only when '
  'name/email/phone actually change. No-op patches create no timeline rows.';

-- ---------------------------------------------------------------------------
-- Identity emission: update_visitor_profile (operator; no-op safe)
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
  v_changes jsonb := '[]'::jsonb;
  v_member_id uuid;
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

  RETURN app_private.visitor_profile_json(v_contact);
END;
$$;

COMMENT ON FUNCTION app_private.update_visitor_profile(uuid, uuid, jsonb) IS
  'Operator profile patch. Emits visitor_profile_updated only when fields change. '
  'No-op patches create no timeline events. Does not bump last_seen_at.';

-- ---------------------------------------------------------------------------
-- Privileges (hardened app_private EXECUTE)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.list_customer_timeline(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_customer_timeline(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_customer_timeline(uuid, jsonb) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
