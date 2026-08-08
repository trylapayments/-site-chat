-- Phase 3: message attachments (private storage, signed URLs, no ghost messages)
-- Forward-only migration.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.app_attachment_kind AS ENUM ('image', 'document');
CREATE TYPE public.app_attachment_scan_status AS ENUM (
  'pending',
  'clean',
  'infected',
  'skipped',
  'error'
);
CREATE TYPE public.app_attachment_upload_status AS ENUM (
  'pending',
  'uploaded',
  'confirmed',
  'failed',
  'cancelled',
  'expired'
);

-- ---------------------------------------------------------------------------
-- attachment_uploads — pending intents (message created only after confirm)
-- ---------------------------------------------------------------------------

CREATE TABLE public.attachment_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  attachment_id uuid NOT NULL DEFAULT gen_random_uuid(),
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  kind public.app_attachment_kind NOT NULL,
  width integer NULL CHECK (width IS NULL OR width > 0),
  height integer NULL CHECK (height IS NULL OR height > 0),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  status public.app_attachment_upload_status NOT NULL DEFAULT 'pending',
  actor_role text NOT NULL CHECK (actor_role IN ('visitor', 'operator')),
  visitor_session_id uuid NULL,
  agent_member_id uuid NULL,
  client_message_id uuid NULL,
  body_draft text NOT NULL DEFAULT '',
  error_code text NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_attachment_uploads_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT uq_attachment_uploads_attachment_id UNIQUE (attachment_id),
  CONSTRAINT uq_attachment_uploads_storage_key UNIQUE (storage_key),
  CONSTRAINT fk_attachment_uploads_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_attachment_uploads_visitor_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_attachment_uploads_agent_member_workspace
    FOREIGN KEY (agent_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_attachment_uploads_actor CHECK (
    (actor_role = 'visitor' AND visitor_session_id IS NOT NULL)
    OR (actor_role = 'operator' AND agent_member_id IS NOT NULL)
  )
);

CREATE INDEX idx_attachment_uploads_workspace ON public.attachment_uploads (workspace_id);
CREATE INDEX idx_attachment_uploads_conversation ON public.attachment_uploads (conversation_id);
CREATE INDEX idx_attachment_uploads_batch ON public.attachment_uploads (batch_id);
CREATE INDEX idx_attachment_uploads_status_expires
  ON public.attachment_uploads (status, expires_at)
  WHERE status IN ('pending', 'uploaded');

CREATE TRIGGER trg_attachment_uploads_set_updated_at
  BEFORE UPDATE ON public.attachment_uploads
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- message_attachments — durable attachment metadata
-- ---------------------------------------------------------------------------

CREATE TABLE public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  storage_key text NOT NULL,
  thumbnail_storage_key text NULL,
  mime_type text NOT NULL,
  filename text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  kind public.app_attachment_kind NOT NULL,
  width integer NULL CHECK (width IS NULL OR width > 0),
  height integer NULL CHECK (height IS NULL OR height > 0),
  duration_ms integer NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
  scan_status public.app_attachment_scan_status NOT NULL DEFAULT 'skipped',
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_message_attachments_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT uq_message_attachments_storage_key UNIQUE (storage_key),
  CONSTRAINT fk_message_attachments_message_workspace
    FOREIGN KEY (message_id, workspace_id)
    REFERENCES public.messages (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_message_attachments_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_message_attachments_message ON public.message_attachments (message_id);
CREATE INDEX idx_message_attachments_conversation ON public.message_attachments (conversation_id);
CREATE INDEX idx_message_attachments_workspace ON public.message_attachments (workspace_id);
CREATE INDEX idx_message_attachments_message_sort
  ON public.message_attachments (message_id, sort_order);

CREATE TRIGGER trg_message_attachments_set_updated_at
  BEFORE UPDATE ON public.message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- Composite key on messages for tenant-consistent FK (if missing)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_messages_id_workspace'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT uq_messages_id_workspace UNIQUE (id, workspace_id);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.attachment_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- Pending uploads: no direct client access (service role / security definer only)
-- Message attachments: workspace members can SELECT (viewers excluded from internals via messages)

CREATE POLICY message_attachments_select_authenticated
  ON public.message_attachments
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = message_attachments.message_id
        AND m.workspace_id = message_attachments.workspace_id
        AND (
          app_private.user_workspace_role(message_attachments.workspace_id) <> 'viewer'
          OR m.is_internal = false
        )
    )
  );

