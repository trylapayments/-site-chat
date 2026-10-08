-- Preserve the table composite type when serializing internal notes.
-- No rows, permissions, signatures or pagination semantics are changed.
CREATE OR REPLACE FUNCTION "app_private"."list_internal_notes"("p_workspace_id" "uuid", "p_conversation_id" "uuid", "p_query" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_limit integer;
  v_before_created timestamptz;
  v_before_id uuid;
  v_after_created timestamptz;
  v_after_id uuid;
  v_include_deleted boolean := false;
  v_catch_up_since timestamptz;
  v_authoritative boolean := false;
  v_items jsonb := '[]'::jsonb;
  v_tombstones jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next_before jsonb := NULL;
  v_server_watermark timestamptz;
  v_row public.internal_notes;
  v_count integer := 0;
BEGIN
  PERFORM app_private.require_notes_access(p_workspace_id);

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND: Conversation not found.';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE((p_query ->> 'limit')::integer, 50), 1), 100);
  v_include_deleted := COALESCE((p_query ->> 'include_deleted')::boolean, false);
  v_authoritative := COALESCE((p_query ->> 'authoritative')::boolean, false);

  IF p_query ? 'catch_up_since' AND NULLIF(p_query ->> 'catch_up_since', '') IS NOT NULL THEN
    v_catch_up_since := (p_query ->> 'catch_up_since')::timestamptz;
  END IF;

  IF p_query ? 'before' AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_created := (p_query -> 'before' ->> 'created_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
  END IF;

  IF p_query ? 'after' AND jsonb_typeof(p_query -> 'after') = 'object' THEN
    v_after_created := (p_query -> 'after' ->> 'created_at')::timestamptz;
    v_after_id := (p_query -> 'after' ->> 'id')::uuid;
  END IF;

  -- Authoritative reconnect: newest active page (bounded) + tombstones since
  -- catch_up_since only. Clients must pass catch_up_since; when omitted, tombstones
  -- are empty (no unbounded deleted-row scan). Active page remains bounded by limit.
  IF v_authoritative THEN
    SELECT COALESCE(
      jsonb_agg(app_private.build_internal_note_item(n.note_row) ORDER BY (n.note_row).created_at ASC, (n.note_row).id ASC),
      '[]'::jsonb
    )
    INTO v_items
    FROM (
      SELECT n AS note_row
      FROM public.internal_notes n
      WHERE n.workspace_id = p_workspace_id
        AND n.conversation_id = p_conversation_id
        AND n.deleted_at IS NULL
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT v_limit
    ) n;

    IF v_catch_up_since IS NOT NULL THEN
      SELECT COALESCE(
        jsonb_agg(app_private.build_internal_note_item(n) ORDER BY n.updated_at ASC, n.id ASC),
        '[]'::jsonb
      )
      INTO v_tombstones
      FROM public.internal_notes n
      WHERE n.workspace_id = p_workspace_id
        AND n.conversation_id = p_conversation_id
        AND n.deleted_at IS NOT NULL
        AND n.updated_at >= v_catch_up_since;
    END IF;

    -- DB cursor only: never clock_timestamp()/now() — those can skip concurrent deletes.
    SELECT MAX(ts)
    INTO v_server_watermark
    FROM (
      SELECT v_catch_up_since AS ts
      WHERE v_catch_up_since IS NOT NULL
      UNION ALL
      SELECT (elem ->> 'updated_at')::timestamptz
      FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) AS elem
      UNION ALL
      SELECT (elem ->> 'updated_at')::timestamptz
      FROM jsonb_array_elements(COALESCE(v_tombstones, '[]'::jsonb)) AS elem
    ) s;

    RETURN jsonb_build_object(
      'items', COALESCE(v_items, '[]'::jsonb),
      'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
      'has_more', false,
      'next_before', NULL,
      'authoritative', true,
      'server_watermark', to_jsonb(v_server_watermark)
    );
  END IF;

  -- Newest page first (DESC), then reverse to chronological ASC for clients.
  FOR v_row IN
    SELECT n.*
    FROM public.internal_notes n
    WHERE n.workspace_id = p_workspace_id
      AND n.conversation_id = p_conversation_id
      AND (v_include_deleted OR n.deleted_at IS NULL)
      AND (
        v_before_created IS NULL
        OR (n.created_at, n.id) < (v_before_created, v_before_id)
      )
      AND (
        v_after_created IS NULL
        OR (n.created_at, n.id) > (v_after_created, v_after_id)
      )
      AND (
        v_catch_up_since IS NULL
        OR n.updated_at >= v_catch_up_since
        OR n.created_at >= v_catch_up_since
      )
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT v_limit + 1
  LOOP
    v_count := v_count + 1;
    IF v_count > v_limit THEN
      v_has_more := true;
      EXIT;
    END IF;
    v_items := jsonb_build_array(app_private.build_internal_note_item(v_row)) || v_items;
  END LOOP;

  IF v_has_more AND jsonb_array_length(v_items) > 0 THEN
    v_next_before := jsonb_build_object(
      'created_at', v_items -> 0 ->> 'created_at',
      'id', v_items -> 0 ->> 'id'
    );
  END IF;

  -- Soft-delete tombstones for catch-up windows (even when not include_deleted).
  IF v_catch_up_since IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(app_private.build_internal_note_item(n) ORDER BY n.updated_at ASC, n.id ASC),
      '[]'::jsonb
    )
    INTO v_tombstones
    FROM public.internal_notes n
    WHERE n.workspace_id = p_workspace_id
      AND n.conversation_id = p_conversation_id
      AND n.deleted_at IS NOT NULL
      AND n.updated_at >= v_catch_up_since;
  END IF;

  SELECT MAX(ts)
  INTO v_server_watermark
  FROM (
    SELECT v_catch_up_since AS ts
    WHERE v_catch_up_since IS NOT NULL
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_items, '[]'::jsonb)) AS elem
    UNION ALL
    SELECT (elem ->> 'updated_at')::timestamptz
    FROM jsonb_array_elements(COALESCE(v_tombstones, '[]'::jsonb)) AS elem
  ) s;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
    'has_more', v_has_more,
    'next_before', v_next_before,
    'authoritative', false,
    'server_watermark', to_jsonb(v_server_watermark)
  );
END;
$$;
