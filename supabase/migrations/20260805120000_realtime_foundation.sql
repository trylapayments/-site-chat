-- Phase 4C: Realtime foundation (operator postgres_changes, visitor private Broadcast)
-- Forward-only migration. See PR 4C implementation plan.

-- ---------------------------------------------------------------------------
-- Conversation private visitor topic key (never exposed as conversation UUID)
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN visitor_realtime_topic_key text;

UPDATE public.conversations
SET visitor_realtime_topic_key = encode(extensions.gen_random_bytes(32), 'hex')
WHERE visitor_realtime_topic_key IS NULL;

ALTER TABLE public.conversations
  ALTER COLUMN visitor_realtime_topic_key SET NOT NULL;

ALTER TABLE public.conversations
  ALTER COLUMN visitor_realtime_topic_key
  SET DEFAULT app_private.generate_visitor_realtime_topic_key();

ALTER TABLE public.conversations
  ADD CONSTRAINT chk_conversations_visitor_realtime_topic_key_format CHECK (
    visitor_realtime_topic_key ~ '^[a-f0-9]{64}$'
  );

CREATE UNIQUE INDEX uq_conversations_visitor_realtime_topic_key
  ON public.conversations (visitor_realtime_topic_key);

CREATE OR REPLACE FUNCTION app_private.generate_visitor_realtime_topic_key()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  SELECT encode(extensions.gen_random_bytes(32), 'hex');
$$;

-- ---------------------------------------------------------------------------
-- Realtime publication for operator postgres_changes
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- widget_realtime role — Broadcast subscribe only, no product-table access
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'widget_realtime') THEN
    CREATE ROLE widget_realtime NOLOGIN NOINHERIT;
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA public FROM widget_realtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM widget_realtime;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM widget_realtime;

GRANT USAGE ON SCHEMA realtime TO widget_realtime;
GRANT SELECT ON TABLE realtime.messages TO widget_realtime;

CREATE POLICY widget_realtime_receive_own_broadcast
  ON realtime.messages
  FOR SELECT
  TO widget_realtime
  USING (
    extension = 'broadcast'
    AND topic = (auth.jwt() ->> 'topic')
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

-- ---------------------------------------------------------------------------
-- Sanitized visitor Broadcast on committed message inserts
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

  v_payload := jsonb_build_object(
    'type', 'message.created',
    'message', jsonb_build_object(
      'id', NEW.id,
      'sequenceNumber', NEW.sequence_number,
      'senderType', NEW.sender_type::text,
      'body', NEW.body,
      'createdAt', to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'clientMessageId', NEW.client_message_id
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

CREATE TRIGGER trg_messages_broadcast_visitor_safe
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION app_private.broadcast_visitor_safe_message();

-- ---------------------------------------------------------------------------
-- Ensure topic key assignment on conversation creation paths
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_get_or_create_conversation_for_send(
  p_workspace_id uuid,
  p_visitor_session_id uuid,
  p_locale text,
  p_source_url text,
  p_referrer text
)
RETURNS public.conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation public.conversations;
  v_reopen_hours integer;
  v_conversation_id uuid;
  v_topic_key text;
BEGIN
  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status IN ('open', 'pending')
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    RETURN v_conversation;
  END IF;

  v_reopen_hours := app_private.widget_reopen_window_hours(p_workspace_id);

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.workspace_id = p_workspace_id
    AND c.visitor_session_id = p_visitor_session_id
    AND c.status = 'resolved'
    AND c.resolved_at IS NOT NULL
    AND c.resolved_at > now() - make_interval(hours => v_reopen_hours)
  ORDER BY c.resolved_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.conversations c
    SET
      status = 'open',
      resolved_at = NULL,
      resolved_by = NULL,
      locale = COALESCE(c.locale, p_locale),
      updated_at = now()
    WHERE c.id = v_conversation.id
    RETURNING * INTO v_conversation;

    RETURN v_conversation;
  END IF;

  v_topic_key := app_private.generate_visitor_realtime_topic_key();

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    channel_type,
    source_url,
    referrer,
    locale,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    p_workspace_id,
    p_visitor_session_id,
    'open',
    'widget',
    p_source_url,
    p_referrer,
    p_locale,
    1,
    v_topic_key
  )
  RETURNING id INTO v_conversation_id;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation_id;

  RETURN v_conversation;
EXCEPTION
  WHEN unique_violation THEN
    SELECT *
    INTO v_conversation
    FROM public.conversations c
    WHERE c.workspace_id = p_workspace_id
      AND c.visitor_session_id = p_visitor_session_id
      AND c.status IN ('open', 'pending')
    ORDER BY c.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    RETURN v_conversation;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.widget_resolve_realtime_topic(
  p_workspace_id uuid,
  p_session_token text
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
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'No active conversation';
  END IF;

  RETURN jsonb_build_object(
    'topic', 'widget-conversation:' || v_conversation.visitor_realtime_topic_key,
    'subject', 'wr_' || left(encode(extensions.digest(v_session.id::text, 'sha256'), 'hex'), 16)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.widget_resolve_realtime_topic(
  p_workspace_id uuid,
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.widget_resolve_realtime_topic(p_workspace_id, p_session_token);
END;
$$;

REVOKE ALL ON FUNCTION public.widget_resolve_realtime_topic(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_resolve_realtime_topic(uuid, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_resolve_realtime_topic(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- after_sequence catch-up for operator and widget message lists
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
      msg.created_at
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

  IF v_fetched_count > 0 THEN
    SELECT (elem ->> 'sequence_number')::bigint
    INTO v_oldest_sequence
    FROM jsonb_array_elements(v_items) AS elem
    ORDER BY (elem ->> 'sequence_number')::bigint ASC
    LIMIT 1;

    IF v_after_sequence IS NULL THEN
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
      v_has_older := false;
      v_oldest_sequence := NULL;
    END IF;
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
      'oldest_sequence', NULL
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

  RETURN jsonb_build_object(
    'items', v_items,
    'has_older', COALESCE(v_has_older, false),
    'oldest_sequence', v_oldest_sequence
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

REVOKE ALL ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint, bigint) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_list_visitor_messages(uuid, text, integer, bigint, bigint) TO service_role;

-- Re-apply app_private execute revokes for newly created functions in this migration.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
