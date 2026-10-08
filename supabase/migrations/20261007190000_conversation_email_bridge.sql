-- Service-owned transport. Visitor email never identifies or merges a contact.
CREATE TABLE public.conversation_email_bridge_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.conversation_email_bridge_config(id) VALUES (true);
CREATE TABLE public.conversation_email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  reply_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32),'hex'),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '90 days',
  UNIQUE(conversation_id,recipient_email)
);
CREATE TABLE public.conversation_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.conversation_email_threads(id) ON DELETE CASCADE,
  message_id uuid NOT NULL UNIQUE REFERENCES public.messages(id) ON DELETE CASCADE,
  body text NOT NULL, sender_label text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now() + interval '30 seconds',
  lease uuid, lease_expires_at timestamptz, provider_id text, last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_email_outbox_due ON public.conversation_email_outbox(next_attempt_at) WHERE status IN ('pending','failed','sending');
CREATE TABLE public.conversation_email_inbound (
  provider_id uuid PRIMARY KEY, thread_id uuid NOT NULL REFERENCES public.conversation_email_threads(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.conversation_email_bridge_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_email_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_email_inbound ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.conversation_email_bridge_config,public.conversation_email_threads,public.conversation_email_outbox,public.conversation_email_inbound FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.conversation_email_bridge_config,public.conversation_email_threads,public.conversation_email_outbox,public.conversation_email_inbound TO service_role;

CREATE FUNCTION app_private.queue_customer_reply_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_thread uuid;
BEGIN
  IF NEW.sender_type <> 'agent' OR NEW.is_internal OR NOT EXISTS(SELECT 1 FROM public.conversation_email_bridge_config WHERE enabled) THEN RETURN NEW; END IF;
  SELECT lower(trim(coalesce(nullif(p.snapshot->>'email',''),ct.email))) INTO v_email
  FROM public.conversations c LEFT JOIN public.contacts ct ON ct.id=c.contact_id AND ct.workspace_id=c.workspace_id
  LEFT JOIN LATERAL (SELECT snapshot FROM public.pre_chat_submissions WHERE conversation_id=c.id AND workspace_id=c.workspace_id ORDER BY created_at DESC LIMIT 1) p ON true
  WHERE c.id=NEW.conversation_id AND c.workspace_id=NEW.workspace_id;
  IF v_email IS NULL OR length(v_email)>254 OR v_email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' THEN RETURN NEW; END IF;
  INSERT INTO public.conversation_email_threads(workspace_id,conversation_id,recipient_email)
  VALUES(NEW.workspace_id,NEW.conversation_id,v_email)
  ON CONFLICT(conversation_id,recipient_email) DO UPDATE SET expires_at=now()+interval '90 days'
  RETURNING id INTO v_thread;
  INSERT INTO public.conversation_email_outbox(thread_id,message_id,body,sender_label)
  VALUES(v_thread,NEW.id,NEW.body,coalesce(app_private.member_display_label(NEW.agent_member_id),'Mill team')) ON CONFLICT(message_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app_private.queue_customer_reply_email() FROM PUBLIC;
CREATE TRIGGER queue_customer_reply_email AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION app_private.queue_customer_reply_email();

CREATE FUNCTION public.claim_conversation_email_outbox(p_limit integer DEFAULT 3) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.conversation_email_bridge_config WHERE enabled) THEN RETURN '[]'::jsonb; END IF;
  UPDATE public.conversation_email_outbox o SET status='skipped',last_error='Expired or read in widget'
  FROM public.conversation_email_threads t,public.messages m
  WHERE o.thread_id=t.id AND o.message_id=m.id AND (o.status IN ('pending','failed') OR (o.status='sending' AND o.lease_expires_at<now()))
  AND (o.created_at<now()-interval '24 hours' OR t.expires_at<now() OR EXISTS(
    SELECT 1 FROM public.conversation_visitor_reads r WHERE r.conversation_id=t.conversation_id AND r.last_read_sequence>=m.sequence_number));
  WITH candidates AS (
    SELECT o.id FROM public.conversation_email_outbox o JOIN public.conversation_email_threads t ON t.id=o.thread_id
    JOIN public.workspaces w ON w.id=t.workspace_id
    WHERE w.status='active' AND w.deleted_at IS NULL AND o.attempts<10 AND o.next_attempt_at<=now()
    AND (o.status IN ('pending','failed') OR (o.status='sending' AND o.lease_expires_at<now()))
    ORDER BY o.next_attempt_at FOR UPDATE OF o SKIP LOCKED LIMIT least(greatest(p_limit,1),10)
  ), claimed AS (
    UPDATE public.conversation_email_outbox o SET status='sending',attempts=attempts+1,lease=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    FROM candidates q WHERE o.id=q.id RETURNING o.*
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'lease',o.lease,'body',o.body,'sender_label',o.sender_label,
      'to',t.recipient_email,'reply_token',t.reply_token,'conversation_id',t.conversation_id)), '[]'::jsonb)
    INTO v_result FROM claimed o JOIN public.conversation_email_threads t ON t.id=o.thread_id;
  RETURN v_result;
