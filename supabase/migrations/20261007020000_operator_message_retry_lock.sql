-- Serialize before checking idempotency: simultaneous retries return the same message.
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

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

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
