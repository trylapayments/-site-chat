-- Phase 4A: inbox foundation (contacts, conversations, messages, read state, RPCs)
-- Forward-only migration. See PR 4A implementation plan.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE public.app_conversation_status AS ENUM ('open', 'pending', 'resolved', 'closed');
CREATE TYPE public.app_message_sender_type AS ENUM ('visitor', 'agent', 'system');
CREATE TYPE public.app_message_delivery_status AS ENUM ('sent', 'delivered', 'failed');
CREATE TYPE public.app_channel_type AS ENUM ('widget');

-- ---------------------------------------------------------------------------
-- Composite parent keys for tenant-consistent FKs
-- ---------------------------------------------------------------------------

ALTER TABLE public.workspace_members
  ADD CONSTRAINT uq_workspace_members_id_workspace UNIQUE (id, workspace_id);

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------

CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  email text,
  name text,
  phone text,
  custom_attributes_json jsonb NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_contacts_id_workspace UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX uq_contacts_workspace_email
  ON public.contacts (workspace_id, lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX idx_contacts_workspace_id ON public.contacts (workspace_id);
CREATE INDEX idx_contacts_workspace_name ON public.contacts (workspace_id, name);

CREATE TRIGGER trg_contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- visitor_sessions (minimal — no privacy-sensitive metadata in 4A)
-- ---------------------------------------------------------------------------

CREATE TABLE public.visitor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  contact_id uuid,
  session_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_visitor_sessions_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_visitor_sessions_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE SET NULL
);

