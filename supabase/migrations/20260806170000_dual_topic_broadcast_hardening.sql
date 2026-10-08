-- Dual-topic Broadcast hardening: separate durable message Broadcast from
-- ephemeral typing/Presence so widget_realtime cannot forge message.created.
--
-- Topics (same opaque 64-hex visitor_realtime_topic_key):
--   widget-conversation:{key}  — server-originated message.created only (SELECT)
--   widget-ephemeral:{key}     — typing.v1 Broadcast + Presence (SELECT+INSERT)
--
-- JWT claim for widget_realtime is topic_key (64-hex), not a full topic name.

-- ---------------------------------------------------------------------------
-- widget_realtime: SELECT message topic; SELECT+INSERT ephemeral topic only
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS widget_realtime_receive_own_topic ON realtime.messages;
DROP POLICY IF EXISTS widget_realtime_publish_own_topic ON realtime.messages;
DROP POLICY IF EXISTS widget_realtime_receive_own_broadcast ON realtime.messages;
DROP POLICY IF EXISTS widget_realtime_receive_message_topic ON realtime.messages;
DROP POLICY IF EXISTS widget_realtime_receive_ephemeral_topic ON realtime.messages;
DROP POLICY IF EXISTS widget_realtime_publish_ephemeral_topic ON realtime.messages;

CREATE POLICY widget_realtime_receive_message_topic
  ON realtime.messages
  FOR SELECT
  TO widget_realtime
  USING (
    extension = 'broadcast'
    AND topic = ('widget-conversation:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

CREATE POLICY widget_realtime_receive_ephemeral_topic
  ON realtime.messages
  FOR SELECT
  TO widget_realtime
  USING (
    extension IN ('broadcast', 'presence')
    AND topic = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

CREATE POLICY widget_realtime_publish_ephemeral_topic
  ON realtime.messages
  FOR INSERT
  TO widget_realtime
  WITH CHECK (
    extension IN ('broadcast', 'presence')
    AND topic = ('widget-ephemeral:' || (auth.jwt() ->> 'topic_key'))
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

-- ---------------------------------------------------------------------------
-- authenticated operators: membership-gated message SELECT + ephemeral R/W
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS authenticated_conversation_ephemeral_select ON realtime.messages;
DROP POLICY IF EXISTS authenticated_conversation_ephemeral_insert ON realtime.messages;
DROP POLICY IF EXISTS authenticated_conversation_message_select ON realtime.messages;

CREATE POLICY authenticated_conversation_message_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      INNER JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
      INNER JOIN public.workspaces w
        ON w.id = c.workspace_id
      WHERE wm.user_id = (SELECT auth.uid())
        AND wm.status = 'active'
        AND w.deleted_at IS NULL
        AND w.status = 'active'
        AND (SELECT realtime.topic()) =
          ('widget-conversation:' || c.visitor_realtime_topic_key)
    )
  );

CREATE POLICY authenticated_conversation_ephemeral_select
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (
    extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      INNER JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
      INNER JOIN public.workspaces w
        ON w.id = c.workspace_id
      WHERE wm.user_id = (SELECT auth.uid())
        AND wm.status = 'active'
        AND w.deleted_at IS NULL
        AND w.status = 'active'
        AND (SELECT realtime.topic()) =
          ('widget-ephemeral:' || c.visitor_realtime_topic_key)
    )
  );

CREATE POLICY authenticated_conversation_ephemeral_insert
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.conversations c
      INNER JOIN public.workspace_members wm
        ON wm.workspace_id = c.workspace_id
      INNER JOIN public.workspaces w
        ON w.id = c.workspace_id
      WHERE wm.user_id = (SELECT auth.uid())
        AND wm.status = 'active'
        AND w.deleted_at IS NULL
        AND w.status = 'active'
        AND (SELECT realtime.topic()) =
          ('widget-ephemeral:' || c.visitor_realtime_topic_key)
    )
  );

-- ---------------------------------------------------------------------------
-- Resolve topic: return message + ephemeral topics + opaque topic_key
-- ---------------------------------------------------------------------------

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
  v_topic_key text;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_conversation := app_private.widget_viewable_conversation(p_workspace_id, v_session.id);

  IF v_conversation IS NULL THEN
    RAISE EXCEPTION 'No active conversation';
  END IF;

  v_topic_key := v_conversation.visitor_realtime_topic_key;

  RETURN jsonb_build_object(
    'topic_key', v_topic_key,
    'message_topic', 'widget-conversation:' || v_topic_key,
    'ephemeral_topic', 'widget-ephemeral:' || v_topic_key,
    -- Back-compat alias for message topic (same value as message_topic).
    'topic', 'widget-conversation:' || v_topic_key,
    'subject', 'wr_' || left(encode(extensions.digest(v_session.id::text, 'sha256'), 'hex'), 16)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- get_conversation: expose both opaque topics to authorized operators
-- ---------------------------------------------------------------------------

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
    'visitor_realtime_topic',
      'widget-conversation:' || p_conversation.visitor_realtime_topic_key,
    'visitor_ephemeral_topic',
      'widget-ephemeral:' || p_conversation.visitor_realtime_topic_key,
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
