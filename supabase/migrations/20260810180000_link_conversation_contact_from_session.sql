-- Link conversations to the visitor contact already bound on the session.
--
-- widget_get_or_create_conversation_for_send historically inserted conversations
-- without contact_id. Session create always mints a contact + continuity token,
-- so operators opened threads with visitor context but no public_id / profile.
--
-- Also teach build_conversation_detail to fall back to session.contact_id when
-- conversation.contact_id is still null (legacy rows).

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
  v_session public.visitor_sessions;
  v_contact_id uuid;
  v_reopen_hours integer;
  v_conversation_id uuid;
  v_topic_key text;
BEGIN
  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = p_visitor_session_id
    AND vs.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visitor session not found';
  END IF;

  v_contact_id := v_session.contact_id;

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
    IF v_conversation.contact_id IS NULL AND v_contact_id IS NOT NULL THEN
      UPDATE public.conversations c
      SET contact_id = v_contact_id, updated_at = now()
      WHERE c.id = v_conversation.id
      RETURNING * INTO v_conversation;
    END IF;
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
      contact_id = COALESCE(c.contact_id, v_contact_id),
      updated_at = now()
    WHERE c.id = v_conversation.id
    RETURNING * INTO v_conversation;

    RETURN v_conversation;
  END IF;

  v_topic_key := app_private.generate_visitor_realtime_topic_key();

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    contact_id,
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
    v_contact_id,
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

    IF v_conversation.contact_id IS NULL AND v_contact_id IS NOT NULL THEN
      UPDATE public.conversations c
      SET contact_id = v_contact_id, updated_at = now()
      WHERE c.id = v_conversation.id
      RETURNING * INTO v_conversation;
    END IF;

    RETURN v_conversation;
END;
$$;

COMMENT ON FUNCTION app_private.widget_get_or_create_conversation_for_send(
  uuid, uuid, text, text, text
) IS
  'Get or create the open/pending conversation for a visitor session send. '
  'Copies visitor_sessions.contact_id onto the conversation so operator inbox '
  'detail can show visitor public_id/profile without requiring identify first.';

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
  v_contact public.contacts;
  v_contact_json jsonb;
  v_assigned jsonb;
  v_unread integer;
  v_visitor_read bigint;
  v_visitor_delivered bigint;
  v_agent_read bigint;
  v_agent_delivered bigint;
  v_session public.visitor_sessions;
  v_visitor jsonb;
  v_visitor_context jsonb;
  v_visitor_activity jsonb;
  v_page_views jsonb;
  v_first_seen timestamptz;
  v_last_seen timestamptz;
  v_visit_count integer;
  v_contact_id uuid;
BEGIN
  v_contact_id := p_conversation.contact_id;

  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = p_conversation.visitor_session_id;

  IF v_contact_id IS NULL AND FOUND THEN
    v_contact_id := v_session.contact_id;
  END IF;

  IF v_contact_id IS NOT NULL THEN
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = v_contact_id;

    IF FOUND THEN
      v_contact_json := jsonb_build_object(
        'id', v_contact.id,
        'public_id', v_contact.public_id,
        'name', v_contact.name,
        'email', v_contact.email,
        'phone', v_contact.phone
      );
      v_visitor := app_private.visitor_profile_json(v_contact);
      v_first_seen := v_contact.first_seen_at;
      v_last_seen := v_contact.last_seen_at;
      v_visit_count := v_contact.visit_count;
    ELSE
      v_contact_json := NULL;
      v_visitor := NULL;
    END IF;
  ELSE
    v_contact_json := NULL;
    v_visitor := NULL;
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

  IF v_session.id IS NOT NULL THEN
    v_visitor_context := jsonb_build_object(
      'current_url', v_session.current_url,
      'current_title', v_session.current_title,
      'landing_url', v_session.landing_url,
      'referrer', v_session.referrer,
      'utm_source', v_session.utm_source,
      'utm_medium', v_session.utm_medium,
      'utm_campaign', v_session.utm_campaign,
      'utm_content', v_session.utm_content,
      'utm_term', v_session.utm_term,
      'browser_family', v_session.browser_family,
      'browser_version', v_session.browser_version,
      'os_family', v_session.os_family,
      'device_type', v_session.device_type,
      'locale', v_session.locale,
      'timezone', v_session.timezone,
      'language', v_session.language,
      'country_code', v_session.country_code
    );

    IF v_first_seen IS NULL THEN
      v_first_seen := v_session.created_at;
      v_last_seen := v_session.last_seen_at;
      v_visit_count := 1;
    END IF;
  ELSE
    v_visitor_context := NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pv.id,
        'url', pv.url,
        'title', pv.title,
        'referrer', pv.referrer,
        'utm_source', pv.utm_source,
        'utm_medium', pv.utm_medium,
        'utm_campaign', pv.utm_campaign,
        'created_at', pv.created_at
      )
      ORDER BY pv.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_page_views
  FROM (
    SELECT
      p.id,
      p.url,
      p.title,
      p.referrer,
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      p.created_at
    FROM public.visitor_page_views p
    WHERE p.workspace_id = p_conversation.workspace_id
      AND (
        (
          v_contact_id IS NOT NULL
          AND p.contact_id = v_contact_id
        )
        OR (
          v_contact_id IS NULL
          AND p.visitor_session_id = p_conversation.visitor_session_id
        )
      )
    ORDER BY p.created_at DESC
    LIMIT 20
  ) pv;

  IF v_first_seen IS NOT NULL THEN
    v_visitor_activity := jsonb_build_object(
      'first_seen_at', v_first_seen,
      'last_seen_at', COALESCE(v_last_seen, v_first_seen),
      'visit_count', COALESCE(v_visit_count, 1),
      'recent_page_views', COALESCE(v_page_views, '[]'::jsonb)
    );
  ELSE
    v_visitor_activity := NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'contact', v_contact_json,
    'visitor_session_id', p_conversation.visitor_session_id,
    'visitor_realtime_topic',
      'widget-conversation:' || p_conversation.visitor_realtime_topic_key,
    'visitor_ephemeral_topic',
      'widget-ephemeral:' || p_conversation.visitor_realtime_topic_key,
    'source_url', p_conversation.source_url,
    'referrer', p_conversation.referrer,
    'visitor', v_visitor,
    'visitor_context', v_visitor_context,
    'visitor_activity', v_visitor_activity,
    'message_count', p_conversation.message_count,
    'last_message_at', p_conversation.last_message_at,
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

COMMENT ON FUNCTION app_private.build_conversation_detail(
  public.conversations, uuid, bigint, integer, boolean
) IS
  'Build conversation detail JSON including visitor profile/context/activity. '
  'Resolves contact via conversations.contact_id, falling back to '
  'visitor_sessions.contact_id for legacy rows created before contact linking. '
  'visitor_context.current_url comes from visitor_sessions.current_url and reflects '
  'the most recently reported tab (see active_tab_id), not a locked primary tab.';

-- CRITICAL-1: re-apply after replacing app_private helpers
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
