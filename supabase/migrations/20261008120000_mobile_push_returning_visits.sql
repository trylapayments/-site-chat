-- One visitor push per continuous online visit, including returning visitors.
ALTER TABLE public.mobile_push_visitor_outbox ADD COLUMN visit_started_at timestamptz;
UPDATE public.mobile_push_visitor_outbox SET visit_started_at=created_at;
ALTER TABLE public.mobile_push_visitor_outbox ALTER COLUMN visit_started_at SET NOT NULL;
ALTER TABLE public.mobile_push_visitor_outbox DROP CONSTRAINT mobile_push_visitor_outbox_visitor_session_id_device_id_key;
ALTER TABLE public.mobile_push_visitor_outbox ADD CONSTRAINT mobile_visitor_push_visit_unique UNIQUE(visitor_session_id,device_id,visit_started_at);
CREATE OR REPLACE FUNCTION app_private.enqueue_mobile_visitor_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.current_visit_started_at IS NOT DISTINCT FROM OLD.current_visit_started_at THEN RETURN NEW; END IF;
 END IF;
 INSERT INTO public.mobile_push_visitor_outbox(visitor_session_id,device_id,visit_started_at)
 SELECT NEW.id,d.id,NEW.current_visit_started_at FROM public.mobile_push_devices d
 JOIN public.workspace_members m ON m.id=d.member_id AND m.workspace_id=d.workspace_id AND m.user_id=d.user_id
 WHERE d.workspace_id=NEW.workspace_id AND d.push_new_visitor AND m.status='active' AND m.role::text<>'viewer'
 ON CONFLICT DO NOTHING;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RAISE WARNING 'Mobile visitor push enqueue failed (%)', SQLSTATE;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.enqueue_mobile_visitor_push() FROM PUBLIC;
DROP TRIGGER enqueue_mobile_visitor_push ON public.visitor_sessions;
CREATE TRIGGER enqueue_mobile_visitor_push AFTER INSERT OR UPDATE OF last_seen_at ON public.visitor_sessions FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_mobile_visitor_push();
NOTIFY pgrst, 'reload schema';
