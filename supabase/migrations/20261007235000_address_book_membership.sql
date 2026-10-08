-- Address-book membership is separate from durable visitor identity.
-- Preserve every visitor identity, conversation, message, page view and timeline event.
ALTER TABLE public.contacts ADD COLUMN saved_to_contacts boolean NOT NULL DEFAULT false;

-- Preserve previous explicit operator work, including anonymous CRM profiles.
UPDATE public.contacts c SET saved_to_contacts=true
WHERE NOT EXISTS (SELECT 1 FROM public.visitor_sessions s WHERE s.contact_id=c.id AND s.workspace_id=c.workspace_id)
 OR EXISTS (SELECT 1 FROM public.contact_tag_assignments t WHERE t.contact_id=c.id AND t.workspace_id=c.workspace_id)
 OR EXISTS (SELECT 1 FROM public.custom_field_values v WHERE v.contact_id=c.id AND v.workspace_id=c.workspace_id)
 OR EXISTS (SELECT 1 FROM public.customer_timeline_events e WHERE e.contact_id=c.id AND e.workspace_id=c.workspace_id AND e.actor_type='operator' AND e.event_type='visitor_profile_updated');

-- Future operator CRM work also explicitly promotes the durable identity.
CREATE FUNCTION app_private.promote_contact_address_book()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE public.contacts SET saved_to_contacts=true
 WHERE id=NEW.contact_id AND workspace_id=NEW.workspace_id AND NOT saved_to_contacts;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.promote_contact_address_book() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER contact_tag_promotes_address_book
AFTER INSERT OR UPDATE OF contact_id,workspace_id ON public.contact_tag_assignments
FOR EACH ROW EXECUTE FUNCTION app_private.promote_contact_address_book();
CREATE TRIGGER contact_custom_value_promotes_address_book
AFTER INSERT OR UPDATE OF contact_id,workspace_id ON public.custom_field_values
FOR EACH ROW EXECUTE FUNCTION app_private.promote_contact_address_book();
CREATE TRIGGER contact_operator_profile_promotes_address_book
AFTER INSERT ON public.customer_timeline_events
FOR EACH ROW WHEN (NEW.actor_type='operator' AND NEW.event_type='visitor_profile_updated')
EXECUTE FUNCTION app_private.promote_contact_address_book();

CREATE FUNCTION app_private.contact_in_address_book(p_contact public.contacts)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_contact.saved_to_contacts
 OR NULLIF(btrim(p_contact.name),'') IS NOT NULL
 OR NULLIF(btrim(p_contact.email),'') IS NOT NULL
 OR NULLIF(btrim(p_contact.phone),'') IS NOT NULL
 OR NULLIF(btrim(p_contact.phone_e164),'') IS NOT NULL
 OR p_contact.custom_attributes_json<>'{}'::jsonb
 OR p_contact.company_id IS NOT NULL
 OR NULLIF(btrim(p_contact.job_title),'') IS NOT NULL
 OR NULLIF(btrim(p_contact.locale),'') IS NOT NULL
 OR p_contact.country_code IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION app_private.contact_in_address_book(public.contacts) FROM PUBLIC,anon,authenticated;

CREATE INDEX contacts_address_book_recent ON public.contacts(workspace_id,last_seen_at DESC,id DESC)
WHERE saved_to_contacts
 OR NULLIF(btrim(name),'') IS NOT NULL OR NULLIF(btrim(email),'') IS NOT NULL
 OR NULLIF(btrim(phone),'') IS NOT NULL OR NULLIF(btrim(phone_e164),'') IS NOT NULL
 OR custom_attributes_json<>'{}'::jsonb OR company_id IS NOT NULL
 OR NULLIF(btrim(job_title),'') IS NOT NULL OR NULLIF(btrim(locale),'') IS NOT NULL
 OR country_code IS NOT NULL;

