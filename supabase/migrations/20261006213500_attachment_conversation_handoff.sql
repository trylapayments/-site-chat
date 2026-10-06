CREATE OR REPLACE FUNCTION app_private.finalize_visitor_attachment_message(p_workspace_id uuid, p_session_token text, p_batch_id uuid, p_upload_ids uuid[], p_body text DEFAULT ''::text, p_client_message_id uuid DEFAULT NULL::uuid, p_page_url text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_session public.visitor_sessions;
  v_body text;
  v_conversation public.conversations;
  v_existing public.messages;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
  v_count integer;
  v_attachment jsonb;
  v_attachments_out jsonb;
  v_preview text;
  v_page_url text;
  v_referrer text;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_optional_message_body(p_body);
  v_page_url := app_private.sanitize_page_url(p_page_url);
  v_referrer := app_private.sanitize_page_url(p_referrer);

  UPDATE public.visitor_sessions vs
  SET
    expires_at = now() + interval '30 days',
    current_url = CASE
      WHEN vs.current_url IS NULL THEN v_page_url
      ELSE vs.current_url
    END,
    referrer = CASE
      WHEN vs.referrer IS NULL THEN v_referrer
      ELSE vs.referrer
    END,
    last_seen_at = now(),
    updated_at = now()
  WHERE vs.id = v_session.id
  RETURNING * INTO v_session;

  v_conversation := app_private.widget_get_or_create_conversation_for_send(
    p_workspace_id,
    v_session.id,
    v_session.locale,
    COALESCE(v_page_url, v_session.current_url, v_session.initial_url),
    COALESCE(v_referrer, v_session.referrer)
  );

  -- Idempotent retry may pass empty p_attachments once uploads are confirmed.
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

  IF jsonb_array_length(COALESCE(p_attachments, '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'At least one attachment is required';
  END IF;

  IF length(v_body) = 0 AND jsonb_array_length(p_attachments) < 1 THEN
    RAISE EXCEPTION 'Message body or attachments required';
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
    AND EXISTS (
      SELECT 1 FROM public.conversations original
      WHERE original.id = u.conversation_id
        AND original.workspace_id = p_workspace_id
        AND original.visitor_session_id = v_session.id
    );

  IF v_count <> cardinality(p_upload_ids) THEN
    RAISE EXCEPTION 'Invalid or expired upload intents';
  END IF;

  -- An operator may close the conversation while the visitor uploads a file.
  -- Follow normal message routing to the visitor's current conversation rather
  -- than rejecting the already uploaded file. Ownership remains session-scoped.
  UPDATE public.attachment_uploads u
  SET conversation_id = v_conversation.id, updated_at = now()
  WHERE u.workspace_id = p_workspace_id
    AND u.batch_id = p_batch_id
    AND u.id = ANY (p_upload_ids)
    AND u.visitor_session_id = v_session.id
    AND u.actor_role = 'visitor'
    AND u.status = 'uploaded';

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
$function$
;
