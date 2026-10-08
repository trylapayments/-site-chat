CREATE OR REPLACE FUNCTION public.list_all_conversations(
  p_workspace_ids uuid[],
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_role public.app_member_role;
  v_page integer;
  v_page_size integer;
  v_offset integer;
  v_sort_field text;
  v_sort_direction text;
  v_status public.app_conversation_status;
  v_assignment text;
  v_status_group text;
  v_search text;
  v_total integer;
  v_items jsonb;
  v_can_search_notes boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;

  v_page := GREATEST(COALESCE((p_query ->> 'page')::integer, 1), 1);
  v_page_size := LEAST(GREATEST(COALESCE((p_query ->> 'pageSize')::integer, 25), 1), 100);
  v_offset := (v_page - 1) * v_page_size;

  v_sort_field := COALESCE(NULLIF(p_query ->> 'sort', ''), '-last_message_at');
  IF v_sort_field LIKE '-%' THEN
    v_sort_direction := 'desc';
    v_sort_field := ltrim(v_sort_field, '-');
  ELSE
    v_sort_direction := 'asc';
  END IF;
  IF v_sort_field NOT IN ('last_message_at', 'created_at', 'status') THEN
    RAISE EXCEPTION 'Invalid sort field';
  END IF;

  IF p_query ? 'status' AND p_query ->> 'status' IS NOT NULL AND p_query ->> 'status' <> '' THEN
    v_status := (p_query ->> 'status')::public.app_conversation_status;
  END IF;

  v_status_group := NULLIF(p_query ->> 'statusGroup', '');
  IF v_status_group IS NOT NULL AND v_status_group NOT IN ('active', 'completed') THEN
    RAISE EXCEPTION 'Invalid status group';
  END IF;

  v_assignment := NULLIF(p_query ->> 'assignment', '');
  IF v_assignment IS NOT NULL AND v_assignment NOT IN ('all', 'unassigned', 'assigned_to_me') THEN
    RAISE EXCEPTION 'Invalid assignment filter';
  END IF;

  v_search := NULLIF(trim(p_query ->> 'q'), '');
  IF v_search IS NOT NULL AND length(v_search) > 200 THEN
    RAISE EXCEPTION 'Search query too long';
  END IF;

  SELECT count(*)
  INTO v_total
  FROM public.conversations c
  JOIN public.workspace_members wm ON wm.workspace_id=c.workspace_id AND wm.user_id=auth.uid() AND wm.status='active'
  JOIN public.workspaces w ON w.id=c.workspace_id AND w.status='active' AND w.deleted_at IS NULL
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id AND ct.workspace_id=c.workspace_id
  WHERE c.workspace_id = ANY(p_workspace_ids)
    AND (v_status IS NULL OR c.status = v_status)
    AND (v_status_group IS NULL
      OR (v_status_group = 'active' AND c.status IN ('open', 'pending'))
      OR (v_status_group = 'completed' AND c.status IN ('resolved', 'closed')))
    AND (
      v_assignment IS NULL
      OR v_assignment = 'all'
      OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
      OR (v_assignment = 'assigned_to_me' AND c.assigned_to = wm.id)
    )
    AND (
      v_search IS NULL
      OR ct.name ILIKE '%' || v_search || '%'
      OR ct.email ILIKE '%' || v_search || '%'
      OR c.last_message_preview ILIKE '%' || v_search || '%'
      OR (
        wm.role <> 'viewer'
        AND EXISTS (
          SELECT 1
          FROM public.internal_notes n
          WHERE n.conversation_id = c.id
            AND n.workspace_id = c.workspace_id
            AND n.deleted_at IS NULL
            AND (
              n.body ILIKE '%' || v_search || '%'
              OR n.search_vector @@ plainto_tsquery('english', v_search)
            )
        )
      )
    );

  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      app_private.build_conversation_list_item(
        c,
        wm.id,
        COALESCE(r.last_read_sequence, 0),
        r.unread_count,
        r.id IS NOT NULL
      ) || jsonb_build_object('workspace',jsonb_build_object('id',w.id,'slug',w.slug,'name',w.name)) AS item
    FROM public.conversations c
  JOIN public.workspace_members wm ON wm.workspace_id=c.workspace_id AND wm.user_id=auth.uid() AND wm.status='active'
  JOIN public.workspaces w ON w.id=c.workspace_id AND w.status='active' AND w.deleted_at IS NULL
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id AND ct.workspace_id=c.workspace_id
    LEFT JOIN public.conversation_member_reads r
      ON r.conversation_id = c.id
     AND r.member_id = wm.id
    WHERE c.workspace_id = ANY(p_workspace_ids)
      AND (v_status IS NULL OR c.status = v_status)
    AND (v_status_group IS NULL
      OR (v_status_group = 'active' AND c.status IN ('open', 'pending'))
      OR (v_status_group = 'completed' AND c.status IN ('resolved', 'closed')))
      AND (
        v_assignment IS NULL
        OR v_assignment = 'all'
        OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
        OR (v_assignment = 'assigned_to_me' AND c.assigned_to = wm.id)
      )
      AND (
        v_search IS NULL
        OR ct.name ILIKE '%' || v_search || '%'
        OR ct.email ILIKE '%' || v_search || '%'
        OR c.last_message_preview ILIKE '%' || v_search || '%'
        OR (
          wm.role <> 'viewer'
          AND EXISTS (
            SELECT 1
            FROM public.internal_notes n
            WHERE n.conversation_id = c.id
              AND n.workspace_id = c.workspace_id
              AND n.deleted_at IS NULL
              AND (
                n.body ILIKE '%' || v_search || '%'
                OR n.search_vector @@ plainto_tsquery('english', v_search)
              )
          )
        )
      )
    ORDER BY
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'asc' THEN c.status END ASC,
      CASE WHEN v_sort_field = 'status' AND v_sort_direction = 'desc' THEN c.status END DESC,
      CASE WHEN v_sort_field = 'last_message_at' AND v_sort_direction = 'desc' THEN c.last_message_at END DESC NULLS LAST,
      CASE WHEN v_sort_field = 'last_message_at' AND v_sort_direction = 'asc' THEN c.last_message_at END ASC NULLS LAST,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'desc' THEN c.created_at END DESC,
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN c.created_at END ASC, c.id
    LIMIT v_page_size
    OFFSET v_offset
  ) listed;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'total', v_total,
    'page', v_page,
    'pageSize', v_page_size
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_all_conversations(uuid[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_all_conversations(uuid[],jsonb) TO authenticated;
CREATE FUNCTION public.workspace_inboxes(p_workspace_ids uuid[]) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('workspaces',COALESCE(jsonb_agg(jsonb_build_object(
 'workspace_id',w.id,'name',w.name,'slug',w.slug,'role',m.role,'member_id',m.id,
 'unread_total',(app_private.get_inbox_unread_total(w.id)->>'unread_total')::integer) ORDER BY w.created_at),'[]'::jsonb))
 FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id
 WHERE m.user_id=auth.uid() AND m.status='active' AND w.status='active' AND w.deleted_at IS NULL AND w.id=ANY(p_workspace_ids);
$$;
REVOKE ALL ON FUNCTION public.workspace_inboxes(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_inboxes(uuid[]) TO authenticated;
CREATE FUNCTION public.delete_own_company(p_workspace_id uuid,p_confirmation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w public.workspaces;
BEGIN
 SELECT * INTO w FROM public.workspaces WHERE id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR app_private.user_workspace_role(p_workspace_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Only the owner can delete this company'; END IF;
 IF p_confirmation IS DISTINCT FROM w.name THEN RAISE EXCEPTION 'Type the exact company name'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts a WHERE a.workspace_id=w.id AND (a.synced_at IS NULL OR a.synced_at<now()-interval '5 minutes' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(a.snapshot->'subscriptions','[]'::jsonb)) s WHERE s->>'status' IS DISTINCT FROM 'cancelled'))) THEN RAISE EXCEPTION 'Cancel the subscription in Billing before deleting this company'; END IF;
 IF EXISTS(SELECT 1 FROM public.workspace_billing_accounts a WHERE a.workspace_id=w.id) AND NOT EXISTS(SELECT 1 FROM public.workspace_chargebee_accounts a WHERE a.workspace_id=w.id) THEN RAISE EXCEPTION 'Contact support to close billing before deleting this company'; END IF;
 PERFORM app_private.soft_delete_workspace(w.id);
 RETURN jsonb_build_object('deleted',true,'accountRetained',true);
END $$;
REVOKE ALL ON FUNCTION public.delete_own_company(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.delete_own_company(uuid,text) TO authenticated;