CREATE OR REPLACE FUNCTION app_private.list_contacts(p_workspace_id uuid, p_query jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_limit integer;
  v_q text;
  v_company_id uuid;
  v_tag_ids uuid[] := ARRAY[]::uuid[];
  v_before_last_seen timestamptz;
  v_before_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
  v_tag jsonb;
BEGIN
  PERFORM app_private.require_crm_read_access(p_workspace_id);

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUERY: query must be an object.';
  END IF;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 25);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  v_q := NULLIF(trim(COALESCE(p_query ->> 'q', '')), '');
  IF v_q IS NOT NULL AND char_length(v_q) > 200 THEN
    RAISE EXCEPTION 'INVALID_QUERY: Search query is too long.';
  END IF;

  IF NULLIF(p_query ->> 'company_id', '') IS NOT NULL THEN
    BEGIN
      v_company_id := (p_query ->> 'company_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'INVALID_QUERY: company_id must be a uuid.';
    END;
  END IF;

  IF p_query ? 'tag_ids'
     AND p_query -> 'tag_ids' IS NOT NULL
     AND p_query -> 'tag_ids' <> 'null'::jsonb THEN
    IF jsonb_typeof(p_query -> 'tag_ids') <> 'array' THEN
      RAISE EXCEPTION 'INVALID_QUERY: tag_ids must be an array of uuids.';
    END IF;
    FOR v_tag IN SELECT value FROM jsonb_array_elements(p_query -> 'tag_ids')
    LOOP
      BEGIN
        v_tag_ids := array_append(v_tag_ids, (v_tag #>> '{}')::uuid);
      EXCEPTION
        WHEN invalid_text_representation THEN
          RAISE EXCEPTION 'INVALID_QUERY: tag_ids must be an array of uuids.';
      END;
    END LOOP;
  END IF;

  IF p_query ? 'before'
     AND p_query -> 'before' IS NOT NULL
     AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_last_seen := (p_query -> 'before' ->> 'last_seen_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_last_seen IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_QUERY: Invalid before cursor.';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      app_private.contact_list_item_json(q.contact_row)
      ORDER BY q.last_seen_at DESC, q.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT c AS contact_row, c.last_seen_at, c.id
    FROM public.contacts c
    WHERE c.workspace_id = p_workspace_id
      AND (c.saved_to_contacts
 OR NULLIF(btrim(c.name),'') IS NOT NULL OR NULLIF(btrim(c.email),'') IS NOT NULL
 OR NULLIF(btrim(c.phone),'') IS NOT NULL OR NULLIF(btrim(c.phone_e164),'') IS NOT NULL
 OR c.custom_attributes_json<>'{}'::jsonb OR c.company_id IS NOT NULL
 OR NULLIF(btrim(c.job_title),'') IS NOT NULL OR NULLIF(btrim(c.locale),'') IS NOT NULL
 OR c.country_code IS NOT NULL)
      AND (v_company_id IS NULL OR c.company_id = v_company_id)
      AND (
        cardinality(v_tag_ids) = 0
        OR (
          SELECT count(DISTINCT a.tag_id)
          FROM public.contact_tag_assignments a
          INNER JOIN public.contact_tags t
            ON t.id = a.tag_id
           AND t.workspace_id = a.workspace_id
          WHERE a.workspace_id = p_workspace_id
            AND a.contact_id = c.id
            AND t.deleted_at IS NULL
            AND a.tag_id = ANY (v_tag_ids)
        ) = cardinality(v_tag_ids)
      )
      AND (
        v_q IS NULL
        OR c.search_vector @@ plainto_tsquery('english', v_q)
        OR c.name ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.email ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.phone ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
        OR c.job_title ILIKE '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
      )
      AND (
        v_before_last_seen IS NULL
        OR (c.last_seen_at < v_before_last_seen)
        OR (c.last_seen_at = v_before_last_seen AND c.id < v_before_id)
      )
    ORDER BY c.last_seen_at DESC, c.id DESC
    LIMIT v_limit + 1
  ) q;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    SELECT jsonb_agg(value ORDER BY ord)
    INTO v_rows
    FROM (
      SELECT value, ord
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(value, ord)
      WHERE ord <= v_limit
    ) trimmed;
  END IF;

  IF v_has_more AND jsonb_array_length(v_rows) > 0 THEN
    v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
    v_next := jsonb_build_object(
      'last_seen_at', v_last ->> 'last_seen_at',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_rows, '[]'::jsonb),
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$function$;


CREATE FUNCTION app_private.visitor_contact_membership(p_workspace_id uuid,p_visitor_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_contact_id uuid; v_saved boolean;
BEGIN
 PERFORM app_private.require_crm_read_access(p_workspace_id);
 SELECT s.contact_id INTO v_contact_id FROM public.visitor_sessions s
 WHERE s.id=p_visitor_session_id AND s.workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Visitor not found.'; END IF;
 IF v_contact_id IS NULL THEN RETURN jsonb_build_object('contactId',NULL,'saved',false); END IF;
 SELECT app_private.contact_in_address_book(c) INTO v_saved FROM public.contacts c
 WHERE c.id=v_contact_id AND c.workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Contact not found.'; END IF;
 RETURN jsonb_build_object('contactId',v_contact_id,'saved',v_saved);
END;
$$;

CREATE FUNCTION app_private.save_visitor_contact(p_workspace_id uuid,p_visitor_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_contact_id uuid; v_contact public.contacts;
BEGIN
 PERFORM app_private.require_crm_write_access(p_workspace_id);
 SELECT s.contact_id INTO v_contact_id FROM public.visitor_sessions s
 WHERE s.id=p_visitor_session_id AND s.workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Visitor not found.'; END IF;
 IF v_contact_id IS NULL THEN
  v_contact:=app_private.ensure_visitor_contact(p_workspace_id,NULL,false);
  v_contact_id:=v_contact.id;
  UPDATE public.visitor_sessions SET contact_id=v_contact_id WHERE id=p_visitor_session_id AND workspace_id=p_workspace_id;
  UPDATE public.conversations SET contact_id=v_contact_id WHERE visitor_session_id=p_visitor_session_id AND workspace_id=p_workspace_id AND contact_id IS NULL;
 END IF;
 PERFORM 1 FROM public.contacts c WHERE c.id=v_contact_id AND c.workspace_id=p_workspace_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: Contact not found.'; END IF;
 UPDATE public.contacts SET saved_to_contacts=true WHERE id=v_contact_id AND workspace_id=p_workspace_id AND NOT saved_to_contacts;
 RETURN jsonb_build_object('contactId',v_contact_id,'saved',true);
END;
$$;

CREATE FUNCTION public.visitor_contact_membership(p_workspace_id uuid,p_visitor_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.visitor_contact_membership(p_workspace_id,p_visitor_session_id);
$$;
CREATE FUNCTION public.save_visitor_contact(p_workspace_id uuid,p_visitor_session_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT app_private.save_visitor_contact(p_workspace_id,p_visitor_session_id);
$$;
REVOKE ALL ON FUNCTION app_private.visitor_contact_membership(uuid,uuid),app_private.save_visitor_contact(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.visitor_contact_membership(uuid,uuid),public.save_visitor_contact(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_contact_membership(uuid,uuid),public.save_visitor_contact(uuid,uuid) TO authenticated;
COMMENT ON COLUMN public.contacts.saved_to_contacts IS 'Explicit address-book membership. Anonymous visitor identity remains private historical data, not an automatically saved contact.';
NOTIFY pgrst,'reload schema';
