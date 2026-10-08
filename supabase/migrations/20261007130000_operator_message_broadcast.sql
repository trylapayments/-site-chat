-- Operator public-message stream. The widget protocol is unchanged.
-- Private notes/read counters keep their existing, narrower policies.
BEGIN;
CREATE POLICY operator_public_messages_receive
  ON realtime.messages FOR SELECT TO authenticated
  USING (
    extension = 'broadcast'
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      JOIN public.workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = (SELECT auth.uid()) AND m.status = 'active'
        AND w.status = 'active' AND w.deleted_at IS NULL
        AND (SELECT realtime.topic()) = 'operator-messages:' || w.id::text
    )
  );
-- No INSERT policy: operators and visitors cannot forge durable messages.
CREATE OR REPLACE FUNCTION app_private.broadcast_operator_public_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.is_internal OR NEW.sender_type NOT IN ('visitor','agent','system') THEN
    RETURN NEW;
  END IF;
  PERFORM realtime.send(jsonb_build_object(
    'id', NEW.id, 'workspace_id', NEW.workspace_id,
    'conversation_id', NEW.conversation_id, 'sequence_number', NEW.sequence_number,
    'sender_type', NEW.sender_type, 'body', NEW.body, 'is_internal', false,
    'client_message_id', NEW.client_message_id, 'created_at', NEW.created_at,
    'metadata_json', COALESCE(NEW.metadata_json, '{}'::jsonb)
  ), 'message.created', 'operator-messages:' || NEW.workspace_id::text, true);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.broadcast_operator_public_message() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER broadcast_operator_public_message
  AFTER INSERT ON public.messages DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.broadcast_operator_public_message();
COMMIT;
