-- Claim only unassigned conversations when an actual public agent reply commits.
-- Covers text, attachments and voice; notes and failed/retried sends do not claim.
CREATE FUNCTION app_private.assign_conversation_on_agent_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.sender_type = 'agent' AND NOT NEW.is_internal AND NEW.agent_member_id IS NOT NULL THEN
    UPDATE public.conversations c
    SET assigned_to = NEW.agent_member_id,
        assigned_by_member_id = NEW.agent_member_id,
        assigned_at = now(), assignment_version = c.assignment_version + 1,
        updated_at = now()
    WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id
      AND c.assigned_to IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.assign_conversation_on_agent_reply() FROM PUBLIC;
CREATE TRIGGER assign_conversation_on_agent_reply
AFTER INSERT ON public.messages FOR EACH ROW
EXECUTE FUNCTION app_private.assign_conversation_on_agent_reply();
