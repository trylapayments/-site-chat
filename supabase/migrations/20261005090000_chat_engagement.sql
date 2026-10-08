-- Separate from appearance drafts: changing a form never changes the widget theme.
CREATE TABLE public.workspace_chat_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_chat_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_chat_settings FROM anon, authenticated;
GRANT ALL ON public.workspace_chat_settings TO service_role;

ALTER TABLE public.visitor_sessions
  ADD COLUMN ip_address inet,
  ADD COLUMN pre_chat_submitted_at timestamptz,
  ADD COLUMN operator_initiated_at timestamptz;
-- The submission snapshot preserves labels/choices even after settings change.
CREATE TABLE public.pre_chat_submissions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  visitor_session_id uuid NOT NULL REFERENCES public.visitor_sessions(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visitor_session_id)
);
ALTER TABLE public.pre_chat_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pre_chat_submissions FROM anon, authenticated;
GRANT ALL ON public.pre_chat_submissions TO service_role;
CREATE INDEX visitor_sessions_active_workspace_idx ON public.visitor_sessions(workspace_id, last_seen_at DESC);

-- All public visitor operations require the opaque session capability; no IDs
-- supplied by the browser are trusted to locate another visitor's session.
CREATE FUNCTION public.widget_engagement_heartbeat(p_workspace_id uuid, p_session_token text, p_ip text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session public.visitor_sessions; v_conversation public.conversations;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  UPDATE public.visitor_sessions SET last_seen_at = now(), ip_address = COALESCE(NULLIF(p_ip, '')::inet, ip_address)
    WHERE id = v_session.id AND workspace_id = p_workspace_id RETURNING * INTO v_session;
  SELECT * INTO v_conversation FROM public.conversations
    WHERE workspace_id = p_workspace_id AND visitor_session_id = v_session.id AND status IN ('open', 'pending')
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object('hasConversation', v_conversation.id IS NOT NULL,
    'formSubmitted', v_session.pre_chat_submitted_at IS NOT NULL,
    'operatorInitiated', v_session.operator_initiated_at IS NOT NULL);
END; $$;
REVOKE ALL ON FUNCTION public.widget_engagement_heartbeat(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.widget_engagement_heartbeat(uuid, text, text) TO service_role;
