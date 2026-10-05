-- Hosted Supabase intentionally denies direct service-role table reads here.
-- Expose only public messages of an authorized, already claimed email request.
CREATE FUNCTION public.read_conversation_transcript(p_workspace_id uuid,p_request_id uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request public.conversation_transcript_requests;
BEGIN
 IF p_offset<0 THEN RAISE EXCEPTION 'Invalid offset'; END IF;
 SELECT * INTO request FROM public.conversation_transcript_requests WHERE id=p_request_id AND workspace_id=p_workspace_id AND status IN ('sending','sent') AND created_at>now()-interval '23 hours';
 IF request.id IS NULL THEN RAISE EXCEPTION 'Transcript request not found'; END IF;
 RETURN jsonb_build_object('workspaceName',(SELECT name FROM public.workspaces WHERE id=p_workspace_id),
 'messages',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'sender_type',m.sender_type,'body',m.body,'is_internal',false,'created_at',m.created_at,
  'metadata_json',jsonb_build_object('attachments',app_private.message_attachments_json(m.id)),
  'agent_member_id',m.agent_member_id,'agent_name',COALESCE(ap.display_name,'Agent')) ORDER BY m.sequence_number)
 FROM (SELECT * FROM public.messages WHERE workspace_id=p_workspace_id AND conversation_id=request.conversation_id AND NOT is_internal ORDER BY sequence_number LIMIT 500 OFFSET p_offset)m
 LEFT JOIN public.agent_profiles ap ON ap.member_id=m.agent_member_id AND ap.workspace_id=m.workspace_id),'[]'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.read_conversation_transcript(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_conversation_transcript(uuid,uuid,integer) TO service_role;
