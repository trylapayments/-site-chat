-- Conversation Assignment & Queues (v1)
-- Durable conversation-level assignee + versioned concurrency + timeline taxonomy.
-- History lives in customer_timeline_events (no separate assignment audit table).
-- See docs/CONVERSATION-ASSIGNMENT.md and docs/adr/ADR-005-conversation-assignment.md.

-- ---------------------------------------------------------------------------
-- Schema: current assignment on conversations
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by_member_id uuid,
  ADD COLUMN IF NOT EXISTS assignment_version bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.conversations.assigned_to IS
  'Current assignee workspace_members.id (nullable = unassigned queue).';
COMMENT ON COLUMN public.conversations.assigned_at IS
  'When the current assignee was set. Null when unassigned.';
COMMENT ON COLUMN public.conversations.assigned_by_member_id IS
  'Member who performed the current assignment. Null when unassigned or system.';
COMMENT ON COLUMN public.conversations.assignment_version IS
  'Monotonic revision bumped on every successful assignment change (CAS / concurrency).';

-- Ensure assigned_by stays in the same workspace (composite FK).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_conversations_assigned_by_workspace'
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT fk_conversations_assigned_by_workspace
      FOREIGN KEY (assigned_by_member_id, workspace_id)
      REFERENCES public.workspace_members (id, workspace_id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

-- Unassigned queue: open/pending conversations waiting for an owner.
CREATE INDEX IF NOT EXISTS idx_conversations_unassigned_queue
  ON public.conversations (workspace_id, status, last_message_at DESC NULLS LAST)
  WHERE assigned_to IS NULL;

-- Mine filter helper (already covered by idx_conversations_assigned for non-null).
CREATE INDEX IF NOT EXISTS idx_conversations_assignee_activity
  ON public.conversations (workspace_id, assigned_to, last_message_at DESC NULLS LAST)
  WHERE assigned_to IS NOT NULL;

-- Backfill assigned_at for any pre-existing assignees (best-effort; unknown actor).
UPDATE public.conversations
SET assigned_at = COALESCE(assigned_at, updated_at, created_at)
WHERE assigned_to IS NOT NULL
  AND assigned_at IS NULL;

-- ---------------------------------------------------------------------------
-- Timeline taxonomy: assigned / transferred / unassigned
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_timeline_events
  DROP CONSTRAINT IF EXISTS chk_customer_timeline_events_event_type;

ALTER TABLE public.customer_timeline_events
  ADD CONSTRAINT chk_customer_timeline_events_event_type CHECK (
    event_type IN (
      'page_viewed',
      'conversation_started',
      'visitor_message_sent',
      'operator_message_sent',
      'attachment_uploaded',
      'visitor_identified',
      'visitor_profile_updated',
      'conversation_status_changed',
      'conversation_assigned',
      'conversation_transferred',
      'conversation_unassigned'
    )
  );

-- Replace conversation timeline trigger to emit the three assignment event types
-- with from/to member labels. No-op assignment UPDATEs never fire (IS DISTINCT FROM).
CREATE OR REPLACE FUNCTION app_private.trg_conversations_timeline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_actor uuid;
  v_from_label text;
  v_to_label text;
  v_event_type text;
  v_actor_type text;
BEGIN
  v_contact_id := NEW.contact_id;
  IF v_contact_id IS NULL THEN
    SELECT vs.contact_id
    INTO v_contact_id
    FROM public.visitor_sessions vs
    WHERE vs.id = NEW.visitor_session_id;
  END IF;

  IF v_contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_actor := app_private.get_caller_member_id(NEW.workspace_id);

  IF TG_OP = 'INSERT' THEN
    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      'conversation_started',
      'visitor',
      jsonb_build_object(
        'v', 1,
        'channel_type', NEW.channel_type::text
      ),
      NEW.visitor_session_id,
      NEW.id,
      NULL,
      NEW.created_at,
      'conversation:' || NEW.id::text || ':started'
    );
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF v_actor IS NOT NULL THEN
      v_actor_type := 'operator';
    ELSE
      v_actor_type := 'system';
    END IF;

    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      'conversation_status_changed',
      v_actor_type,
      jsonb_build_object(
        'v', 1,
        'from_status', OLD.status::text,
        'to_status', NEW.status::text
      ),
      NEW.visitor_session_id,
      NEW.id,
      v_actor,
      now(),
      'conversation:' || NEW.id::text || ':status:' || OLD.status::text || ':' || NEW.status::text || ':' || NEW.assignment_version::text || ':' || floor(extract(epoch FROM clock_timestamp()) * 1000)::text
    );
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    IF OLD.assigned_to IS NOT NULL THEN
      v_from_label := app_private.member_display_label(OLD.assigned_to);
    ELSE
      v_from_label := NULL;
    END IF;

    IF NEW.assigned_to IS NOT NULL THEN
      v_to_label := app_private.member_display_label(NEW.assigned_to);
    ELSE
      v_to_label := NULL;
    END IF;

    IF OLD.assigned_to IS NULL AND NEW.assigned_to IS NOT NULL THEN
      v_event_type := 'conversation_assigned';
    ELSIF OLD.assigned_to IS NOT NULL AND NEW.assigned_to IS NULL THEN
      v_event_type := 'conversation_unassigned';
    ELSE
      v_event_type := 'conversation_transferred';
    END IF;

    IF v_actor IS NOT NULL THEN
      v_actor_type := 'operator';
    ELSE
      v_actor_type := 'system';
    END IF;

    PERFORM app_private.emit_customer_timeline_event(
      NEW.workspace_id,
      v_contact_id,
      v_event_type,
      v_actor_type,
      jsonb_build_object(
        'v', 1,
        'from_member_id', OLD.assigned_to,
        'from_member_label', v_from_label,
        'to_member_id', NEW.assigned_to,
        'to_member_label', v_to_label,
        -- Backward-compatible aliases used by older label formatters.
        'assignee_member_id', NEW.assigned_to,
        'assignee_label', v_to_label,
        'previous_assignee_member_id', OLD.assigned_to
      ),
      NEW.visitor_session_id,
      NEW.id,
      COALESCE(NEW.assigned_by_member_id, v_actor),
      COALESCE(NEW.assigned_at, now()),
      'conversation:' || NEW.id::text || ':assignment:' || NEW.assignment_version::text
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversations_timeline ON public.conversations;
CREATE TRIGGER trg_conversations_timeline
  AFTER INSERT OR UPDATE OF status, assigned_to ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_conversations_timeline();

-- ---------------------------------------------------------------------------
-- Detail builder: expose assignment metadata
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.build_conversation_detail(
  p_conversation public.conversations,
  p_member_id uuid,
  p_last_read_sequence bigint,
  p_stored_unread_count integer DEFAULT NULL,
  p_has_read_row boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts;
  v_contact_json jsonb;
  v_assigned jsonb;
  v_assigned_by jsonb;
  v_unread integer;
  v_visitor_read bigint;
  v_visitor_delivered bigint;
  v_agent_read bigint;
  v_agent_delivered bigint;
  v_session public.visitor_sessions;
  v_visitor jsonb;
  v_visitor_context jsonb;
  v_visitor_activity jsonb;
  v_page_views jsonb;
  v_first_seen timestamptz;
  v_last_seen timestamptz;
  v_visit_count integer;
  v_contact_id uuid;
BEGIN
  v_contact_id := p_conversation.contact_id;

  SELECT *
  INTO v_session
  FROM public.visitor_sessions vs
  WHERE vs.id = p_conversation.visitor_session_id;

  IF v_contact_id IS NULL AND FOUND THEN
    v_contact_id := v_session.contact_id;
  END IF;

  IF v_contact_id IS NOT NULL THEN
    SELECT *
    INTO v_contact
    FROM public.contacts c
    WHERE c.id = v_contact_id;

    IF FOUND THEN
      v_contact_json := jsonb_build_object(
        'id', v_contact.id,
        'public_id', v_contact.public_id,
        'name', v_contact.name,
        'email', v_contact.email,
        'phone', v_contact.phone
      );
      v_visitor := app_private.visitor_profile_json(v_contact);
      v_first_seen := v_contact.first_seen_at;
      v_last_seen := v_contact.last_seen_at;
      v_visit_count := v_contact.visit_count;
    ELSE
      v_contact_json := NULL;
      v_visitor := NULL;
    END IF;
  ELSE
    v_contact_json := NULL;
    v_visitor := NULL;
  END IF;

  IF p_conversation.assigned_to IS NOT NULL THEN
    v_assigned := jsonb_build_object(
      'member_id', p_conversation.assigned_to,
      'display_label', app_private.member_display_label(p_conversation.assigned_to)
    );
  ELSE
    v_assigned := NULL;
  END IF;

  IF p_conversation.assigned_by_member_id IS NOT NULL THEN
    v_assigned_by := jsonb_build_object(
      'member_id', p_conversation.assigned_by_member_id,
      'display_label', app_private.member_display_label(p_conversation.assigned_by_member_id)
    );
  ELSE
    v_assigned_by := NULL;
  END IF;

  v_unread := app_private.conversation_unread_count(
    p_conversation.id,
    p_member_id,
    p_last_read_sequence,
    p_stored_unread_count,
    p_has_read_row,
    p_conversation.visitor_message_count
  );

  SELECT v.last_read_sequence, v.last_delivered_sequence
  INTO v_visitor_read, v_visitor_delivered
  FROM app_private.visitor_receipt_cursors(p_conversation.id) v;

  SELECT a.last_read_sequence, a.last_delivered_sequence
  INTO v_agent_read, v_agent_delivered
  FROM app_private.agent_receipt_cursors(p_conversation.id) a;

  IF v_session.id IS NOT NULL THEN
    v_visitor_context := jsonb_build_object(
      'current_url', v_session.current_url,
      'current_title', v_session.current_title,
      'landing_url', v_session.landing_url,
      'referrer', v_session.referrer,
      'utm_source', v_session.utm_source,
      'utm_medium', v_session.utm_medium,
      'utm_campaign', v_session.utm_campaign,
      'utm_content', v_session.utm_content,
      'utm_term', v_session.utm_term,
      'browser_family', v_session.browser_family,
      'browser_version', v_session.browser_version,
      'os_family', v_session.os_family,
      'device_type', v_session.device_type,
      'locale', v_session.locale,
      'timezone', v_session.timezone,
      'language', v_session.language,
      'country_code', v_session.country_code
    );

    IF v_first_seen IS NULL THEN
      v_first_seen := v_session.created_at;
      v_last_seen := v_session.last_seen_at;
      v_visit_count := 1;
    END IF;
  ELSE
    v_visitor_context := NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', pv.id,
        'url', pv.url,
        'title', pv.title,
        'referrer', pv.referrer,
        'utm_source', pv.utm_source,
        'utm_medium', pv.utm_medium,
        'utm_campaign', pv.utm_campaign,
        'created_at', pv.created_at
      )
      ORDER BY pv.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_page_views
  FROM (
    SELECT
      p.id,
      p.url,
      p.title,
      p.referrer,
      p.utm_source,
      p.utm_medium,
      p.utm_campaign,
      p.created_at
    FROM public.visitor_page_views p
    WHERE p.workspace_id = p_conversation.workspace_id
      AND (
        (
          v_contact_id IS NOT NULL
          AND p.contact_id = v_contact_id
        )
        OR (
          v_contact_id IS NULL
          AND p.visitor_session_id = p_conversation.visitor_session_id
        )
      )
    ORDER BY p.created_at DESC
    LIMIT 20
  ) pv;

  IF v_first_seen IS NOT NULL THEN
    v_visitor_activity := jsonb_build_object(
      'first_seen_at', v_first_seen,
      'last_seen_at', COALESCE(v_last_seen, v_first_seen),
      'visit_count', COALESCE(v_visit_count, 1),
      'recent_page_views', COALESCE(v_page_views, '[]'::jsonb)
    );
  ELSE
    v_visitor_activity := NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', p_conversation.id,
    'status', p_conversation.status,
    'channel_type', p_conversation.channel_type,
    'assigned_to', v_assigned,
    'assigned_at', p_conversation.assigned_at,
    'assigned_by', v_assigned_by,
    'assignment_version', p_conversation.assignment_version,
    'contact', v_contact_json,
    'visitor_session_id', p_conversation.visitor_session_id,
    'visitor_realtime_topic',
      'widget-conversation:' || p_conversation.visitor_realtime_topic_key,
    'visitor_ephemeral_topic',
      'widget-ephemeral:' || p_conversation.visitor_realtime_topic_key,
    'source_url', p_conversation.source_url,
    'referrer', p_conversation.referrer,
    'visitor', v_visitor,
    'visitor_context', v_visitor_context,
    'visitor_activity', v_visitor_activity,
    'message_count', p_conversation.message_count,
    'last_message_at', p_conversation.last_message_at,
    'has_unread', v_unread > 0,
    'unread_count', v_unread,
    'member_last_read_sequence', COALESCE(p_last_read_sequence, 0),
    'visitor_last_read_sequence', COALESCE(v_visitor_read, 0),
    'visitor_last_delivered_sequence', COALESCE(v_visitor_delivered, 0),
    'agent_last_read_sequence', COALESCE(v_agent_read, 0),
    'agent_last_delivered_sequence', COALESCE(v_agent_delivered, 0),
    'created_at', p_conversation.created_at,
    'resolved_at', p_conversation.resolved_at
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Assignment core (row lock + CAS). Does not bump last_message_at.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.assert_assignable_member(
  p_workspace_id uuid,
  p_assignee_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status public.app_member_status;
  v_role public.app_member_role;
BEGIN
  SELECT wm.status, wm.role
  INTO v_status, v_role
  FROM public.workspace_members wm
  WHERE wm.id = p_assignee_member_id
    AND wm.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: Assignee is not a member of this workspace';
  END IF;

  IF v_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'MEMBER_NOT_ASSIGNABLE: Assignee is not an active workspace member';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'MEMBER_NOT_ASSIGNABLE: Assignees must have a messaging role';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.apply_conversation_assignment(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid,
  p_mode text,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_conversation public.conversations;
  v_last_read_sequence bigint;
  v_unread_count integer;
  v_has_read_row boolean := false;
  v_changed boolean := false;
  v_detail jsonb;
BEGIN
  IF p_mode NOT IN ('take', 'assign', 'unassign') THEN
    RAISE EXCEPTION 'FORBIDDEN: Invalid assignment mode';
  END IF;

  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  -- Serialize concurrent assignment mutations on this conversation row.
  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND: Conversation not found';
  END IF;

  IF p_expected_version IS NOT NULL
     AND v_conversation.assignment_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'ASSIGNMENT_CONFLICT: Assignment version mismatch';
  END IF;

  IF p_mode = 'take' THEN
    IF v_conversation.assigned_to IS NULL THEN
      NULL;
    ELSIF v_conversation.assigned_to = v_member_id THEN
      -- Idempotent no-op.
      NULL;
    ELSE
      RAISE EXCEPTION 'ASSIGNMENT_CONFLICT: Conversation is already assigned';
    END IF;

    IF v_conversation.assigned_to IS NULL THEN
      UPDATE public.conversations c
      SET
        assigned_to = v_member_id,
        assigned_at = now(),
        assigned_by_member_id = v_member_id,
        assignment_version = c.assignment_version + 1,
        updated_at = now()
      WHERE c.id = p_conversation_id
        AND c.workspace_id = p_workspace_id
        AND c.assigned_to IS NULL
        AND c.assignment_version = v_conversation.assignment_version
      RETURNING * INTO v_conversation;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_CONFLICT: Conversation is already assigned';
      END IF;
      v_changed := true;
    END IF;

  ELSIF p_mode = 'unassign' THEN
    IF v_conversation.assigned_to IS NULL THEN
      NULL;
    ELSE
      UPDATE public.conversations c
      SET
        assigned_to = NULL,
        assigned_at = NULL,
        assigned_by_member_id = NULL,
        assignment_version = c.assignment_version + 1,
        updated_at = now()
      WHERE c.id = p_conversation_id
        AND c.workspace_id = p_workspace_id
        AND c.assignment_version = v_conversation.assignment_version
      RETURNING * INTO v_conversation;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_CONFLICT: Assignment changed concurrently';
      END IF;
      v_changed := true;
    END IF;

  ELSE
    -- assign (includes transfer and initial assign)
    IF p_assignee_member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBER_NOT_FOUND: Assignee is required for assign';
    END IF;

    PERFORM app_private.assert_assignable_member(p_workspace_id, p_assignee_member_id);

    IF v_conversation.assigned_to IS NOT DISTINCT FROM p_assignee_member_id THEN
      NULL;
    ELSE
      UPDATE public.conversations c
      SET
        assigned_to = p_assignee_member_id,
        assigned_at = now(),
        assigned_by_member_id = v_member_id,
        assignment_version = c.assignment_version + 1,
        updated_at = now()
      WHERE c.id = p_conversation_id
        AND c.workspace_id = p_workspace_id
        AND c.assignment_version = v_conversation.assignment_version
      RETURNING * INTO v_conversation;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ASSIGNMENT_CONFLICT: Assignment changed concurrently';
      END IF;
      v_changed := true;
    END IF;
  END IF;

  SELECT r.last_read_sequence, r.unread_count, true
  INTO v_last_read_sequence, v_unread_count, v_has_read_row
  FROM public.conversation_member_reads r
  WHERE r.conversation_id = p_conversation_id
    AND r.member_id = v_member_id;

  IF NOT FOUND THEN
    v_last_read_sequence := NULL;
    v_unread_count := NULL;
    v_has_read_row := false;
  END IF;

  v_detail := app_private.build_conversation_detail(
    v_conversation,
    v_member_id,
    v_last_read_sequence,
    v_unread_count,
    v_has_read_row
  );

  RETURN jsonb_build_object(
    'conversation', v_detail,
    'changed', v_changed,
    'assignment', jsonb_build_object(
      'assignee_member_id', v_conversation.assigned_to,
      'assigned_at', v_conversation.assigned_at,
      'assigned_by_member_id', v_conversation.assigned_by_member_id,
      'assignment_version', v_conversation.assignment_version
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.take_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.apply_conversation_assignment(
    p_workspace_id,
    p_conversation_id,
    NULL,
    'take',
    p_expected_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.take_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.take_conversation(
    p_workspace_id,
    p_conversation_id,
    p_expected_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_assignee_member_id IS NULL THEN
    v_result := app_private.apply_conversation_assignment(
      p_workspace_id,
      p_conversation_id,
      NULL,
      'unassign',
      NULL
    );
  ELSE
    v_result := app_private.apply_conversation_assignment(
      p_workspace_id,
      p_conversation_id,
      p_assignee_member_id,
      'assign',
      NULL
    );
  END IF;

  -- Backward-compatible: historical callers expected conversation detail JSON.
  -- New clients should use the wrapped result; both shapes are returned via
  -- assignmentMutationResultSchema (conversation key) and legacy parse of detail.
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_assignee_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.assign_conversation(
    p_workspace_id,
    p_conversation_id,
    p_assignee_member_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.unassign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.apply_conversation_assignment(
    p_workspace_id,
    p_conversation_id,
    NULL,
    'unassign',
    p_expected_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unassign_conversation(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.unassign_conversation(
    p_workspace_id,
    p_conversation_id,
    p_expected_version
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Deactivate member → clear their open assignments (PRD)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.deactivate_workspace_member(p_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.workspace_members;
  v_caller_role public.app_member_role;
  v_caller_member_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_member := app_private.get_member_for_management(p_member_id);
  v_caller_role := app_private.user_workspace_role(v_member.workspace_id);

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owners and admins can deactivate members';
  END IF;

  IF v_member.role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only owners can deactivate owners';
  END IF;

  v_caller_member_id := app_private.get_caller_member_id(v_member.workspace_id);

  UPDATE public.workspace_members
  SET
    status = 'deactivated',
    updated_at = now()
  WHERE id = p_member_id;

  -- Return conversations to the unassigned queue. Does not bump last_message_at.
  UPDATE public.conversations c
  SET
    assigned_to = NULL,
    assigned_at = NULL,
    assigned_by_member_id = NULL,
    assignment_version = c.assignment_version + 1,
    updated_at = now()
  WHERE c.workspace_id = v_member.workspace_id
    AND c.assigned_to = p_member_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.take_conversation(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.take_conversation(uuid, uuid, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.unassign_conversation(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unassign_conversation(uuid, uuid, bigint) TO authenticated;

REVOKE ALL ON FUNCTION public.assign_conversation(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_conversation(uuid, uuid, uuid) TO authenticated;

-- Keep app_private locked down after CREATE OR REPLACE.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
