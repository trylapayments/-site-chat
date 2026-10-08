-- Notify operators only after the first real visitor message. No historical data is removed.
-- Accept repeat-email pre-chat requests without merging unsigned visitor identities.
CREATE OR REPLACE FUNCTION "public"."widget_submit_pre_chat"("p_workspace_id" "uuid", "p_session_token" "text", "p_request_id" "uuid", "p_snapshot" "jsonb", "p_config_version" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE v_session public.visitor_sessions; v_conversation public.conversations; v_existing public.pre_chat_submissions;
  v_config public.workspace_chat_settings; v_message_id uuid;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id,p_session_token);
  SELECT * INTO v_session FROM public.visitor_sessions WHERE id=v_session.id AND workspace_id=p_workspace_id FOR UPDATE;
  SELECT * INTO v_existing FROM public.pre_chat_submissions WHERE visitor_session_id=v_session.id AND workspace_id=p_workspace_id;
  IF FOUND THEN RETURN jsonb_build_object('submitted',true,'hasConversation',true); END IF;
  v_config:=app_private.session_chat_settings(p_workspace_id,v_session);
  IF v_config.workspace_id IS NULL OR v_config.version<>p_config_version OR NOT COALESCE((v_config.config->>'enabled')::boolean,false)
    THEN RAISE EXCEPTION 'Form settings changed'; END IF;
  IF p_request_id IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>200000 THEN RAISE EXCEPTION 'Invalid form submission'; END IF;
  -- A submitted email is contact information, not proof of ownership of another contact.
  -- Keep this session isolated; the operator can read the submitted email from its snapshot.
  BEGIN
    PERFORM app_private.widget_identify_visitor(p_workspace_id,p_session_token,NULLIF(p_snapshot->>'name',''),NULLIF(p_snapshot->>'email',''),NULLIF(p_snapshot->>'phone',''),NULL,NULL);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Email already belongs to another visitor in this workspace' THEN RAISE; END IF;
    PERFORM app_private.widget_identify_visitor(p_workspace_id,p_session_token,NULLIF(p_snapshot->>'name',''),NULL,NULLIF(p_snapshot->>'phone',''),NULL,NULL);
  END;
  UPDATE public.visitor_sessions SET pre_chat_submitted_at=now() WHERE id=v_session.id RETURNING * INTO v_session;
  v_conversation := app_private.widget_get_or_create_conversation_for_send(p_workspace_id,v_session.id,v_session.locale,v_session.current_url,v_session.referrer);
  INSERT INTO public.pre_chat_submissions(id,workspace_id,visitor_session_id,conversation_id,snapshot)
    VALUES(p_request_id,p_workspace_id,v_session.id,v_conversation.id,p_snapshot);
  -- Form completion records contact details only; help is requested by a visitor message.
  RETURN jsonb_build_object('submitted',true,'hasConversation',true);
END; $$;


CREATE OR REPLACE FUNCTION app_private.notify_visitor_message_event(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_is_new_conversation boolean,
  p_preview text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignee uuid;
  v_preview text;
  v_recipient record;
  v_type public.app_notification_type;
  v_dedupe text;
  v_title text;
  v_body text;
BEGIN
  -- Pre-chat system events and opening the widget are not visitor messages.
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.id=p_message_id
      AND m.workspace_id=p_workspace_id AND m.conversation_id=p_conversation_id
      AND m.sender_type='visitor' AND NOT m.is_internal
  ) THEN RETURN; END IF;
  -- Legacy pre-chat system messages must not suppress the first real chat notification.
  p_is_new_conversation := NOT EXISTS (
    SELECT 1 FROM public.messages m WHERE m.workspace_id=p_workspace_id
      AND m.conversation_id=p_conversation_id AND m.sender_type='visitor'
      AND NOT m.is_internal AND m.id<>p_message_id
  );
  SELECT c.assigned_to
  INTO v_assignee
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  v_preview := left(COALESCE(NULLIF(trim(p_preview), ''), 'New visitor message'), 200);

  IF p_is_new_conversation THEN
    v_type := 'conversation_new';
    v_dedupe := 'conversation_new:' || p_conversation_id::text;
    v_title := 'New conversation';
    v_body := v_preview;

    FOR v_recipient IN
      SELECT * FROM app_private.list_active_notification_recipients(p_workspace_id, true)
    LOOP
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_recipient.member_id,
        v_type,
        v_dedupe || ':member:' || v_recipient.member_id::text,
        v_title,
        v_body,
        'conversation',
        p_conversation_id,
        p_conversation_id,
        NULL,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'message_id', p_message_id
        )
      );
    END LOOP;
  ELSE
    v_type := 'visitor_message';
    v_title := 'New visitor message';
    v_body := v_preview;

    IF v_assignee IS NOT NULL THEN
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_assignee,
        v_type,
        'visitor_message:' || p_message_id::text,
        v_title,
        v_body,
        'message',
        p_message_id,
        p_conversation_id,
        NULL,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'message_id', p_message_id
        )
      );
    ELSE
      -- Unassigned follow-ups: notify messaging roles (not viewers — noisy).
      FOR v_recipient IN
        SELECT * FROM app_private.list_active_notification_recipients(p_workspace_id, false)
      LOOP
        PERFORM app_private.emit_notification(
          p_workspace_id,
          v_recipient.member_id,
          v_type,
          'visitor_message:' || p_message_id::text || ':member:' || v_recipient.member_id::text,
          v_title,
          v_body,
          'message',
          p_message_id,
          p_conversation_id,
          NULL,
          jsonb_build_object(
            'v', 1,
            'conversation_id', p_conversation_id,
            'message_id', p_message_id
          )
        );
      END LOOP;
    END IF;
  END IF;
END;
$$;