CREATE INDEX idx_visitor_sessions_workspace_id ON public.visitor_sessions (workspace_id);
CREATE INDEX idx_visitor_sessions_contact_id
  ON public.visitor_sessions (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TRIGGER trg_visitor_sessions_set_updated_at
  BEFORE UPDATE ON public.visitor_sessions
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  visitor_session_id uuid NOT NULL,
  contact_id uuid,
  assigned_to uuid,
  status public.app_conversation_status NOT NULL DEFAULT 'open',
  channel_type public.app_channel_type NOT NULL DEFAULT 'widget',
  subject text,
  source_url text,
  referrer text,
  message_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  last_message_preview text,
  next_message_sequence bigint NOT NULL DEFAULT 1,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversations_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_conversations_visitor_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_conversations_contact_workspace
    FOREIGN KEY (contact_id, workspace_id)
    REFERENCES public.contacts (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_conversations_assigned_to_workspace
    FOREIGN KEY (assigned_to, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_conversations_resolved_by_workspace
    FOREIGN KEY (resolved_by, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_conversations_next_message_sequence CHECK (next_message_sequence >= 1)
);

CREATE INDEX idx_conversations_inbox
  ON public.conversations (workspace_id, last_message_at DESC NULLS LAST);

CREATE INDEX idx_conversations_workspace_status
  ON public.conversations (workspace_id, status, last_message_at DESC NULLS LAST);

CREATE INDEX idx_conversations_assigned
  ON public.conversations (workspace_id, assigned_to, status)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_conversations_visitor_session ON public.conversations (visitor_session_id);

CREATE INDEX idx_conversations_contact_id
  ON public.conversations (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE TRIGGER trg_conversations_set_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  sequence_number bigint NOT NULL,
  sender_type public.app_message_sender_type NOT NULL,
  agent_member_id uuid,
  visitor_session_id uuid,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  delivery_status public.app_message_delivery_status NOT NULL DEFAULT 'sent',
  client_message_id uuid,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_messages_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_messages_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_messages_agent_member_workspace
    FOREIGN KEY (agent_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT fk_messages_visitor_session_workspace
    FOREIGN KEY (visitor_session_id, workspace_id)
    REFERENCES public.visitor_sessions (id, workspace_id)
    ON DELETE SET NULL,
  CONSTRAINT chk_messages_sender_identity CHECK (
    (
      sender_type = 'agent'
      AND agent_member_id IS NOT NULL
      AND visitor_session_id IS NULL
    )
    OR (
      sender_type = 'visitor'
      AND visitor_session_id IS NOT NULL
      AND agent_member_id IS NULL
    )
    OR (
      sender_type = 'system'
      AND agent_member_id IS NULL
      AND visitor_session_id IS NULL
    )
  ),
  CONSTRAINT uq_messages_conversation_sequence UNIQUE (conversation_id, sequence_number)
);

CREATE UNIQUE INDEX uq_messages_conversation_client_message_id
  ON public.messages (conversation_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE INDEX idx_messages_conversation_sequence
  ON public.messages (conversation_id, sequence_number);

CREATE INDEX idx_messages_workspace_id ON public.messages (workspace_id);

CREATE TRIGGER trg_messages_set_updated_at
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- conversation_member_reads
-- ---------------------------------------------------------------------------

CREATE TABLE public.conversation_member_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  member_id uuid NOT NULL,
  last_read_sequence bigint NOT NULL DEFAULT 0,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversation_member_reads_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT fk_conversation_member_reads_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_conversation_member_reads_member_workspace
    FOREIGN KEY (member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT uq_conversation_member_reads_conversation_member UNIQUE (conversation_id, member_id),
  CONSTRAINT chk_conversation_member_reads_sequence CHECK (last_read_sequence >= 0)
);

CREATE INDEX idx_conversation_member_reads_member
  ON public.conversation_member_reads (member_id, conversation_id);

CREATE TRIGGER trg_conversation_member_reads_set_updated_at
  BEFORE UPDATE ON public.conversation_member_reads
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- app_private inbox helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.require_authenticated()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.require_workspace_access(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.require_authenticated();
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace not accessible';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.require_messaging_role(p_workspace_id uuid)
RETURNS public.app_member_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  PERFORM app_private.require_authenticated();
  v_role := app_private.user_workspace_role(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Workspace not accessible';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_caller_member_id(p_workspace_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT wm.id
  FROM public.workspace_members wm
  WHERE wm.user_id = auth.uid()
    AND wm.workspace_id = p_workspace_id
    AND wm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_private.member_display_label(p_member_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(u.email, 'Unknown member')
  FROM public.workspace_members wm
  INNER JOIN auth.users u ON u.id = wm.user_id
  WHERE wm.id = p_member_id;
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

CREATE OR REPLACE FUNCTION app_private.build_conversation_list_item(
  p_conversation public.conversations,
  p_member_id uuid,
  p_last_read_sequence bigint
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

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact,
    'last_message_at', p_conversation.last_message_at,
    'last_message_preview', p_conversation.last_message_preview,
    'message_count', p_conversation.message_count,
    'has_unread', app_private.conversation_has_unread(
      p_conversation.id,
      p_member_id,
      p_last_read_sequence
    ),
    'created_at', p_conversation.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.build_conversation_detail(
  p_conversation public.conversations,
  p_member_id uuid,
  p_last_read_sequence bigint
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

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact,
    'visitor_session_id', p_conversation.visitor_session_id,
    'source_url', p_conversation.source_url,
    'message_count', p_conversation.message_count,
    'last_message_at', p_conversation.last_message_at,
    'has_unread', app_private.conversation_has_unread(
      p_conversation.id,
      p_member_id,
      p_last_read_sequence
    ),
    'created_at', p_conversation.created_at,
    'resolved_at', p_conversation.resolved_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.message_sender_label(p_message public.messages)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_message.sender_type = 'agent' THEN
    RETURN app_private.member_display_label(p_message.agent_member_id);
  ELSIF p_message.sender_type = 'visitor' THEN
    RETURN COALESCE(
      (
        SELECT COALESCE(c.name, c.email, 'Visitor')
        FROM public.visitor_sessions vs
        LEFT JOIN public.contacts c ON c.id = vs.contact_id
        WHERE vs.id = p_message.visitor_session_id
      ),
      'Visitor'
    );
  END IF;
  RETURN 'System';
END;
$$;

CREATE OR REPLACE FUNCTION app_private.sanitize_message_body(p_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_body text;
BEGIN
  v_body := trim(p_body);
  IF length(v_body) = 0 THEN
    RAISE EXCEPTION 'Message body is required';
  END IF;
  IF length(v_body) > 4000 THEN
    RAISE EXCEPTION 'Message body exceeds maximum length';
  END IF;
  v_body := regexp_replace(v_body, '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g');
  RETURN v_body;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_conversations
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_conversations(
  p_workspace_id uuid,
  p_query jsonb
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
  v_total bigint;
  v_items jsonb;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_page := GREATEST(COALESCE((p_query ->> 'page')::integer, 1), 1);
  v_page_size := COALESCE((p_query ->> 'pageSize')::integer, 25);
  IF v_page_size NOT IN (10, 25, 50) THEN
    RAISE EXCEPTION 'Invalid page size';
  END IF;
  v_offset := (v_page - 1) * v_page_size;

  v_sort_field := COALESCE(p_query ->> 'sort', '-last_message_at');
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
        r.last_read_sequence
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
  ) ranked;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_conversations(
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
  RETURN app_private.list_conversations(p_workspace_id, p_query);
END;
$$;

-- ---------------------------------------------------------------------------
-- get_conversation
-- ---------------------------------------------------------------------------

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
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT r.last_read_sequence
  INTO v_last_read_sequence
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  RETURN app_private.build_conversation_detail(
    v_conversation,
    v_member_id,
    v_last_read_sequence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_conversation(p_workspace_id, p_conversation_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- list_messages
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
  IF v_limit < 1 OR v_limit > 100 THEN
    RAISE EXCEPTION 'Invalid message limit';
  END IF;

  IF p_query ? 'before_sequence' AND p_query ->> 'before_sequence' IS NOT NULL THEN
    v_before_sequence := (p_query ->> 'before_sequence')::bigint;
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
      msg.created_at
    FROM public.messages msg
    WHERE msg.conversation_id = p_conversation_id
      AND msg.workspace_id = p_workspace_id
      AND (v_role <> 'viewer' OR msg.is_internal = false)
      AND (v_before_sequence IS NULL OR msg.sequence_number < v_before_sequence)
    ORDER BY msg.sequence_number DESC
    LIMIT v_limit
  ) m;

  SELECT count(*)
  INTO v_fetched_count
  FROM jsonb_array_elements(v_items);

  IF v_fetched_count > 0 THEN
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
-- send_operator_message
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.send_operator_message(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid DEFAULT NULL
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
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  v_body := app_private.sanitize_message_body(p_body);

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.workspace_id = p_workspace_id
      AND m.client_message_id = p_client_message_id;

    IF FOUND THEN
      SELECT *
      INTO v_conversation
      FROM public.conversations c
      WHERE c.id = p_conversation_id
        AND c.workspace_id = p_workspace_id;

      RETURN jsonb_build_object(
        'message', jsonb_build_object(
          'id', v_existing.id,
          'sequence_number', v_existing.sequence_number,
          'body', v_existing.body,
          'created_at', v_existing.created_at
        ),
        'conversation', jsonb_build_object(
          'id', v_conversation.id,
          'status', v_conversation.status,
          'last_message_at', v_conversation.last_message_at
        )
      );
    END IF;
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

  v_sequence := v_conversation.next_message_sequence;

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = left(v_body, 200),
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
    client_message_id
  )
  VALUES (
    p_workspace_id,
    p_conversation_id,
    v_sequence,
    'agent',
    v_member_id,
    v_body,
    false,
    p_client_message_id
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message_id,
      'sequence_number', v_sequence,
      'body', v_body,
      'created_at', v_created_at
    ),
    'conversation', jsonb_build_object(
      'id', v_conversation.id,
      'status', v_conversation.status,
      'last_message_at', v_conversation.last_message_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.send_operator_message(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_client_message_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.send_operator_message(
    p_workspace_id,
    p_conversation_id,
    p_body,
    p_client_message_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- assign_conversation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_conversation public.conversations;
  v_last_read_sequence bigint;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF p_assignee_member_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.id = p_assignee_member_id
        AND wm.workspace_id = p_workspace_id
        AND wm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Assignee is not an active workspace member';
    END IF;
  END IF;

  UPDATE public.conversations c
  SET
    assigned_to = p_assignee_member_id,
    updated_at = now()
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  RETURNING * INTO v_conversation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT r.last_read_sequence
  INTO v_last_read_sequence
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  RETURN app_private.build_conversation_detail(
    v_conversation,
    v_member_id,
    v_last_read_sequence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.assign_conversation(
    p_workspace_id,
    p_conversation_id,
    p_assignee_member_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- update_conversation_status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.update_conversation_status(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_status public.app_conversation_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_conversation public.conversations;
  v_last_read_sequence bigint;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  UPDATE public.conversations c
  SET
    status = p_status,
    resolved_at = CASE
      WHEN p_status IN ('resolved', 'closed') THEN COALESCE(c.resolved_at, now())
      ELSE NULL
    END,
    resolved_by = CASE
      WHEN p_status IN ('resolved', 'closed') THEN COALESCE(c.resolved_by, v_member_id)
      ELSE NULL
    END,
    updated_at = now()
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  RETURNING * INTO v_conversation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found';
  END IF;

  SELECT r.last_read_sequence
  INTO v_last_read_sequence
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  RETURN app_private.build_conversation_detail(
    v_conversation,
    v_member_id,
    v_last_read_sequence
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_conversation_status(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_status public.app_conversation_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_conversation_status(
    p_workspace_id,
    p_conversation_id,
    p_status
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- mark_conversation_read
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
  v_has_unread boolean;
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

  IF p_through_sequence IS NULL THEN
    SELECT COALESCE(max(m.sequence_number), 0)
    INTO v_through
    FROM public.messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.workspace_id = p_workspace_id;
  ELSE
    v_through := p_through_sequence;
  END IF;

  INSERT INTO public.conversation_member_reads (
    workspace_id,
    conversation_id,
    member_id,
    last_read_sequence,
    last_read_at
  )
  VALUES (
    p_workspace_id,
    p_conversation_id,
    v_member_id,
    v_through,
    now()
  )
  ON CONFLICT (conversation_id, member_id) DO UPDATE
  SET
    last_read_sequence = GREATEST(
      public.conversation_member_reads.last_read_sequence,
      EXCLUDED.last_read_sequence
    ),
    last_read_at = now(),
    updated_at = now();

  SELECT r.last_read_sequence
  INTO v_through
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  v_has_unread := app_private.conversation_has_unread(
    p_conversation_id,
    v_member_id,
    v_through
  );

  RETURN jsonb_build_object(
    'last_read_sequence', v_through,
    'has_unread', v_has_unread
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
-- list_assignable_members
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_assignable_members(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);

  RETURN COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'member_id', wm.id,
          'display_label', app_private.member_display_label(wm.id),
          'role', wm.role
        )
        ORDER BY wm.role, app_private.member_display_label(wm.id)
      )
      FROM public.workspace_members wm
      WHERE wm.workspace_id = p_workspace_id
        AND wm.status = 'active'
        AND wm.role IN ('owner', 'admin', 'agent')
    ),
    '[]'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_assignable_members(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_assignable_members(p_workspace_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_member_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY contacts_select_authenticated
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY visitor_sessions_select_authenticated
  ON public.visitor_sessions
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY conversations_select_authenticated
  ON public.conversations
  FOR SELECT
  TO authenticated
  USING (app_private.workspace_is_accessible(workspace_id));

CREATE POLICY messages_select_authenticated
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND (
      app_private.user_workspace_role(workspace_id) <> 'viewer'
      OR is_internal = false
    )
  );

CREATE POLICY conversation_member_reads_select_authenticated
  ON public.conversation_member_reads
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND member_id = app_private.get_caller_member_id(workspace_id)
  );

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT ON TABLE public.contacts TO authenticated;
GRANT SELECT ON TABLE public.visitor_sessions TO authenticated;
GRANT SELECT ON TABLE public.conversations TO authenticated;
GRANT SELECT ON TABLE public.messages TO authenticated;
GRANT SELECT ON TABLE public.conversation_member_reads TO authenticated;

REVOKE ALL ON TABLE public.contacts FROM anon;
REVOKE ALL ON TABLE public.visitor_sessions FROM anon;
REVOKE ALL ON TABLE public.conversations FROM anon;
REVOKE ALL ON TABLE public.messages FROM anon;
REVOKE ALL ON TABLE public.conversation_member_reads FROM anon;

REVOKE ALL ON FUNCTION public.list_conversations(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_conversations(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_conversation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversation(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.list_messages(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_messages(uuid, uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.send_operator_message(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_operator_message(uuid, uuid, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_conversation(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid, uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.update_conversation_status(uuid, uuid, public.app_conversation_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_conversation_status(uuid, uuid, public.app_conversation_status) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.list_assignable_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_assignable_members(uuid) TO authenticated;
