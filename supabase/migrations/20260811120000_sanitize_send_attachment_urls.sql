-- URL privacy: sanitize pageUrl/referrer on message-send and attachment paths.
--
-- Session create + page-view already sanitize via app_private.sanitize_page_url.
-- widget_send_visitor_message / widget_ensure_conversation_for_attachments /
-- finalize_visitor_attachment_message still wrote raw client URLs into
-- visitor_sessions.current_url / referrer and conversations.source_url / referrer.
--
-- Defense in depth: DB is the final trust boundary (API also sanitizes).
-- Send/attachment must not overwrite a newer page-view current_url with stale
-- client context — only backfill when the session field is still NULL.

-- ---------------------------------------------------------------------------
-- widget_get_or_create_conversation_for_send: sanitize source_url + referrer
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
  v_session public.visitor_sessions;
  v_contact_id uuid;
  v_reopen_hours integer;
  v_conversation_id uuid;
  v_topic_key text;
  v_source_url text;
  v_referrer text;
BEGIN
  v_source_url := app_private.sanitize_page_url(p_source_url);
  v_referrer := app_private.sanitize_page_url(p_referrer);

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
    v_source_url,
    v_referrer,
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
  'Copies visitor_sessions.contact_id onto the conversation. '
  'source_url and referrer are passed through app_private.sanitize_page_url '
  'before insert (origin + path + allowlisted UTMs only).';

-- ---------------------------------------------------------------------------
-- widget_send_visitor_message: sanitize + do not stale-overwrite current_url
-- ---------------------------------------------------------------------------

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
  v_page_url text;
  v_referrer text;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_message_body(p_body);
  v_page_url := app_private.sanitize_page_url(p_page_url);
  v_referrer := app_private.sanitize_page_url(p_referrer);

  -- Refresh TTL; only backfill current_url/referrer when still NULL so a
  -- stale send pageUrl cannot overwrite a newer page-view context.
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

COMMENT ON FUNCTION app_private.widget_send_visitor_message(
  uuid, text, text, uuid, text, text
) IS
  'Send a visitor message. page_url/referrer are sanitized via '
  'app_private.sanitize_page_url before any write. Session current_url/referrer '
  'are only backfilled when NULL (page-view remains authoritative for live context).';

-- ---------------------------------------------------------------------------
-- Attachment initiate: ensure conversation (sanitize + backfill-only)
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
  v_page_url text;
  v_referrer text;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
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

  RETURN jsonb_build_object(
    'conversation_id', v_conversation.id,
    'visitor_session_id', v_session.id,
    'status', v_conversation.status
  );
END;
$$;

COMMENT ON FUNCTION app_private.widget_ensure_conversation_for_attachments(
  uuid, text, text, text
) IS
  'Ensure an open conversation exists before minting attachment upload intents. '
  'Sanitizes page_url/referrer; only backfills session current_url/referrer when NULL.';

-- ---------------------------------------------------------------------------
-- Attachment complete: sanitize before session/conversation writes
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

COMMENT ON FUNCTION app_private.finalize_visitor_attachment_message(
  uuid, text, uuid, uuid[], text, uuid, text, text, jsonb
) IS
  'Finalize a visitor attachment message after storage validation. '
  'Sanitizes page_url/referrer; only backfills session current_url/referrer when NULL.';
-- CRITICAL-1: re-apply after replacing app_private helpers
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
