-- Include client_message_id in widget send response so the client can reconcile retries.

CREATE OR REPLACE FUNCTION app_private.widget_send_visitor_message(
  p_workspace_id uuid,
  p_session_token text,
  p_body text,
  p_client_message_id uuid DEFAULT NULL,
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
  v_body text;
  v_conversation public.conversations;
  v_existing public.messages;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_message_body(p_body);

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
          'client_message_id', v_existing.client_message_id
        ),
        'conversation_status', v_conversation.status
      );
    END IF;
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id
  FOR UPDATE;

  v_sequence := v_conversation.next_message_sequence;

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = left(v_body, 200),
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
    client_message_id
  )
  VALUES (
    p_workspace_id,
    v_conversation.id,
    v_sequence,
    'visitor',
    v_session.id,
    v_body,
    false,
    p_client_message_id
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

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
      'client_message_id', p_client_message_id
    ),
    'conversation_status', v_conversation.status
  );
END;
$$;
