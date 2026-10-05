-- Keep the latest completed transcript accessible to its authenticated visitor.
CREATE OR REPLACE FUNCTION app_private.widget_viewable_conversation(p_workspace_id uuid,p_visitor_session_id uuid)
RETURNS public.conversations LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.conversations;
BEGIN
 SELECT * INTO c FROM public.conversations WHERE workspace_id=p_workspace_id AND visitor_session_id=p_visitor_session_id
 ORDER BY (status IN ('open','pending')) DESC,created_at DESC,id DESC LIMIT 1;
 RETURN c;
END; $$;