REVOKE ALL ON public.attachment_uploads FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.message_attachments FROM PUBLIC, anon;
GRANT SELECT ON public.message_attachments TO authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket (never public)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  52428800,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Deny direct anon/authenticated storage access — only signed URLs / service role.
DROP POLICY IF EXISTS attachments_storage_deny_all ON storage.objects;
CREATE POLICY attachments_storage_select_authenticated
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT app_private.user_workspace_ids()
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated on attachments bucket.
-- Uploads go through signed upload URLs minted by the service role.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.sanitize_optional_message_body(p_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_body text;
BEGIN
  v_body := trim(COALESCE(p_body, ''));
  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message body exceeds maximum length';
  END IF;
  v_body := regexp_replace(v_body, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g');
  RETURN v_body;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.attachment_view_json(p_row public.message_attachments)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'filename', p_row.filename,
    'mime_type', p_row.mime_type,
    'size_bytes', p_row.size_bytes,
    'kind', p_row.kind::text,
    'width', p_row.width,
    'height', p_row.height,
    'duration_ms', p_row.duration_ms,
    'sort_order', p_row.sort_order,
    'has_thumbnail', (p_row.kind = 'image' OR p_row.thumbnail_storage_key IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION app_private.message_attachments_json(p_message_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      app_private.attachment_view_json(a)
      ORDER BY a.sort_order ASC, a.created_at ASC
    ),
    '[]'::jsonb
  )
  FROM public.message_attachments a
  WHERE a.message_id = p_message_id;
$$;

CREATE OR REPLACE FUNCTION app_private.message_preview_from_attachments(
  p_body text,
  p_attachment_count integer
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  IF length(trim(COALESCE(p_body, ''))) > 0 THEN
    RETURN left(trim(p_body), 200);
  END IF;
  IF p_attachment_count <= 0 THEN
    RETURN '';
  END IF;
  IF p_attachment_count = 1 THEN
    RETURN 'Sent an attachment';
  END IF;
  RETURN 'Sent ' || p_attachment_count::text || ' attachments';
END;
$$;

-- ---------------------------------------------------------------------------
-- Deferred broadcast including attachments (fires at transaction commit)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.broadcast_visitor_safe_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_topic_key text;
  v_payload jsonb;
  v_attachments jsonb;
BEGIN
  IF NEW.is_internal THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_type NOT IN ('visitor', 'agent', 'system') THEN
    RETURN NEW;
  END IF;

  SELECT c.visitor_realtime_topic_key
  INTO v_topic_key
  FROM public.conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_topic_key IS NULL THEN
    RETURN NEW;
  END IF;

  v_attachments := app_private.message_attachments_json(NEW.id);

  v_payload := jsonb_build_object(
    'type', 'message.created',
    'message', jsonb_build_object(
      'id', NEW.id,
      'sequenceNumber', NEW.sequence_number,
      'senderType', NEW.sender_type::text,
      'body', NEW.body,
      'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'clientMessageId', NEW.client_message_id,
      'attachments', v_attachments
    )
  );

  PERFORM realtime.send(
    v_payload,
    'message.created',
    'widget-conversation:' || v_topic_key,
    true
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_broadcast_visitor_safe ON public.messages;

CREATE CONSTRAINT TRIGGER trg_messages_broadcast_visitor_safe
  AFTER INSERT ON public.messages
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION app_private.broadcast_visitor_safe_message();

-- ---------------------------------------------------------------------------
-- list_messages — include attachments (+ client_message_id for reconciliation)
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

  IF v_before_sequence IS NOT NULL AND v_after_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot use before_sequence and after_sequence together';
  END IF;

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

  SELECT count(*)
  INTO v_fetched_count
  FROM jsonb_array_elements(v_items);

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

-- ---------------------------------------------------------------------------
-- widget_list_visitor_messages — include attachments
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
      msg.created_at,
      app_private.message_attachments_json(msg.id) AS attachments
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

-- ---------------------------------------------------------------------------
-- Ensure visitor conversation exists before minting storage keys
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_ensure_conversation_for_attachments(
  p_workspace_id uuid,
  p_session_token text,
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
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);

  UPDATE public.visitor_sessions vs
  SET
    expires_at = now() + interval '30 days',
    current_url = COALESCE(p_page_url, vs.current_url),
    referrer = COALESCE(p_referrer, vs.referrer),
    updated_at = now()
  WHERE vs.id = v_session.id;

  v_conversation := app_private.widget_get_or_create_conversation_for_send(
    p_workspace_id,
    v_session.id,
    v_session.locale,
    COALESCE(p_page_url, v_session.current_url, v_session.initial_url),
    COALESCE(p_referrer, v_session.referrer)
  );

  RETURN jsonb_build_object(
    'conversation_id', v_conversation.id,
    'status', v_conversation.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_ensure_conversation_for_attachments(
  p_workspace_id uuid,
  p_session_token text,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_ensure_conversation_for_attachments(
    p_workspace_id,
    p_session_token,
    p_page_url,
    p_referrer
  );
END;
$$;

REVOKE ALL ON FUNCTION public.widget_ensure_conversation_for_attachments(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_ensure_conversation_for_attachments(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_ensure_conversation_for_attachments(uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Finalize visitor attachment message (called after storage validation)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.finalize_visitor_attachment_message(
  p_workspace_id uuid,
  p_session_token text,
  p_batch_id uuid,
  p_upload_ids uuid[],
  p_body text DEFAULT '',
  p_client_message_id uuid DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_body text;
  v_conversation public.conversations;
  v_existing public.messages;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
  v_upload public.attachment_uploads;
  v_count integer;
  v_attachment jsonb;
  v_attachments_out jsonb;
  v_preview text;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_optional_message_body(p_body);

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one attachment is required';
  END IF;

  IF length(v_body) = 0 AND jsonb_array_length(p_attachments) < 1 THEN
    RAISE EXCEPTION 'Message body or attachments required';
  END IF;

  UPDATE public.visitor_sessions vs
  SET
    expires_at = now() + interval '30 days',
    current_url = COALESCE(p_page_url, vs.current_url),
    referrer = COALESCE(p_referrer, vs.referrer),
    updated_at = now()
  WHERE vs.id = v_session.id;

  v_conversation := app_private.widget_get_or_create_conversation_for_send(
    p_workspace_id,
    v_session.id,
    v_session.locale,
    COALESCE(p_page_url, v_session.current_url, v_session.initial_url),
    COALESCE(p_referrer, v_session.referrer)
  );

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.messages m
    WHERE m.conversation_id = v_conversation.id
      AND m.workspace_id = p_workspace_id
      AND m.client_message_id = p_client_message_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'message', jsonb_build_object(
          'id', v_existing.id,
          'sequence_number', v_existing.sequence_number,
          'sender_type', v_existing.sender_type,
          'body', v_existing.body,
          'created_at', v_existing.created_at,
          'client_message_id', v_existing.client_message_id,
          'attachments', app_private.message_attachments_json(v_existing.id)
        ),
        'conversation_status', v_conversation.status
      );
    END IF;
  END IF;

  -- Lock and validate upload intents
  SELECT count(*)
  INTO v_count
  FROM public.attachment_uploads u
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids)
    AND u.actor_role = 'visitor'
    AND u.visitor_session_id = v_session.id
    AND u.status = 'uploaded'
    AND u.expires_at > now()
    AND u.conversation_id = v_conversation.id;

  IF v_count <> cardinality(p_upload_ids) THEN
    RAISE EXCEPTION 'Invalid or expired upload intents';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id
  FOR UPDATE;

  v_sequence := v_conversation.next_message_sequence;
  v_preview := app_private.message_preview_from_attachments(
    v_body,
    jsonb_array_length(p_attachments)
  );

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = v_preview,
    updated_at = now()
  WHERE c.id = v_conversation.id
    AND c.workspace_id = p_workspace_id;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body,
    is_internal,
    client_message_id,
    metadata_json
  )
  VALUES (
    p_workspace_id,
    v_conversation.id,
    v_sequence,
    'visitor',
    v_session.id,
    v_body,
    false,
    p_client_message_id,
    jsonb_build_object('attachments', p_attachments)
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

  FOR v_attachment IN
    SELECT value
    FROM jsonb_array_elements(p_attachments)
  LOOP
    INSERT INTO public.message_attachments (
      id,
      workspace_id,
      message_id,
      conversation_id,
      storage_key,
      thumbnail_storage_key,
      mime_type,
      filename,
      size_bytes,
      kind,
      width,
      height,
      duration_ms,
      scan_status,
      sort_order,
      metadata_json
    )
    VALUES (
      (v_attachment ->> 'id')::uuid,
      p_workspace_id,
      v_message_id,
      v_conversation.id,
      v_attachment ->> 'storage_key',
      v_attachment ->> 'thumbnail_storage_key',
      v_attachment ->> 'mime_type',
      v_attachment ->> 'filename',
      (v_attachment ->> 'size_bytes')::bigint,
      (v_attachment ->> 'kind')::public.app_attachment_kind,
      NULLIF(v_attachment ->> 'width', '')::integer,
      NULLIF(v_attachment ->> 'height', '')::integer,
      NULLIF(v_attachment ->> 'duration_ms', '')::integer,
      COALESCE(
        NULLIF(v_attachment ->> 'scan_status', '')::public.app_attachment_scan_status,
        'skipped'
      ),
      COALESCE((v_attachment ->> 'sort_order')::integer, 0),
      COALESCE(v_attachment -> 'metadata_json', '{}'::jsonb)
    );
  END LOOP;

  UPDATE public.attachment_uploads u
  SET
    status = 'confirmed',
    updated_at = now()
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids);

  v_attachments_out := app_private.message_attachments_json(v_message_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message_id,
      'sequence_number', v_sequence,
      'sender_type', 'visitor',
      'body', v_body,
      'created_at', v_created_at,
      'client_message_id', p_client_message_id,
      'attachments', v_attachments_out
    ),
    'conversation_status', v_conversation.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_visitor_attachment_message(
  p_workspace_id uuid,
  p_session_token text,
  p_batch_id uuid,
  p_upload_ids uuid[],
  p_body text DEFAULT '',
  p_client_message_id uuid DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.finalize_visitor_attachment_message(
    p_workspace_id,
    p_session_token,
    p_batch_id,
    p_upload_ids,
    p_body,
    p_client_message_id,
    p_page_url,
    p_referrer,
    p_attachments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_visitor_attachment_message(
  uuid, text, uuid, uuid[], text, uuid, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_visitor_attachment_message(
  uuid, text, uuid, uuid[], text, uuid, text, text, jsonb
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_visitor_attachment_message(
  uuid, text, uuid, uuid[], text, uuid, text, text, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- Finalize operator attachment message
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.finalize_operator_attachment_message(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_batch_id uuid,
  p_upload_ids uuid[],
  p_body text DEFAULT '',
  p_client_message_id uuid DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_body text;
  v_existing public.messages;
  v_conversation public.conversations;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
  v_count integer;
  v_attachment jsonb;
  v_attachments_out jsonb;
  v_preview text;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  v_body := app_private.sanitize_optional_message_body(p_body);

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one attachment is required';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.workspace_id = p_workspace_id
      AND m.client_message_id = p_client_message_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'message', jsonb_build_object(
          'id', v_existing.id,
          'sequence_number', v_existing.sequence_number,
          'body', v_existing.body,
          'created_at', v_existing.created_at,
          'attachments', app_private.message_attachments_json(v_existing.id)
        ),
        'conversation', jsonb_build_object(
          'id', v_conversation.id,
          'status', v_conversation.status,
          'last_message_at', v_conversation.last_message_at
        )
      );
    END IF;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.attachment_uploads u
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids)
    AND u.actor_role = 'operator'
    AND u.agent_member_id = v_member_id
    AND u.status = 'uploaded'
    AND u.expires_at > now()
    AND u.conversation_id = p_conversation_id;

  IF v_count <> cardinality(p_upload_ids) THEN
    RAISE EXCEPTION 'Invalid or expired upload intents';
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  v_sequence := v_conversation.next_message_sequence;
  v_preview := app_private.message_preview_from_attachments(
    v_body,
    jsonb_array_length(p_attachments)
  );

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = v_preview,
    updated_at = now()
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    agent_member_id,
    body,
    is_internal,
    client_message_id,
    metadata_json
  )
  VALUES (
    p_workspace_id,
    p_conversation_id,
    v_sequence,
    'agent',
    v_member_id,
    v_body,
    false,
    p_client_message_id,
    jsonb_build_object('attachments', p_attachments)
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

  FOR v_attachment IN
    SELECT value
    FROM jsonb_array_elements(p_attachments)
  LOOP
    INSERT INTO public.message_attachments (
      id,
      workspace_id,
      message_id,
      conversation_id,
      storage_key,
      thumbnail_storage_key,
      mime_type,
      filename,
      size_bytes,
      kind,
      width,
      height,
      duration_ms,
      scan_status,
      sort_order,
      metadata_json
    )
    VALUES (
      (v_attachment ->> 'id')::uuid,
      p_workspace_id,
      v_message_id,
      p_conversation_id,
      v_attachment ->> 'storage_key',
      v_attachment ->> 'thumbnail_storage_key',
      v_attachment ->> 'mime_type',
      v_attachment ->> 'filename',
      (v_attachment ->> 'size_bytes')::bigint,
      (v_attachment ->> 'kind')::public.app_attachment_kind,
      NULLIF(v_attachment ->> 'width', '')::integer,
      NULLIF(v_attachment ->> 'height', '')::integer,
      NULLIF(v_attachment ->> 'duration_ms', '')::integer,
      COALESCE(
        NULLIF(v_attachment ->> 'scan_status', '')::public.app_attachment_scan_status,
        'skipped'
      ),
      COALESCE((v_attachment ->> 'sort_order')::integer, 0),
      COALESCE(v_attachment -> 'metadata_json', '{}'::jsonb)
    );
  END LOOP;

  UPDATE public.attachment_uploads u
  SET
    status = 'confirmed',
    updated_at = now()
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids);

  v_attachments_out := app_private.message_attachments_json(v_message_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message_id,
      'sequence_number', v_sequence,
      'body', v_body,
      'created_at', v_created_at,
      'attachments', v_attachments_out
    ),
    'conversation', jsonb_build_object(
      'id', v_conversation.id,
      'status', v_conversation.status,
      'last_message_at', v_conversation.last_message_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_operator_attachment_message(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_batch_id uuid,
  p_upload_ids uuid[],
  p_body text DEFAULT '',
  p_client_message_id uuid DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.finalize_operator_attachment_message(
    p_workspace_id,
    p_conversation_id,
    p_batch_id,
    p_upload_ids,
    p_body,
    p_client_message_id,
    p_attachments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_operator_attachment_message(
  uuid, uuid, uuid, uuid[], text, uuid, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_operator_attachment_message(
  uuid, uuid, uuid, uuid[], text, uuid, jsonb
) TO authenticated;

-- Mark upload intents as uploaded (service role; called after storage HEAD)
CREATE OR REPLACE FUNCTION public.mark_attachment_uploads_uploaded(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_upload_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.attachment_uploads u
  SET
    status = 'uploaded',
    updated_at = now()
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids)
    AND u.status = 'pending'
    AND u.expires_at > now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_attachment_uploads_uploaded(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_attachment_uploads_uploaded(uuid, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_attachment_uploads_uploaded(uuid, uuid, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_attachment_uploads(
  p_workspace_id uuid,
  p_batch_id uuid,
  p_upload_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.attachment_uploads u
  SET
    status = 'cancelled',
    updated_at = now()
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND (p_upload_ids IS NULL OR u.id = ANY (p_upload_ids))
    AND u.status IN ('pending', 'uploaded');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_attachment_uploads(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_attachment_uploads(uuid, uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_attachment_uploads(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_attachment_uploads(uuid, uuid, uuid[]) TO authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