END $$;
CREATE FUNCTION public.finalize_conversation_email_outbox(p_id uuid,p_lease uuid,p_status text,p_provider_id text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF p_status NOT IN ('sent','failed','skipped') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.conversation_email_outbox SET status=p_status,provider_id=p_provider_id,last_error=left(p_error,100),lease=NULL,lease_expires_at=NULL,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,attempts)::integer))
  WHERE id=p_id AND lease=p_lease AND status='sending';
  RETURN FOUND;
END $$;

CREATE FUNCTION public.receive_conversation_email(p_provider_id uuid,p_token text,p_sender text,p_body text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.conversation_email_threads; c public.conversations; v_message uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.conversation_email_bridge_config WHERE enabled) THEN RETURN 'ignored'; END IF;
  IF p_token !~ '^[a-f0-9]{64}$' OR length(trim(p_body)) NOT BETWEEN 1 AND 20000 THEN RETURN 'ignored'; END IF;
  SELECT * INTO t FROM public.conversation_email_threads WHERE reply_token=p_token AND recipient_email=lower(trim(p_sender)) AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'ignored'; END IF;
  IF EXISTS(SELECT 1 FROM public.conversation_email_inbound WHERE provider_id=p_provider_id) THEN RETURN 'duplicate'; END IF;
  SELECT c1.* INTO c FROM public.conversations c1 JOIN public.workspaces w ON w.id=c1.workspace_id
    WHERE c1.id=t.conversation_id AND c1.workspace_id=t.workspace_id AND w.status='active' AND w.deleted_at IS NULL FOR UPDATE OF c1;
  IF NOT FOUND THEN RETURN 'ignored'; END IF;
  UPDATE public.conversations SET next_message_sequence=next_message_sequence+1,message_count=message_count+1,last_message_at=now(),last_message_preview=left(p_body,200),
    status='open',resolved_at=NULL,resolved_by=NULL,updated_at=now() WHERE id=c.id;
  INSERT INTO public.messages(workspace_id,conversation_id,sequence_number,sender_type,visitor_session_id,body,metadata_json)
    VALUES(t.workspace_id,c.id,c.next_message_sequence,'visitor',c.visitor_session_id,trim(p_body),jsonb_build_object('source','email','provider_email_id',p_provider_id)) RETURNING id INTO v_message;
  INSERT INTO public.conversation_email_inbound(provider_id,thread_id,message_id) VALUES(p_provider_id,t.id,v_message);
  PERFORM app_private.notify_visitor_message_event(t.workspace_id,c.id,v_message,false,p_body);
  RETURN 'received';
END $$;
REVOKE ALL ON FUNCTION public.claim_conversation_email_outbox(integer),public.finalize_conversation_email_outbox(uuid,uuid,text,text,text),public.receive_conversation_email(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_conversation_email_outbox(integer),public.finalize_conversation_email_outbox(uuid,uuid,text,text,text),public.receive_conversation_email(uuid,text,text,text) TO service_role;
