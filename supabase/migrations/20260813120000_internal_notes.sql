-- Internal Notes + @mentions (operator-only)
-- Dedicated note entity (not messages.is_internal): soft-delete, edit, mentions,
-- durable notifications, timeline events, search_vector for PR #32 prep.
-- See docs/INTERNAL-NOTES.md and docs/adr/ADR-006-internal-notes.md.

-- ---------------------------------------------------------------------------
-- Enum: notification types (Phase 3 foundation; mention used by notes)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'app_notification_type'
  ) THEN
    CREATE TYPE public.app_notification_type AS ENUM (
      'conversation_new',
      'conversation_assigned',
      'mention',
      'billing_payment_failed',
      'trial_ending'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  author_member_id uuid,
  body text NOT NULL,
  client_note_id uuid,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(body, ''))
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_internal_notes_id_workspace UNIQUE (id, workspace_id),
  CONSTRAINT chk_internal_notes_body_length CHECK (
    char_length(body) >= 1 AND char_length(body) <= 4000
  ),
  CONSTRAINT fk_internal_notes_conversation_workspace
    FOREIGN KEY (conversation_id, workspace_id)
    REFERENCES public.conversations (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_internal_notes_author_workspace
    FOREIGN KEY (author_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE SET NULL (author_member_id)
);

COMMENT ON TABLE public.internal_notes IS
  'Operator-only private notes on conversations. Never exposed to visitors or viewers.';
COMMENT ON COLUMN public.internal_notes.client_note_id IS
  'Client idempotency key for create (reconnect / double-submit).';
COMMENT ON COLUMN public.internal_notes.author_member_id IS
  'Author member. Nullable only after member removal so note history survives.';
COMMENT ON COLUMN public.internal_notes.search_vector IS
  'FTS index prep for global search (PR #32). Operator-only via RLS.';
COMMENT ON COLUMN public.internal_notes.deleted_at IS
  'Soft delete. Listed/searchable rows require deleted_at IS NULL.';

CREATE UNIQUE INDEX uq_internal_notes_client_note_id
  ON public.internal_notes (conversation_id, client_note_id)
  WHERE client_note_id IS NOT NULL;

CREATE INDEX idx_internal_notes_conversation_created
  ON public.internal_notes (workspace_id, conversation_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_internal_notes_workspace_updated
  ON public.internal_notes (workspace_id, updated_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_internal_notes_search_vector
  ON public.internal_notes USING gin (search_vector)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_internal_notes_author
  ON public.internal_notes (author_member_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_internal_notes_set_updated_at
  BEFORE UPDATE ON public.internal_notes
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.internal_note_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  note_id uuid NOT NULL,
  mentioned_member_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_internal_note_mentions_note_member UNIQUE (note_id, mentioned_member_id),
  CONSTRAINT fk_internal_note_mentions_note_workspace
    FOREIGN KEY (note_id, workspace_id)
    REFERENCES public.internal_notes (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_internal_note_mentions_member_workspace
    FOREIGN KEY (mentioned_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_internal_note_mentions_member
  ON public.internal_note_mentions (workspace_id, mentioned_member_id, created_at DESC);

CREATE INDEX idx_internal_note_mentions_note
  ON public.internal_note_mentions (note_id);

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  type public.app_notification_type NOT NULL,
  title text NOT NULL,
  body text,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_notifications_title_length CHECK (
    char_length(title) >= 1 AND char_length(title) <= 200
  ),
  CONSTRAINT chk_notifications_body_length CHECK (
    body IS NULL OR char_length(body) <= 1000
  ),
  CONSTRAINT chk_notifications_resource_type_length CHECK (
    resource_type IS NULL OR char_length(resource_type) <= 64
  ),
  CONSTRAINT fk_notifications_recipient_workspace
    FOREIGN KEY (recipient_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_notifications_recipient
  ON public.notifications (recipient_id, read_at NULLS FIRST, created_at DESC);

CREATE INDEX idx_notifications_workspace_created
  ON public.notifications (workspace_id, created_at DESC);

-- Dedupe concurrent create only: one notification per (note, recipient, mention row).
-- Re-adding a mention after removal inserts a new mention row → new notification.
-- Lifetime suppression across remove/re-add is intentionally NOT used.
CREATE INDEX idx_notifications_mention_note_recipient
  ON public.notifications (workspace_id, recipient_id, resource_id, created_at DESC)
  WHERE type = 'mention' AND resource_type = 'internal_note';

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------

ALTER TABLE public.internal_notes REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'internal_notes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.internal_notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeline taxonomy: internal note + mention events
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
      'conversation_unassigned',
      'internal_note_created',
      'internal_note_updated',
      'internal_note_deleted',
      'mention_created'
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.require_notes_access(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);
  IF v_role IS NULL OR v_role = 'viewer' THEN
    RAISE EXCEPTION 'FORBIDDEN: Viewers cannot access internal notes.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.assert_mentionable_member(
  p_workspace_id uuid,
  p_member_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_member_role;
  v_status public.app_member_status;
BEGIN
  SELECT wm.role, wm.status
  INTO v_role, v_status
  FROM public.workspace_members wm
  WHERE wm.id = p_member_id
    AND wm.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MEMBER_NOT_FOUND: Mentioned member is not in this workspace.';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'MEMBER_NOT_MENTIONABLE: Mentioned member is not active.';
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'agent') THEN
    RAISE EXCEPTION 'MEMBER_NOT_MENTIONABLE: Viewers cannot be mentioned.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.build_internal_note_item(
  p_note public.internal_notes
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mentions jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'member_id', m.mentioned_member_id,
        'display_label', app_private.member_display_label(m.mentioned_member_id)
      )
      ORDER BY app_private.member_display_label(m.mentioned_member_id)
    ),
    '[]'::jsonb
  )
  INTO v_mentions
  FROM public.internal_note_mentions m
  WHERE m.note_id = p_note.id
    AND m.workspace_id = p_note.workspace_id;

  RETURN jsonb_build_object(
    'id', p_note.id,
    'workspace_id', p_note.workspace_id,
    'conversation_id', p_note.conversation_id,
    'author_member_id', p_note.author_member_id,
    'author_display_label', COALESCE(
      app_private.member_display_label(p_note.author_member_id),
      'Former member'
    ),
    'body', p_note.body,
    'client_note_id', p_note.client_note_id,
    'created_at', p_note.created_at,
    'updated_at', p_note.updated_at,
    'deleted_at', p_note.deleted_at,
    'mentions', v_mentions
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.resolve_note_contact_id(
  p_workspace_id uuid,
  p_conversation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_session_id uuid;
BEGIN
  SELECT c.contact_id, c.visitor_session_id
  INTO v_contact_id, v_session_id
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  IF v_contact_id IS NOT NULL THEN
    RETURN v_contact_id;
  END IF;

  IF v_session_id IS NOT NULL THEN
    SELECT vs.contact_id
    INTO v_contact_id
    FROM public.visitor_sessions vs
    WHERE vs.id = v_session_id
      AND vs.workspace_id = p_workspace_id;
  END IF;

  RETURN v_contact_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.sync_internal_note_mentions(
  p_workspace_id uuid,
  p_note_id uuid,
  p_conversation_id uuid,
  p_author_member_id uuid,
  p_mentioned_member_ids uuid[],
  p_emit_timeline boolean DEFAULT true
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ids uuid[] := ARRAY[]::uuid[];
  v_member_id uuid;
  v_contact_id uuid;
  v_author_label text;
  v_mentioned_label text;
  v_mention_id uuid;
BEGIN
  -- Deduplicate; self-mentions are allowed.
  IF p_mentioned_member_ids IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT x), ARRAY[]::uuid[])
    INTO v_ids
    FROM unnest(p_mentioned_member_ids) AS x
    WHERE x IS NOT NULL;
  END IF;

  FOREACH v_member_id IN ARRAY COALESCE(v_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM app_private.assert_mentionable_member(p_workspace_id, v_member_id);
  END LOOP;

  -- Remove mentions no longer present in the submitted set (sticky-mention fix).
  DELETE FROM public.internal_note_mentions m
  WHERE m.note_id = p_note_id
    AND m.workspace_id = p_workspace_id
    AND (
      COALESCE(cardinality(v_ids), 0) = 0
      OR NOT (m.mentioned_member_id = ANY (v_ids))
    );

  v_contact_id := app_private.resolve_note_contact_id(p_workspace_id, p_conversation_id);
  v_author_label := app_private.member_display_label(p_author_member_id);

  FOREACH v_member_id IN ARRAY COALESCE(v_ids, ARRAY[]::uuid[])
  LOOP
    v_mention_id := NULL;

    INSERT INTO public.internal_note_mentions (
      workspace_id,
      note_id,
      mentioned_member_id
    )
    VALUES (p_workspace_id, p_note_id, v_member_id)
    ON CONFLICT (note_id, mentioned_member_id) DO NOTHING
    RETURNING id INTO v_mention_id;

    -- Only newly inserted mentions notify / emit timeline (re-add after remove notifies again).
    IF v_mention_id IS NULL THEN
      CONTINUE;
    END IF;

    v_mentioned_label := app_private.member_display_label(v_member_id);

    INSERT INTO public.notifications (
      workspace_id,
      recipient_id,
      type,
      title,
      body,
      resource_type,
      resource_id
    )
    VALUES (
      p_workspace_id,
      v_member_id,
      'mention',
      'You were mentioned in an internal note',
      left(coalesce(v_author_label, 'A teammate') || ' mentioned you', 1000),
      'internal_note',
      p_note_id
    );

    IF p_emit_timeline AND v_contact_id IS NOT NULL THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact_id,
        'mention_created',
        'operator',
        jsonb_build_object(
          'v', 1,
          'note_id', p_note_id,
          'mentioned_member_id', v_member_id,
          'mentioned_member_label', v_mentioned_label,
          'author_member_id', p_author_member_id,
          'author_member_label', v_author_label,
          'mention_id', v_mention_id
        ),
        NULL,
        p_conversation_id,
        p_author_member_id,
        now(),
        -- Unique per mention row so remove→re-add can emit again.
        'internal_note:' || p_note_id::text || ':mention_row:' || v_mention_id::text
      );
    END IF;
  END LOOP;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;

-- ---------------------------------------------------------------------------
-- Create / update / soft-delete / list RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.create_internal_note(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_client_note_id uuid DEFAULT NULL,
  p_mentioned_member_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_body text;
  v_note public.internal_notes;
  v_contact_id uuid;
  v_is_new boolean := false;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member.';
  END IF;

  v_body := trim(COALESCE(p_body, ''));
  IF v_body = '' OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'INVALID_BODY: Note body must be 1–4000 characters.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'CONVERSATION_NOT_FOUND: Conversation not found.';
  END IF;

  IF p_client_note_id IS NOT NULL THEN
    -- Atomic idempotency: concurrent creates with the same client_note_id
    -- collapse to exactly one durable row (partial unique index).
    INSERT INTO public.internal_notes (
      workspace_id,
      conversation_id,
      author_member_id,
      body,
      client_note_id
    )
    VALUES (
      p_workspace_id,
      p_conversation_id,
      v_member_id,
      v_body,
      p_client_note_id
    )
    ON CONFLICT (conversation_id, client_note_id) WHERE client_note_id IS NOT NULL
    DO NOTHING
    RETURNING * INTO v_note;

    IF FOUND THEN
      v_is_new := true;
    ELSE
      SELECT n.*
      INTO v_note
      FROM public.internal_notes n
      WHERE n.conversation_id = p_conversation_id
        AND n.client_note_id = p_client_note_id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'NOTE_NOT_FOUND: Idempotent create lost the note row.';
      END IF;

      RETURN app_private.build_internal_note_item(v_note);
    END IF;
  ELSE
    INSERT INTO public.internal_notes (
      workspace_id,
      conversation_id,
      author_member_id,
      body,
      client_note_id
    )
    VALUES (
      p_workspace_id,
      p_conversation_id,
      v_member_id,
      v_body,
      NULL
    )
    RETURNING * INTO v_note;
    v_is_new := true;
  END IF;

  IF v_is_new THEN
    PERFORM app_private.sync_internal_note_mentions(
      p_workspace_id,
      v_note.id,
      p_conversation_id,
      v_member_id,
      p_mentioned_member_ids,
      true
    );

    SELECT n.* INTO v_note FROM public.internal_notes n WHERE n.id = v_note.id;

    v_contact_id := app_private.resolve_note_contact_id(p_workspace_id, p_conversation_id);
    IF v_contact_id IS NOT NULL THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact_id,
        'internal_note_created',
        'operator',
        jsonb_build_object(
          'v', 1,
          'note_id', v_note.id,
          'author_member_id', v_member_id,
          'author_member_label', app_private.member_display_label(v_member_id)
        ),
        NULL,
        p_conversation_id,
        v_member_id,
        v_note.created_at,
        'internal_note:' || v_note.id::text || ':created'
      );
    END IF;
  END IF;

  RETURN app_private.build_internal_note_item(v_note);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_internal_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_body text,
  p_mentioned_member_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_body text;
  v_note public.internal_notes;
  v_contact_id uuid;
  v_existing_ids uuid[] := ARRAY[]::uuid[];
  v_new_ids uuid[] := ARRAY[]::uuid[];
  v_body_changed boolean;
  v_mentions_changed boolean;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  v_body := trim(COALESCE(p_body, ''));
  IF v_body = '' OR char_length(v_body) > 4000 THEN
    RAISE EXCEPTION 'INVALID_BODY: Note body must be 1–4000 characters.';
  END IF;

  SELECT n.*
  INTO v_note
  FROM public.internal_notes n
  WHERE n.id = p_note_id
    AND n.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTE_NOT_FOUND: Internal note not found.';
  END IF;

  IF v_note.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOTE_DELETED: Internal note is deleted.';
  END IF;

  SELECT COALESCE(array_agg(m.mentioned_member_id ORDER BY m.mentioned_member_id), ARRAY[]::uuid[])
  INTO v_existing_ids
  FROM public.internal_note_mentions m
  WHERE m.note_id = p_note_id
    AND m.workspace_id = p_workspace_id;

  IF p_mentioned_member_ids IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), ARRAY[]::uuid[])
    INTO v_new_ids
    FROM unnest(p_mentioned_member_ids) AS x
    WHERE x IS NOT NULL;
  END IF;

  v_body_changed := v_note.body IS DISTINCT FROM v_body;
  v_mentions_changed := v_existing_ids IS DISTINCT FROM v_new_ids;

  -- No-op edit: identical body + mention set → no write, no timeline spam.
  IF NOT v_body_changed AND NOT v_mentions_changed THEN
    RETURN app_private.build_internal_note_item(v_note);
  END IF;

  IF v_body_changed THEN
    UPDATE public.internal_notes
    SET body = v_body
    WHERE id = p_note_id
      AND workspace_id = p_workspace_id
    RETURNING * INTO v_note;
  END IF;

  IF v_mentions_changed THEN
    PERFORM app_private.sync_internal_note_mentions(
      p_workspace_id,
      v_note.id,
      v_note.conversation_id,
      COALESCE(v_note.author_member_id, v_member_id),
      v_new_ids,
      true
    );
  END IF;

  SELECT n.* INTO v_note FROM public.internal_notes n WHERE n.id = v_note.id;

  -- Emit updated only when body changed (mention-only changes emit mention_created).
  IF v_body_changed THEN
    v_contact_id := app_private.resolve_note_contact_id(p_workspace_id, v_note.conversation_id);
    IF v_contact_id IS NOT NULL THEN
      PERFORM app_private.emit_customer_timeline_event(
        p_workspace_id,
        v_contact_id,
        'internal_note_updated',
        'operator',
        jsonb_build_object(
          'v', 1,
          'note_id', v_note.id,
          'author_member_id', v_note.author_member_id,
          'author_member_label', app_private.member_display_label(v_note.author_member_id),
          'updated_by_member_id', v_member_id,
          'updated_by_member_label', app_private.member_display_label(v_member_id)
        ),
        NULL,
        v_note.conversation_id,
        v_member_id,
        v_note.updated_at,
        'internal_note:' || v_note.id::text || ':updated:' || extract(epoch FROM v_note.updated_at)::text
      );
    END IF;
  END IF;

  RETURN app_private.build_internal_note_item(v_note);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.soft_delete_internal_note(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_note public.internal_notes;
  v_contact_id uuid;
BEGIN
  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  SELECT n.*
  INTO v_note
  FROM public.internal_notes n
  WHERE n.id = p_note_id
    AND n.workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTE_NOT_FOUND: Internal note not found.';
  END IF;

  IF v_note.deleted_at IS NOT NULL THEN
    RETURN app_private.build_internal_note_item(v_note);
  END IF;

  UPDATE public.internal_notes
  SET deleted_at = now()
  WHERE id = p_note_id
    AND workspace_id = p_workspace_id
  RETURNING * INTO v_note;

  v_contact_id := app_private.resolve_note_contact_id(p_workspace_id, v_note.conversation_id);
  IF v_contact_id IS NOT NULL THEN
    PERFORM app_private.emit_customer_timeline_event(
      p_workspace_id,
      v_contact_id,
      'internal_note_deleted',
      'operator',
      jsonb_build_object(
        'v', 1,
        'note_id', v_note.id,
        'author_member_id', v_note.author_member_id,
        'author_member_label', app_private.member_display_label(v_note.author_member_id),
        'deleted_by_member_id', v_member_id,
        'deleted_by_member_label', app_private.member_display_label(v_member_id)
      ),
      NULL,
      v_note.conversation_id,
      v_member_id,
      v_note.deleted_at,
      'internal_note:' || v_note.id::text || ':deleted'
    );
  END IF;

  RETURN app_private.build_internal_note_item(v_note);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.list_internal_notes(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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
  v_row record;
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

  -- Authoritative reconnect: return full active page (newest limit) as source of truth,
  -- plus soft-delete tombstones updated since catch_up_since (or all deleted in window).
  IF v_authoritative THEN
    SELECT COALESCE(
      jsonb_agg(app_private.build_internal_note_item(n) ORDER BY n.created_at ASC, n.id ASC),
      '[]'::jsonb
    )
    INTO v_items
    FROM (
      SELECT n.*
      FROM public.internal_notes n
      WHERE n.workspace_id = p_workspace_id
        AND n.conversation_id = p_conversation_id
        AND n.deleted_at IS NULL
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT v_limit
    ) n;

    SELECT COALESCE(
      jsonb_agg(app_private.build_internal_note_item(n) ORDER BY n.updated_at ASC, n.id ASC),
      '[]'::jsonb
    )
    INTO v_tombstones
    FROM public.internal_notes n
    WHERE n.workspace_id = p_workspace_id
      AND n.conversation_id = p_conversation_id
      AND n.deleted_at IS NOT NULL
      AND (
        v_catch_up_since IS NULL
        OR n.updated_at >= v_catch_up_since
        OR n.deleted_at >= v_catch_up_since
      );

    RETURN jsonb_build_object(
      'items', COALESCE(v_items, '[]'::jsonb),
      'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
      'has_more', false,
      'next_before', NULL,
      'authoritative', true
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
      AND (n.updated_at >= v_catch_up_since OR n.deleted_at >= v_catch_up_since);
  END IF;

  RETURN jsonb_build_object(
    'items', COALESCE(v_items, '[]'::jsonb),
    'tombstones', COALESCE(v_tombstones, '[]'::jsonb),
    'has_more', v_has_more,
    'next_before', v_next_before,
    'authoritative', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_internal_note(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_note public.internal_notes;
BEGIN
  PERFORM app_private.require_notes_access(p_workspace_id);

  SELECT n.*
  INTO v_note
  FROM public.internal_notes n
  WHERE n.id = p_note_id
    AND n.workspace_id = p_workspace_id
    AND n.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOTE_NOT_FOUND: Internal note not found.';
  END IF;

  RETURN app_private.build_internal_note_item(v_note);
END;
$$;

-- Public wrappers
CREATE OR REPLACE FUNCTION public.create_internal_note(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_client_note_id uuid DEFAULT NULL,
  p_mentioned_member_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.create_internal_note(
    p_workspace_id,
    p_conversation_id,
    p_body,
    p_client_note_id,
    p_mentioned_member_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_internal_note(
  p_workspace_id uuid,
  p_note_id uuid,
  p_body text,
  p_mentioned_member_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_internal_note(
    p_workspace_id,
    p_note_id,
    p_body,
    p_mentioned_member_ids
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_internal_note(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.soft_delete_internal_note(p_workspace_id, p_note_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.list_internal_notes(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_internal_notes(p_workspace_id, p_conversation_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_internal_note(
  p_workspace_id uuid,
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_internal_note(p_workspace_id, p_note_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_internal_note(uuid, uuid, text, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_internal_note(uuid, uuid, text, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_internal_note(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_internal_notes(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_internal_note(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_internal_note(uuid, uuid, text, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_internal_note(uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_internal_note(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_internal_notes(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_internal_note(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Inbox search: include note bodies for messaging roles (not viewers)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.list_conversations(
  p_workspace_id uuid,
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
  v_search text;
  v_total integer;
  v_items jsonb;
  v_can_search_notes boolean;
BEGIN
  PERFORM app_private.require_workspace_access(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  v_role := app_private.user_workspace_role(p_workspace_id);
  v_can_search_notes := v_role IS NOT NULL AND v_role <> 'viewer';

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
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id
  WHERE c.workspace_id = p_workspace_id
    AND (v_status IS NULL OR c.status = v_status)
    AND (
      v_assignment IS NULL
      OR v_assignment = 'all'
      OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
      OR (v_assignment = 'assigned_to_me' AND c.assigned_to = v_member_id)
    )
    AND (
      v_search IS NULL
      OR ct.name ILIKE '%' || v_search || '%'
      OR ct.email ILIKE '%' || v_search || '%'
      OR c.last_message_preview ILIKE '%' || v_search || '%'
      OR (
        v_can_search_notes
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
        v_member_id,
        COALESCE(r.last_read_sequence, 0),
        r.unread_count,
        r.id IS NOT NULL
      ) AS item
    FROM public.conversations c
    LEFT JOIN public.contacts ct ON ct.id = c.contact_id
    LEFT JOIN public.conversation_member_reads r
      ON r.conversation_id = c.id
     AND r.member_id = v_member_id
    WHERE c.workspace_id = p_workspace_id
      AND (v_status IS NULL OR c.status = v_status)
      AND (
        v_assignment IS NULL
        OR v_assignment = 'all'
        OR (v_assignment = 'unassigned' AND c.assigned_to IS NULL)
        OR (v_assignment = 'assigned_to_me' AND c.assigned_to = v_member_id)
      )
      AND (
        v_search IS NULL
        OR ct.name ILIKE '%' || v_search || '%'
        OR ct.email ILIKE '%' || v_search || '%'
        OR c.last_message_preview ILIKE '%' || v_search || '%'
        OR (
          v_can_search_notes
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
      CASE WHEN v_sort_field = 'created_at' AND v_sort_direction = 'asc' THEN c.created_at END ASC
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_note_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.internal_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.internal_note_mentions FROM PUBLIC;
REVOKE ALL ON TABLE public.notifications FROM PUBLIC;

GRANT SELECT ON TABLE public.internal_notes TO authenticated;
GRANT SELECT ON TABLE public.internal_note_mentions TO authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;

-- Notes: messaging roles only (viewers excluded). No direct writes.
CREATE POLICY internal_notes_select_authenticated
  ON public.internal_notes
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND app_private.user_workspace_role(workspace_id) IN ('owner', 'admin', 'agent')
  );

CREATE POLICY internal_note_mentions_select_authenticated
  ON public.internal_note_mentions
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND app_private.user_workspace_role(workspace_id) IN ('owner', 'admin', 'agent')
  );

-- Notifications: recipient only (or owner/admin for workspace oversight — keep recipient-only for privacy).
CREATE POLICY notifications_select_authenticated
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND recipient_id = app_private.get_caller_member_id(workspace_id)
  );

-- ---------------------------------------------------------------------------
-- Fix timeline actor composite FK: column-specific SET NULL (PG15+)
-- ---------------------------------------------------------------------------

ALTER TABLE public.customer_timeline_events
  DROP CONSTRAINT IF EXISTS fk_customer_timeline_events_actor_member_workspace;

ALTER TABLE public.customer_timeline_events
  ADD CONSTRAINT fk_customer_timeline_events_actor_member_workspace
  FOREIGN KEY (actor_member_id, workspace_id)
  REFERENCES public.workspace_members (id, workspace_id)
  ON DELETE SET NULL (actor_member_id);

-- ---------------------------------------------------------------------------
-- Viewer isolation: hide operator-private note/mention timeline events
-- Covers both RLS (direct SELECT + Realtime) and list_customer_timeline RPC.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS customer_timeline_events_select_member
  ON public.customer_timeline_events;

CREATE POLICY customer_timeline_events_select_member
  ON public.customer_timeline_events
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND (
      app_private.user_workspace_role(workspace_id) IS DISTINCT FROM 'viewer'
      OR event_type NOT IN (
        'internal_note_created',
        'internal_note_updated',
        'internal_note_deleted',
        'mention_created'
      )
    )
  );

CREATE OR REPLACE FUNCTION app_private.list_customer_timeline(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_id uuid;
  v_conversation_id uuid;
  v_limit integer;
  v_before_occurred timestamptz;
  v_before_id uuid;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
  v_role public.app_member_role;
  v_hide_notes boolean := false;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'Workspace not accessible';
  END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'query must be an object';
  END IF;

  v_contact_id := NULLIF(p_query ->> 'contact_id', '')::uuid;
  IF v_contact_id IS NULL THEN
    RAISE EXCEPTION 'contact_id is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts c
    WHERE c.id = v_contact_id
      AND c.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Contact not found';
  END IF;

  v_role := app_private.user_workspace_role(p_workspace_id);
  v_hide_notes := v_role = 'viewer';

  v_conversation_id := NULLIF(p_query ->> 'conversation_id', '')::uuid;

  v_limit := COALESCE((p_query ->> 'limit')::integer, 20);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  IF p_query ? 'before'
     AND p_query -> 'before' IS NOT NULL
     AND jsonb_typeof(p_query -> 'before') = 'object' THEN
    v_before_occurred := (p_query -> 'before' ->> 'occurred_at')::timestamptz;
    v_before_id := (p_query -> 'before' ->> 'id')::uuid;
    IF v_before_occurred IS NULL OR v_before_id IS NULL THEN
      RAISE EXCEPTION 'Invalid before cursor';
    END IF;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'workspace_id', q.workspace_id,
        'contact_id', q.contact_id,
        'visitor_session_id', q.visitor_session_id,
        'conversation_id', q.conversation_id,
        'event_type', q.event_type,
        'actor_type', q.actor_type,
        'actor_member_id', q.actor_member_id,
        'metadata_json', q.metadata_json,
        'occurred_at', q.occurred_at,
        'created_at', q.created_at,
        'dedupe_key', q.dedupe_key
      )
      ORDER BY q.occurred_at DESC, q.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM (
    SELECT e.*
    FROM public.customer_timeline_events e
    WHERE e.workspace_id = p_workspace_id
      AND e.contact_id = v_contact_id
      AND (v_conversation_id IS NULL OR e.conversation_id = v_conversation_id)
      AND (
        NOT v_hide_notes
        OR e.event_type NOT IN (
          'internal_note_created',
          'internal_note_updated',
          'internal_note_deleted',
          'mention_created'
        )
      )
      AND (
        v_before_occurred IS NULL
        OR (e.occurred_at < v_before_occurred)
        OR (e.occurred_at = v_before_occurred AND e.id < v_before_id)
      )
    ORDER BY e.occurred_at DESC, e.id DESC
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
      'occurred_at', v_last ->> 'occurred_at',
      'id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'events', COALESCE(v_rows, '[]'::jsonb),
    'next_before', v_next,
    'has_more', v_has_more
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Lock down app_private EXECUTE after CREATE OR REPLACE (repo standard)
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

-- Intentional helpers used by RLS policies / authenticated clients.
GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
