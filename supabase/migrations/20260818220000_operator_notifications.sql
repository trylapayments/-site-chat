-- Operator Notifications (PR #35)
-- Extends the Phase-3 foundation from internal notes into a durable notification
-- center: taxonomy, dedupe keys, unread counters, preferences, email outbox,
-- list/mark-read RPCs, and emit hooks for assignment + visitor messages.
-- See docs/NOTIFICATIONS.md.


-- ---------------------------------------------------------------------------
-- notifications: durable columns for navigation, dedupe, safe metadata
-- ---------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS dedupe_key text,
  ADD COLUMN IF NOT EXISTS actor_member_id uuid,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS payload_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.notifications.dedupe_key IS
  'Logical event key; UNIQUE per (workspace_id, recipient_id, dedupe_key).';
COMMENT ON COLUMN public.notifications.payload_json IS
  'Safe metadata only (ids, labels). Never note body, tokens, or secrets.';
COMMENT ON COLUMN public.notifications.actor_member_id IS
  'Optional actor member; nullable after member removal.';
COMMENT ON COLUMN public.notifications.conversation_id IS
  'Optional conversation for deep-link navigation.';

-- Backfill dedupe keys for existing mention rows (idempotent re-runs).
UPDATE public.notifications n
SET dedupe_key = 'mention:legacy:' || n.id::text
WHERE n.dedupe_key IS NULL
  AND n.type = 'mention';

UPDATE public.notifications n
SET dedupe_key = 'legacy:' || n.type::text || ':' || n.id::text
WHERE n.dedupe_key IS NULL;

ALTER TABLE public.notifications
  ALTER COLUMN dedupe_key SET NOT NULL;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS uq_notifications_recipient_dedupe;

ALTER TABLE public.notifications
  ADD CONSTRAINT uq_notifications_recipient_dedupe
  UNIQUE (workspace_id, recipient_id, dedupe_key);

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS chk_notifications_dedupe_key_length;

ALTER TABLE public.notifications
  ADD CONSTRAINT chk_notifications_dedupe_key_length CHECK (
    char_length(dedupe_key) >= 1 AND char_length(dedupe_key) <= 200
  );

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS fk_notifications_actor_workspace;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_actor_workspace
  FOREIGN KEY (actor_member_id, workspace_id)
  REFERENCES public.workspace_members (id, workspace_id)
  ON DELETE SET NULL (actor_member_id);

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS fk_notifications_conversation_workspace;

ALTER TABLE public.notifications
  ADD CONSTRAINT fk_notifications_conversation_workspace
  FOREIGN KEY (conversation_id, workspace_id)
  REFERENCES public.conversations (id, workspace_id)
  ON DELETE CASCADE;

-- Recipient feed (keyset): newest first by (created_at, id)
DROP INDEX IF EXISTS idx_notifications_recipient;
CREATE INDEX idx_notifications_recipient_created
  ON public.notifications (workspace_id, recipient_id, created_at DESC, id DESC);

CREATE INDEX idx_notifications_recipient_unread
  ON public.notifications (workspace_id, recipient_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

CREATE INDEX idx_notifications_conversation
  ON public.notifications (workspace_id, conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Per-member unread counter (O(1) badge)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_unread_counts (
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  unread_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, member_id),
  CONSTRAINT chk_notification_unread_counts_nonneg CHECK (unread_count >= 0),
  CONSTRAINT fk_notification_unread_counts_member_workspace
    FOREIGN KEY (member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_unread_counts IS
  'Per-member unread badge counter. Updated by triggers on notifications.';

ALTER TABLE public.notification_unread_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_unread_counts FROM PUBLIC;
GRANT SELECT ON TABLE public.notification_unread_counts TO authenticated;

DROP POLICY IF EXISTS notification_unread_counts_select_own
  ON public.notification_unread_counts;

CREATE POLICY notification_unread_counts_select_own
  ON public.notification_unread_counts
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND member_id = app_private.get_caller_member_id(workspace_id)
  );

-- Backfill counters from existing unread rows.
INSERT INTO public.notification_unread_counts (workspace_id, member_id, unread_count, updated_at)
SELECT n.workspace_id, n.recipient_id, count(*)::integer, now()
FROM public.notifications n
WHERE n.read_at IS NULL
GROUP BY n.workspace_id, n.recipient_id
ON CONFLICT (workspace_id, member_id) DO UPDATE
SET unread_count = EXCLUDED.unread_count, updated_at = now();

CREATE OR REPLACE FUNCTION app_private.adjust_notification_unread_count(
  p_workspace_id uuid,
  p_member_id uuid,
  p_delta integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_member_id IS NULL OR p_delta = 0 THEN
    RETURN;
  END IF;

  -- Decrements must not INSERT (member may be mid-cascade delete).
  IF p_delta < 0 THEN
    UPDATE public.notification_unread_counts c
    SET
      unread_count = GREATEST(c.unread_count + p_delta, 0),
      updated_at = now()
    WHERE c.workspace_id = p_workspace_id
      AND c.member_id = p_member_id;
    RETURN;
  END IF;

  INSERT INTO public.notification_unread_counts (
    workspace_id, member_id, unread_count, updated_at
  )
  VALUES (
    p_workspace_id,
    p_member_id,
    p_delta,
    now()
  )
  ON CONFLICT (workspace_id, member_id) DO UPDATE
  SET
    unread_count = public.notification_unread_counts.unread_count + p_delta,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_notifications_unread_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.read_at IS NULL THEN
    PERFORM app_private.adjust_notification_unread_count(
      NEW.workspace_id, NEW.recipient_id, 1
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_notifications_unread_au()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.read_at IS NULL AND NEW.read_at IS NOT NULL THEN
    PERFORM app_private.adjust_notification_unread_count(
      NEW.workspace_id, NEW.recipient_id, -1
    );
  ELSIF OLD.read_at IS NOT NULL AND NEW.read_at IS NULL THEN
    PERFORM app_private.adjust_notification_unread_count(
      NEW.workspace_id, NEW.recipient_id, 1
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_notifications_unread_ad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.read_at IS NULL THEN
    PERFORM app_private.adjust_notification_unread_count(
      OLD.workspace_id, OLD.recipient_id, -1
    );
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_unread_ai ON public.notifications;
CREATE TRIGGER trg_notifications_unread_ai
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_notifications_unread_ai();

DROP TRIGGER IF EXISTS trg_notifications_unread_au ON public.notifications;
CREATE TRIGGER trg_notifications_unread_au
  AFTER UPDATE OF read_at ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_notifications_unread_au();

DROP TRIGGER IF EXISTS trg_notifications_unread_ad ON public.notifications;
CREATE TRIGGER trg_notifications_unread_ad
  AFTER DELETE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION app_private.trg_notifications_unread_ad();

-- Realtime for unread counter table (badge sync across tabs)
ALTER TABLE public.notification_unread_counts REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notification_unread_counts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notification_unread_counts;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- notification_preferences (per member; never overwritten by workspace)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  workspace_member_id uuid NOT NULL,
  -- In-app categories
  in_app_conversation_new boolean NOT NULL DEFAULT true,
  in_app_visitor_message boolean NOT NULL DEFAULT true,
  in_app_assignment boolean NOT NULL DEFAULT true,
  in_app_mention boolean NOT NULL DEFAULT true,
  in_app_transfer boolean NOT NULL DEFAULT true,
  -- Browser / desktop Notification API
  browser_enabled boolean NOT NULL DEFAULT false,
  browser_conversation_new boolean NOT NULL DEFAULT true,
  browser_visitor_message boolean NOT NULL DEFAULT true,
  browser_assignment boolean NOT NULL DEFAULT true,
  browser_mention boolean NOT NULL DEFAULT true,
  browser_permission_denied_at timestamptz,
  -- Sound (muted by default; requires user gesture before first play)
  sound_enabled boolean NOT NULL DEFAULT false,
  sound_visitor_message boolean NOT NULL DEFAULT true,
  sound_assignment boolean NOT NULL DEFAULT true,
  -- Email categories (outbox foundation)
  email_conversation_new boolean NOT NULL DEFAULT true,
  email_assignment boolean NOT NULL DEFAULT true,
  email_mention boolean NOT NULL DEFAULT true,
  email_visitor_message boolean NOT NULL DEFAULT false,
  -- Do-not-disturb / quiet hours
  dnd_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_preferences_member UNIQUE (workspace_member_id),
  CONSTRAINT fk_notification_preferences_member_workspace
    FOREIGN KEY (workspace_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE,
  CONSTRAINT chk_notification_preferences_timezone_length CHECK (
    char_length(timezone) >= 1 AND char_length(timezone) <= 64
  )
);

COMMENT ON TABLE public.notification_preferences IS
  'Per-member notification channel preferences. No workspace override.';

CREATE TRIGGER trg_notification_preferences_set_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_preferences FROM PUBLIC;
GRANT SELECT ON TABLE public.notification_preferences TO authenticated;

DROP POLICY IF EXISTS notification_preferences_select_own
  ON public.notification_preferences;

CREATE POLICY notification_preferences_select_own
  ON public.notification_preferences
  FOR SELECT
  TO authenticated
  USING (
    app_private.workspace_is_accessible(workspace_id)
    AND workspace_member_id = app_private.get_caller_member_id(workspace_id)
  );

-- ---------------------------------------------------------------------------
-- Email outbox (idempotent foundation; delivery is optional/minimal)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  notification_id uuid REFERENCES public.notifications (id) ON DELETE SET NULL,
  recipient_member_id uuid NOT NULL,
  email_category text NOT NULL,
  dedupe_key text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_email_outbox_dedupe UNIQUE (workspace_id, dedupe_key),
  CONSTRAINT chk_notification_email_outbox_status CHECK (
    status IN ('pending', 'sent', 'skipped', 'failed')
  ),
  CONSTRAINT chk_notification_email_outbox_category CHECK (
    email_category IN ('mention', 'assignment', 'conversation_new', 'visitor_message')
  ),
  CONSTRAINT fk_notification_email_outbox_member_workspace
    FOREIGN KEY (recipient_member_id, workspace_id)
    REFERENCES public.workspace_members (id, workspace_id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_email_outbox IS
  'Idempotent email delivery queue. Processors mark sent/skipped/failed.';

CREATE INDEX idx_notification_email_outbox_pending
  ON public.notification_email_outbox (status, created_at ASC)
  WHERE status = 'pending';

CREATE TRIGGER trg_notification_email_outbox_set_updated_at
  BEFORE UPDATE ON public.notification_email_outbox
  FOR EACH ROW
  EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.notification_email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_email_outbox FROM PUBLIC;
-- No authenticated access — service/security definer only.

-- ---------------------------------------------------------------------------
-- Preference helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.default_notification_preferences()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'in_app_conversation_new', true,
    'in_app_visitor_message', true,
    'in_app_assignment', true,
    'in_app_mention', true,
    'in_app_transfer', true,
    'browser_enabled', false,
    'browser_conversation_new', true,
    'browser_visitor_message', true,
    'browser_assignment', true,
    'browser_mention', true,
    'browser_permission_denied_at', NULL,
    'sound_enabled', false,
    'sound_visitor_message', true,
    'sound_assignment', true,
    'email_conversation_new', true,
    'email_assignment', true,
    'email_mention', true,
    'email_visitor_message', false,
    'dnd_enabled', false,
    'quiet_hours_start', NULL,
    'quiet_hours_end', NULL,
    'timezone', 'UTC'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.get_or_init_notification_preferences(
  p_workspace_id uuid,
  p_member_id uuid
)
RETURNS public.notification_preferences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.notification_preferences;
BEGIN
  SELECT *
  INTO v_row
  FROM public.notification_preferences p
  WHERE p.workspace_member_id = p_member_id
    AND p.workspace_id = p_workspace_id;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  INSERT INTO public.notification_preferences (
    workspace_id,
    workspace_member_id
  )
  VALUES (p_workspace_id, p_member_id)
  ON CONFLICT (workspace_member_id) DO NOTHING
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN v_row;
  END IF;

  SELECT *
  INTO v_row
  FROM public.notification_preferences p
  WHERE p.workspace_member_id = p_member_id
    AND p.workspace_id = p_workspace_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.notification_in_quiet_hours(
  p_prefs public.notification_preferences
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_local_time time;
  v_start time;
  v_end time;
BEGIN
  IF NOT p_prefs.dnd_enabled THEN
    RETURN false;
  END IF;

  v_start := p_prefs.quiet_hours_start;
  v_end := p_prefs.quiet_hours_end;
  -- No window OR equal bounds → always quiet while DND is on.
  IF v_start IS NULL OR v_end IS NULL OR v_start = v_end THEN
    RETURN true;
  END IF;

  BEGIN
    v_local_time := (now() AT TIME ZONE p_prefs.timezone)::time;
  EXCEPTION
    WHEN OTHERS THEN
      v_local_time := (now() AT TIME ZONE 'UTC')::time;
  END;

  IF v_start < v_end THEN
    RETURN v_local_time >= v_start AND v_local_time < v_end;
  END IF;

  -- Window crosses midnight.
  RETURN v_local_time >= v_start OR v_local_time < v_end;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.notification_in_app_enabled(
  p_prefs public.notification_preferences,
  p_type public.app_notification_type
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE p_type
    WHEN 'conversation_new' THEN p_prefs.in_app_conversation_new
    WHEN 'visitor_message' THEN p_prefs.in_app_visitor_message
    WHEN 'conversation_assigned' THEN p_prefs.in_app_assignment
    WHEN 'conversation_transferred' THEN p_prefs.in_app_transfer
    WHEN 'conversation_unassigned' THEN p_prefs.in_app_transfer
    WHEN 'mention' THEN p_prefs.in_app_mention
    ELSE true
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.notification_email_enabled(
  p_prefs public.notification_preferences,
  p_type public.app_notification_type
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE p_type
    WHEN 'conversation_new' THEN p_prefs.email_conversation_new
    WHEN 'visitor_message' THEN p_prefs.email_visitor_message
    WHEN 'conversation_assigned' THEN p_prefs.email_assignment
    WHEN 'conversation_transferred' THEN p_prefs.email_assignment
    WHEN 'mention' THEN p_prefs.email_mention
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.notification_email_category(
  p_type public.app_notification_type
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_type
    WHEN 'conversation_new' THEN 'conversation_new'
    WHEN 'visitor_message' THEN 'visitor_message'
    WHEN 'conversation_assigned' THEN 'assignment'
    WHEN 'conversation_transferred' THEN 'assignment'
    WHEN 'mention' THEN 'mention'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION app_private.viewer_may_receive_notification(
  p_type public.app_notification_type
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  -- Viewers may not receive mention / note-adjacent types.
  -- Assignment/transfer/unassign target assignable roles only in practice.
  SELECT p_type IN (
    'conversation_new',
    'visitor_message',
    'billing_payment_failed',
    'trial_ending'
  );
$$;

-- ---------------------------------------------------------------------------
-- Core emit helper (idempotent insert + optional email outbox)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.emit_notification(
  p_workspace_id uuid,
  p_recipient_id uuid,
  p_type public.app_notification_type,
  p_dedupe_key text,
  p_title text,
  p_body text DEFAULT NULL,
  p_resource_type text DEFAULT NULL,
  p_resource_id uuid DEFAULT NULL,
  p_conversation_id uuid DEFAULT NULL,
  p_actor_member_id uuid DEFAULT NULL,
  p_payload_json jsonb DEFAULT '{}'::jsonb,
  p_force_in_app boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member public.workspace_members;
  v_prefs public.notification_preferences;
  v_notification_id uuid;
  v_email text;
  v_category text;
  v_quiet boolean;
BEGIN
  IF p_recipient_id IS NULL OR p_dedupe_key IS NULL OR char_length(p_dedupe_key) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_member
  FROM public.workspace_members m
  WHERE m.id = p_recipient_id
    AND m.workspace_id = p_workspace_id
    AND m.status = 'active';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_member.role = 'viewer'
     AND NOT app_private.viewer_may_receive_notification(p_type) THEN
    RETURN NULL;
  END IF;

  -- Mentions / notes must never target viewers (defense in depth).
  IF p_type = 'mention' AND v_member.role = 'viewer' THEN
    RETURN NULL;
  END IF;

  v_prefs := app_private.get_or_init_notification_preferences(
    p_workspace_id,
    p_recipient_id
  );

  -- Quiet/DND suppresses email only here; durable in-app is independent.
  -- (Client browser/sound also use shared quiet-hours evaluator.)
  v_quiet := app_private.notification_in_quiet_hours(v_prefs);

  IF p_force_in_app
     OR app_private.notification_in_app_enabled(v_prefs, p_type) THEN
    INSERT INTO public.notifications (
      workspace_id,
      recipient_id,
      type,
      title,
      body,
      resource_type,
      resource_id,
      dedupe_key,
      actor_member_id,
      conversation_id,
      payload_json
    )
    VALUES (
      p_workspace_id,
      p_recipient_id,
      p_type,
      left(p_title, 200),
      CASE WHEN p_body IS NULL THEN NULL ELSE left(p_body, 1000) END,
      p_resource_type,
      p_resource_id,
      left(p_dedupe_key, 200),
      p_actor_member_id,
      p_conversation_id,
      COALESCE(p_payload_json, '{}'::jsonb)
    )
    ON CONFLICT (workspace_id, recipient_id, dedupe_key) DO NOTHING
    RETURNING id INTO v_notification_id;

    IF v_notification_id IS NULL THEN
      SELECT n.id
      INTO v_notification_id
      FROM public.notifications n
      WHERE n.workspace_id = p_workspace_id
        AND n.recipient_id = p_recipient_id
        AND n.dedupe_key = left(p_dedupe_key, 200);
    END IF;
  END IF;

  -- Email outbox (idempotent). Skip when quiet hours active.
  IF NOT v_quiet
     AND app_private.notification_email_enabled(v_prefs, p_type) THEN
    v_category := app_private.notification_email_category(p_type);
    IF v_category IS NOT NULL THEN
      SELECT u.email
      INTO v_email
      FROM auth.users u
      WHERE u.id = v_member.user_id;

      IF v_email IS NOT NULL AND char_length(v_email) > 0 THEN
          INSERT INTO public.notification_email_outbox (
            workspace_id,
            notification_id,
            recipient_member_id,
            email_category,
            dedupe_key,
            to_email,
            subject,
            status
          )
          VALUES (
            p_workspace_id,
            v_notification_id,
            p_recipient_id,
            v_category,
            'email:' || left(p_dedupe_key, 190),
            v_email,
            left(p_title, 200),
            'pending'
          )
          ON CONFLICT (workspace_id, dedupe_key) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN v_notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.list_active_notification_recipients(
  p_workspace_id uuid,
  p_include_viewers boolean DEFAULT false
)
RETURNS TABLE (member_id uuid, role public.app_member_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.id, m.role
  FROM public.workspace_members m
  WHERE m.workspace_id = p_workspace_id
    AND m.status = 'active'
    AND (
      m.role IN ('owner', 'admin', 'agent')
      OR (p_include_viewers AND m.role = 'viewer')
    );
$$;

-- ---------------------------------------------------------------------------
-- Fan-out: new conversation / visitor message
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.notify_visitor_message_event(
  p_workspace_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_is_new_conversation boolean,
  p_preview text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assignee uuid;
  v_preview text;
  v_recipient record;
  v_type public.app_notification_type;
  v_dedupe text;
  v_title text;
  v_body text;
BEGIN
  SELECT c.assigned_to
  INTO v_assignee
  FROM public.conversations c
  WHERE c.id = p_conversation_id
    AND c.workspace_id = p_workspace_id;

  v_preview := left(COALESCE(NULLIF(trim(p_preview), ''), 'New visitor message'), 200);

  IF p_is_new_conversation THEN
    v_type := 'conversation_new';
    v_dedupe := 'conversation_new:' || p_conversation_id::text;
    v_title := 'New conversation';
    v_body := v_preview;

    FOR v_recipient IN
      SELECT * FROM app_private.list_active_notification_recipients(p_workspace_id, true)
    LOOP
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_recipient.member_id,
        v_type,
        v_dedupe || ':member:' || v_recipient.member_id::text,
        v_title,
        v_body,
        'conversation',
        p_conversation_id,
        p_conversation_id,
        NULL,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'message_id', p_message_id
        )
      );
    END LOOP;
  ELSE
    v_type := 'visitor_message';
    v_title := 'New visitor message';
    v_body := v_preview;

    IF v_assignee IS NOT NULL THEN
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_assignee,
        v_type,
        'visitor_message:' || p_message_id::text,
        v_title,
        v_body,
        'message',
        p_message_id,
        p_conversation_id,
        NULL,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'message_id', p_message_id
        )
      );
    ELSE
      -- Unassigned follow-ups: notify messaging roles (not viewers — noisy).
      FOR v_recipient IN
        SELECT * FROM app_private.list_active_notification_recipients(p_workspace_id, false)
      LOOP
        PERFORM app_private.emit_notification(
          p_workspace_id,
          v_recipient.member_id,
          v_type,
          'visitor_message:' || p_message_id::text || ':member:' || v_recipient.member_id::text,
          v_title,
          v_body,
          'message',
          p_message_id,
          p_conversation_id,
          NULL,
          jsonb_build_object(
            'v', 1,
            'conversation_id', p_conversation_id,
            'message_id', p_message_id
          )
        );
      END LOOP;
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Mentions: use emit_notification (safe body, durable dedupe)
-- ---------------------------------------------------------------------------

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

    IF v_mention_id IS NULL THEN
      CONTINUE;
    END IF;

    v_mentioned_label := app_private.member_display_label(v_member_id);

    -- NEVER include note body. Dedupe per mention row so remove→re-add notifies again.
    PERFORM app_private.emit_notification(
      p_workspace_id,
      v_member_id,
      'mention',
      'mention:' || v_mention_id::text,
      'You were mentioned in an internal note',
      left(coalesce(v_author_label, 'A teammate') || ' mentioned you', 1000),
      'internal_note',
      p_note_id,
      p_conversation_id,
      p_author_member_id,
      jsonb_build_object(
        'v', 1,
        'note_id', p_note_id,
        'mention_id', v_mention_id,
        'conversation_id', p_conversation_id,
        'actor_member_id', p_author_member_id,
        'actor_label', v_author_label
      )
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
        'internal_note:' || p_note_id::text || ':mention_row:' || v_mention_id::text
      );
    END IF;
  END LOOP;

  RETURN COALESCE(v_ids, ARRAY[]::uuid[]);
END;
$$;

-- ---------------------------------------------------------------------------
-- Assignment: notify assignee / previous assignee
-- ---------------------------------------------------------------------------

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
  v_previous_assignee uuid;
  v_last_read_sequence bigint;
  v_unread_count integer;
  v_has_read_row boolean := false;
  v_changed boolean := false;
  v_detail jsonb;
  v_actor_label text;
  v_was_transfer boolean := false;
BEGIN
  IF p_mode NOT IN ('take', 'assign', 'unassign') THEN
    RAISE EXCEPTION 'FORBIDDEN: Invalid assignment mode';
  END IF;

  PERFORM app_private.require_messaging_role(p_workspace_id);
  v_member_id := app_private.get_caller_member_id(p_workspace_id);

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

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

  v_previous_assignee := v_conversation.assigned_to;
  v_actor_label := app_private.member_display_label(v_member_id);

  IF p_mode = 'take' THEN
    IF v_conversation.assigned_to IS NULL THEN
      NULL;
    ELSIF v_conversation.assigned_to = v_member_id THEN
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
    IF p_assignee_member_id IS NULL THEN
      RAISE EXCEPTION 'MEMBER_NOT_FOUND: Assignee is required for assign';
    END IF;

    PERFORM app_private.assert_assignable_member(p_workspace_id, p_assignee_member_id);

    IF v_conversation.assigned_to IS NOT DISTINCT FROM p_assignee_member_id THEN
      NULL;
    ELSE
      v_was_transfer := v_conversation.assigned_to IS NOT NULL;
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

  IF v_changed THEN
    IF p_mode = 'unassign' AND v_previous_assignee IS NOT NULL
       AND v_previous_assignee IS DISTINCT FROM v_member_id THEN
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_previous_assignee,
        'conversation_unassigned',
        'conversation_unassigned:' || p_conversation_id::text
          || ':v' || v_conversation.assignment_version::text,
        'Conversation unassigned',
        left(coalesce(v_actor_label, 'A teammate') || ' unassigned a conversation', 1000),
        'conversation',
        p_conversation_id,
        p_conversation_id,
        v_member_id,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'assignment_version', v_conversation.assignment_version,
          'actor_member_id', v_member_id
        )
      );
    ELSIF p_mode IN ('take', 'assign')
          AND v_conversation.assigned_to IS NOT NULL
          AND v_conversation.assigned_to IS DISTINCT FROM v_member_id THEN
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_conversation.assigned_to,
        CASE WHEN v_was_transfer THEN 'conversation_transferred'::public.app_notification_type
             ELSE 'conversation_assigned'::public.app_notification_type END,
        'conversation_assigned:' || p_conversation_id::text
          || ':v' || v_conversation.assignment_version::text,
        CASE WHEN v_was_transfer THEN 'Conversation transferred to you'
             ELSE 'Conversation assigned to you' END,
        left(coalesce(v_actor_label, 'A teammate') || ' assigned you', 1000),
        'conversation',
        p_conversation_id,
        p_conversation_id,
        v_member_id,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'assignment_version', v_conversation.assignment_version,
          'actor_member_id', v_member_id,
          'was_transfer', v_was_transfer
        )
      );
    END IF;

    -- Notify previous assignee on transfer (not self).
    IF v_was_transfer
       AND v_previous_assignee IS NOT NULL
       AND v_previous_assignee IS DISTINCT FROM v_member_id
       AND v_previous_assignee IS DISTINCT FROM v_conversation.assigned_to THEN
      PERFORM app_private.emit_notification(
        p_workspace_id,
        v_previous_assignee,
        'conversation_transferred',
        'conversation_transferred_from:' || p_conversation_id::text
          || ':v' || v_conversation.assignment_version::text,
        'Conversation transferred',
        left(coalesce(v_actor_label, 'A teammate') || ' transferred a conversation', 1000),
        'conversation',
        p_conversation_id,
        p_conversation_id,
        v_member_id,
        jsonb_build_object(
          'v', 1,
          'conversation_id', p_conversation_id,
          'assignment_version', v_conversation.assignment_version,
          'actor_member_id', v_member_id
        )
      );
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
-- Visitor message emit (first message = conversation_new)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.widget_send_visitor_message(
  p_workspace_id uuid,
  p_session_token text,
  p_body text,
  p_client_message_id uuid DEFAULT NULL,
  p_page_url text DEFAULT NULL,
  p_referrer text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.visitor_sessions;
  v_body text;
  v_conversation public.conversations;
  v_existing public.messages;
  v_sequence bigint;
  v_message_id uuid;
  v_created_at timestamptz;
  v_page_url text;
  v_referrer text;
  v_is_new_conversation boolean := false;
BEGIN
  v_session := app_private.resolve_visitor_session(p_workspace_id, p_session_token);
  v_body := app_private.sanitize_message_body(p_body);
  v_page_url := app_private.sanitize_page_url(p_page_url);
  v_referrer := app_private.sanitize_page_url(p_referrer);

  UPDATE public.visitor_sessions vs
  SET
    expires_at = now() + interval '30 days',
    current_url = CASE
      WHEN vs.current_url IS NULL THEN v_page_url
      ELSE vs.current_url
    END,
    referrer = CASE
      WHEN vs.referrer IS NULL THEN v_referrer
      ELSE vs.referrer
    END,
    last_seen_at = now(),
    updated_at = now()
  WHERE vs.id = v_session.id
  RETURNING * INTO v_session;

  v_conversation := app_private.widget_get_or_create_conversation_for_send(
    p_workspace_id,
    v_session.id,
    v_session.locale,
    COALESCE(v_page_url, v_session.current_url, v_session.initial_url),
    COALESCE(v_referrer, v_session.referrer)
  );

  IF p_client_message_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.messages m
    WHERE m.conversation_id = v_conversation.id
      AND m.workspace_id = p_workspace_id
      AND m.client_message_id = p_client_message_id;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'message', jsonb_build_object(
          'id', v_existing.id,
          'sequence_number', v_existing.sequence_number,
          'sender_type', v_existing.sender_type,
          'body', v_existing.body,
          'created_at', v_existing.created_at,
          'client_message_id', v_existing.client_message_id
        ),
        'conversation_status', v_conversation.status
      );
    END IF;
  END IF;

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id
  FOR UPDATE;

  v_is_new_conversation := (v_conversation.message_count = 0);
  v_sequence := v_conversation.next_message_sequence;

  UPDATE public.conversations c
  SET
    next_message_sequence = c.next_message_sequence + 1,
    message_count = c.message_count + 1,
    last_message_at = now(),
    last_message_preview = left(v_body, 200),
    updated_at = now()
  WHERE c.id = v_conversation.id
    AND c.workspace_id = p_workspace_id;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body,
    is_internal,
    client_message_id
  )
  VALUES (
    p_workspace_id,
    v_conversation.id,
    v_sequence,
    'visitor',
    v_session.id,
    v_body,
    false,
    p_client_message_id
  )
  RETURNING id, created_at
  INTO v_message_id, v_created_at;

  PERFORM app_private.notify_visitor_message_event(
    p_workspace_id,
    v_conversation.id,
    v_message_id,
    v_is_new_conversation,
    v_body
  );

  SELECT *
  INTO v_conversation
  FROM public.conversations c
  WHERE c.id = v_conversation.id;

  RETURN jsonb_build_object(
    'message', jsonb_build_object(
      'id', v_message_id,
      'sequence_number', v_sequence,
      'sender_type', 'visitor',
      'body', v_body,
      'created_at', v_created_at,
      'client_message_id', p_client_message_id
    ),
    'conversation_status', v_conversation.status
  );
END;
$$;

COMMENT ON FUNCTION app_private.widget_send_visitor_message(
  uuid, text, text, uuid, text, text
) IS
  'Send a visitor message. Emits conversation_new or visitor_message '
  'notifications (idempotent via dedupe_key). page_url/referrer sanitized; '
  'session current_url/referrer only backfilled when NULL.';


-- ---------------------------------------------------------------------------
-- List / unread / mark-read RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.build_notification_item(
  p_row public.notifications
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'workspace_id', p_row.workspace_id,
    'recipient_id', p_row.recipient_id,
    'type', p_row.type,
    'title', p_row.title,
    'body', p_row.body,
    'resource_type', p_row.resource_type,
    'resource_id', p_row.resource_id,
    'conversation_id', p_row.conversation_id,
    'actor_member_id', p_row.actor_member_id,
    'payload', COALESCE(p_row.payload_json, '{}'::jsonb),
    'dedupe_key', p_row.dedupe_key,
    'read_at', p_row.read_at,
    'created_at', p_row.created_at
  );
$$;

CREATE OR REPLACE FUNCTION app_private.list_notifications(
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
  v_member_id uuid;
  v_limit integer;
  v_before_created timestamptz;
  v_before_id uuid;
  v_unread_only boolean := false;
  v_rows jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next jsonb := NULL;
  v_last jsonb;
  v_unread integer := 0;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: query must be an object';
  END IF;

  v_limit := COALESCE(NULLIF(p_query ->> 'limit', '')::integer, 20);
  IF v_limit < 1 THEN
    v_limit := 1;
  ELSIF v_limit > 50 THEN
    v_limit := 50;
  END IF;

  v_before_created := NULLIF(p_query ->> 'before_created_at', '')::timestamptz;
  v_before_id := NULLIF(p_query ->> 'before_id', '')::uuid;
  v_unread_only := COALESCE((p_query ->> 'unread_only')::boolean, false);

  IF (v_before_created IS NULL) <> (v_before_id IS NULL) THEN
    RAISE EXCEPTION 'INVALID_INPUT: before_created_at and before_id must be paired';
  END IF;

  SELECT COALESCE(
    (
      SELECT c.unread_count
      FROM public.notification_unread_counts c
      WHERE c.workspace_id = p_workspace_id
        AND c.member_id = v_member_id
    ),
    0
  )
  INTO v_unread;

  SELECT COALESCE(jsonb_agg(app_private.build_notification_item(q) ORDER BY q.created_at DESC, q.id DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT n.*
    FROM public.notifications n
    WHERE n.workspace_id = p_workspace_id
      AND n.recipient_id = v_member_id
      AND (NOT v_unread_only OR n.read_at IS NULL)
      AND (
        v_before_created IS NULL
        OR (n.created_at, n.id) < (v_before_created, v_before_id)
      )
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT v_limit + 1
  ) q;

  IF jsonb_array_length(v_rows) > v_limit THEN
    v_has_more := true;
    v_rows := (
      SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS t(elem, ord)
      WHERE ord <= v_limit
    );
  END IF;

  IF v_has_more AND jsonb_array_length(v_rows) > 0 THEN
    v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
    v_next := jsonb_build_object(
      'before_created_at', v_last ->> 'created_at',
      'before_id', v_last ->> 'id'
    );
  END IF;

  RETURN jsonb_build_object(
    'items', v_rows,
    'has_more', v_has_more,
    'next_cursor', v_next,
    'unread_count', v_unread
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_notifications(
  p_workspace_id uuid,
  p_query jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.list_notifications(p_workspace_id, p_query);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.get_notification_unread_count(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_unread integer := 0;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  SELECT COALESCE(c.unread_count, 0)
  INTO v_unread
  FROM public.notification_unread_counts c
  WHERE c.workspace_id = p_workspace_id
    AND c.member_id = v_member_id;

  RETURN jsonb_build_object('unread_count', COALESCE(v_unread, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_unread_count(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_notification_unread_count(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.mark_notification_read(
  p_workspace_id uuid,
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_row public.notifications;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  UPDATE public.notifications n
  SET read_at = now()
  WHERE n.id = p_notification_id
    AND n.workspace_id = p_workspace_id
    AND n.recipient_id = v_member_id
    AND n.read_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT *
    INTO v_row
    FROM public.notifications n
    WHERE n.id = p_notification_id
      AND n.workspace_id = p_workspace_id
      AND n.recipient_id = v_member_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOTIFICATION_NOT_FOUND: Notification not found';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'notification', app_private.build_notification_item(v_row),
    'unread_count', (
      SELECT COALESCE(c.unread_count, 0)
      FROM public.notification_unread_counts c
      WHERE c.workspace_id = p_workspace_id
        AND c.member_id = v_member_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_workspace_id uuid,
  p_notification_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.mark_notification_read(p_workspace_id, p_notification_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.mark_all_notifications_read(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_updated integer := 0;
  v_unread integer := 0;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  INSERT INTO public.notification_unread_counts (
    workspace_id, member_id, unread_count, updated_at
  )
  VALUES (p_workspace_id, v_member_id, 0, now())
  ON CONFLICT (workspace_id, member_id) DO NOTHING;

  PERFORM 1
  FROM public.notification_unread_counts c
  WHERE c.workspace_id = p_workspace_id
    AND c.member_id = v_member_id
  FOR UPDATE;

  UPDATE public.notifications n
  SET read_at = now()
  WHERE n.workspace_id = p_workspace_id
    AND n.recipient_id = v_member_id
    AND n.read_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE public.notification_unread_counts c
  SET
    unread_count = (
      SELECT COUNT(*)::integer
      FROM public.notifications n
      WHERE n.workspace_id = p_workspace_id
        AND n.recipient_id = v_member_id
        AND n.read_at IS NULL
    ),
    updated_at = now()
  WHERE c.workspace_id = p_workspace_id
    AND c.member_id = v_member_id
  RETURNING c.unread_count INTO v_unread;

  RETURN jsonb_build_object(
    'updated_count', v_updated,
    'unread_count', COALESCE(v_unread, 0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.mark_all_notifications_read(p_workspace_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Preferences RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.notification_preferences_to_json(
  p_row public.notification_preferences
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'workspace_id', p_row.workspace_id,
    'workspace_member_id', p_row.workspace_member_id,
    'in_app_conversation_new', p_row.in_app_conversation_new,
    'in_app_visitor_message', p_row.in_app_visitor_message,
    'in_app_assignment', p_row.in_app_assignment,
    'in_app_mention', p_row.in_app_mention,
    'in_app_transfer', p_row.in_app_transfer,
    'browser_enabled', p_row.browser_enabled,
    'browser_conversation_new', p_row.browser_conversation_new,
    'browser_visitor_message', p_row.browser_visitor_message,
    'browser_assignment', p_row.browser_assignment,
    'browser_mention', p_row.browser_mention,
    'browser_permission_denied_at', p_row.browser_permission_denied_at,
    'sound_enabled', p_row.sound_enabled,
    'sound_visitor_message', p_row.sound_visitor_message,
    'sound_assignment', p_row.sound_assignment,
    'email_conversation_new', p_row.email_conversation_new,
    'email_assignment', p_row.email_assignment,
    'email_mention', p_row.email_mention,
    'email_visitor_message', p_row.email_visitor_message,
    'dnd_enabled', p_row.dnd_enabled,
    'quiet_hours_start', p_row.quiet_hours_start,
    'quiet_hours_end', p_row.quiet_hours_end,
    'timezone', p_row.timezone,
    'updated_at', p_row.updated_at
  );
$$;

CREATE OR REPLACE FUNCTION app_private.get_notification_preferences(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_row public.notification_preferences;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  v_row := app_private.get_or_init_notification_preferences(p_workspace_id, v_member_id);
  RETURN app_private.notification_preferences_to_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_notification_preferences(
  p_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.get_notification_preferences(p_workspace_id);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.update_notification_preferences(
  p_workspace_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_row public.notification_preferences;
  v_tz text;
BEGIN
  IF NOT app_private.workspace_is_accessible(p_workspace_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: Workspace not accessible';
  END IF;

  v_member_id := app_private.get_caller_member_id(p_workspace_id);
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: Not a workspace member';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_INPUT: patch must be an object';
  END IF;

  v_row := app_private.get_or_init_notification_preferences(p_workspace_id, v_member_id);

  v_tz := COALESCE(NULLIF(p_patch ->> 'timezone', ''), v_row.timezone);
  IF char_length(v_tz) < 1 OR char_length(v_tz) > 64 THEN
    RAISE EXCEPTION 'INVALID_INPUT: timezone must be 1–64 characters';
  END IF;

  UPDATE public.notification_preferences p
  SET
    in_app_conversation_new = COALESCE((p_patch ->> 'in_app_conversation_new')::boolean, p.in_app_conversation_new),
    in_app_visitor_message = COALESCE((p_patch ->> 'in_app_visitor_message')::boolean, p.in_app_visitor_message),
    in_app_assignment = COALESCE((p_patch ->> 'in_app_assignment')::boolean, p.in_app_assignment),
    in_app_mention = COALESCE((p_patch ->> 'in_app_mention')::boolean, p.in_app_mention),
    in_app_transfer = COALESCE((p_patch ->> 'in_app_transfer')::boolean, p.in_app_transfer),
    browser_enabled = COALESCE((p_patch ->> 'browser_enabled')::boolean, p.browser_enabled),
    browser_conversation_new = COALESCE((p_patch ->> 'browser_conversation_new')::boolean, p.browser_conversation_new),
    browser_visitor_message = COALESCE((p_patch ->> 'browser_visitor_message')::boolean, p.browser_visitor_message),
    browser_assignment = COALESCE((p_patch ->> 'browser_assignment')::boolean, p.browser_assignment),
    browser_mention = COALESCE((p_patch ->> 'browser_mention')::boolean, p.browser_mention),
    browser_permission_denied_at = CASE
      WHEN p_patch ? 'browser_permission_denied_at' THEN
        NULLIF(p_patch ->> 'browser_permission_denied_at', '')::timestamptz
      ELSE p.browser_permission_denied_at
    END,
    sound_enabled = COALESCE((p_patch ->> 'sound_enabled')::boolean, p.sound_enabled),
    sound_visitor_message = COALESCE((p_patch ->> 'sound_visitor_message')::boolean, p.sound_visitor_message),
    sound_assignment = COALESCE((p_patch ->> 'sound_assignment')::boolean, p.sound_assignment),
    email_conversation_new = COALESCE((p_patch ->> 'email_conversation_new')::boolean, p.email_conversation_new),
    email_assignment = COALESCE((p_patch ->> 'email_assignment')::boolean, p.email_assignment),
    email_mention = COALESCE((p_patch ->> 'email_mention')::boolean, p.email_mention),
    email_visitor_message = COALESCE((p_patch ->> 'email_visitor_message')::boolean, p.email_visitor_message),
    dnd_enabled = COALESCE((p_patch ->> 'dnd_enabled')::boolean, p.dnd_enabled),
    quiet_hours_start = CASE
      WHEN p_patch ? 'quiet_hours_start' THEN NULLIF(p_patch ->> 'quiet_hours_start', '')::time
      ELSE p.quiet_hours_start
    END,
    quiet_hours_end = CASE
      WHEN p_patch ? 'quiet_hours_end' THEN NULLIF(p_patch ->> 'quiet_hours_end', '')::time
      ELSE p.quiet_hours_end
    END,
    timezone = v_tz,
    updated_at = now()
  WHERE p.id = v_row.id
  RETURNING * INTO v_row;

  RETURN app_private.notification_preferences_to_json(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_notification_preferences(
  p_workspace_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.update_notification_preferences(p_workspace_id, p_patch);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants / revokes (search_path locked; authenticated only on public RPCs)
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION app_private.emit_notification(
  uuid, uuid, public.app_notification_type, text, text, text, text, uuid, uuid, uuid, jsonb, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.emit_notification(
  uuid, uuid, public.app_notification_type, text, text, text, text, uuid, uuid, uuid, jsonb, boolean
) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.notify_visitor_message_event(uuid, uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.notify_visitor_message_event(uuid, uuid, uuid, boolean, text) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.adjust_notification_unread_count(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.adjust_notification_unread_count(uuid, uuid, integer) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.get_or_init_notification_preferences(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.get_or_init_notification_preferences(uuid, uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.list_notifications(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.list_notifications(uuid, jsonb) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.mark_notification_read(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.mark_notification_read(uuid, uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.mark_all_notifications_read(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.mark_all_notifications_read(uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.get_notification_unread_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.get_notification_unread_count(uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.get_notification_preferences(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.get_notification_preferences(uuid) FROM anon, authenticated;

REVOKE ALL ON FUNCTION app_private.update_notification_preferences(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.update_notification_preferences(uuid, jsonb) FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.list_notifications(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_notifications(uuid, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.get_notification_unread_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_unread_count(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_notification_read(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_notification_preferences(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_notification_preferences(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.update_notification_preferences(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_notification_preferences(uuid, jsonb) TO authenticated;

-- Blanket app_private EXECUTE lockdown (repository policy). Hardening migration
-- re-asserts this after adding claim helpers.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;

-- Keep notifications SELECT-only for authenticated (writes via SECURITY DEFINER).
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notifications FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notification_preferences FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.notification_unread_counts FROM authenticated;

COMMENT ON TABLE public.notifications IS
  'Durable in-app notifications. Recipient-only RLS. Writes via emit helpers. DND does not omit rows.';
COMMENT ON TABLE public.notification_preferences IS
  'Per-member preferences. No workspace-level overwrite of personal choices.';
COMMENT ON TABLE public.notification_email_outbox IS
  'Idempotent email outbox. Service-role / definer processors only.';

