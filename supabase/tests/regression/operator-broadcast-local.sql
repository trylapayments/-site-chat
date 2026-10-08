-- Run only against disposable/local fixtures; always rolls back.
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

DO $$
DECLARE fixture record; result jsonb;
BEGIN
 SELECT c.workspace_id,c.id,m.user_id INTO fixture FROM public.conversations c
 JOIN public.workspace_members m ON m.workspace_id=c.workspace_id WHERE m.role='owner' LIMIT 1;
 IF fixture.id IS NULL THEN RAISE EXCEPTION 'No local fixture'; END IF;
 PERFORM set_config('request.jwt.claim.sub',fixture.user_id::text,true);
 PERFORM set_config('realtime.topic','operator-messages:'||fixture.workspace_id::text,true);
 result := public.send_operator_message(fixture.workspace_id,fixture.id,'Broadcast local transaction check',gen_random_uuid());
 SET CONSTRAINTS ALL IMMEDIATE;
 PERFORM set_config('realtime.topic','operator-messages:'||fixture.workspace_id::text,true);
 IF NOT EXISTS (SELECT 1 FROM realtime.messages WHERE topic='operator-messages:'||fixture.workspace_id::text
   AND event='message.created' AND payload->>'body'='Broadcast local transaction check'
   AND payload->>'is_internal'='false') THEN RAISE EXCEPTION 'Broadcast missing'; END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM realtime.messages WHERE topic=realtime.topic() AND payload->>'body'='Broadcast local transaction check')
 THEN RAISE EXCEPTION 'Authorized member denied'; END IF;
END $$;
DO $$ BEGIN
 BEGIN
  INSERT INTO realtime.messages (payload,event,topic,private,extension)
  VALUES ('{}','message.created',realtime.topic(),true,'broadcast');
  RAISE EXCEPTION 'Client forged server message';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
SELECT set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic=realtime.topic())
 THEN RAISE EXCEPTION 'Nonmember can read workspace Broadcast'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE widget_realtime;
SELECT set_config('request.jwt.claims','{"purpose":"widget_realtime","topic_key":"invalid-test-key"}',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM realtime.messages WHERE topic=realtime.topic())
 THEN RAISE EXCEPTION 'Visitor can read operator Broadcast'; END IF;
END $$;
DO $$ BEGIN
 BEGIN
  INSERT INTO realtime.messages (payload,event,topic,private,extension)
  VALUES ('{}','message.created',realtime.topic(),true,'broadcast');
  RAISE EXCEPTION 'Client forged server message';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
