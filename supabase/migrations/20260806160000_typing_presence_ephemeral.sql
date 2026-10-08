-- Phase 4D-2: Typing indicators + basic presence on private conversation topics.
-- Extends widget-conversation:{topic_key} with Broadcast (typing) write + Presence.
-- Typing events are never written to product tables.

-- ---------------------------------------------------------------------------
-- widget_realtime: receive Presence + publish typing Broadcast / Presence
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS widget_realtime_receive_own_broadcast ON realtime.messages;

CREATE POLICY widget_realtime_receive_own_topic
  ON realtime.messages
  FOR SELECT
  TO widget_realtime
  USING (
    extension IN ('broadcast', 'presence')
    AND topic = (auth.jwt() ->> 'topic')
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

DROP POLICY IF EXISTS widget_realtime_publish_own_topic ON realtime.messages;

CREATE POLICY widget_realtime_publish_own_topic
  ON realtime.messages
  FOR INSERT
  TO widget_realtime
  WITH CHECK (
    extension IN ('broadcast', 'presence')
    AND topic = (auth.jwt() ->> 'topic')
    AND (auth.jwt() ->> 'purpose') = 'widget_realtime'
  );

-- ---------------------------------------------------------------------------
-- authenticated operators: join private visitor topic for typing + presence
-- Topic must match a conversation in a workspace the caller belongs to.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS authenticated_conversation_ephemeral_select ON realtime.messages;

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
          ('widget-conversation:' || c.visitor_realtime_topic_key)
    )
  );

DROP POLICY IF EXISTS authenticated_conversation_ephemeral_insert ON realtime.messages;

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
          ('widget-conversation:' || c.visitor_realtime_topic_key)
    )
  );

-- ---------------------------------------------------------------------------
-- Expose opaque visitor Realtime topic to authorized operators (get_conversation)
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
