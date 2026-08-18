-- Operator notifications hardening (PR #35 merge blockers)
-- 1) DND suppresses side effects only — durable in-app history still persists
-- 2) mark_all locks counter + reconciles to authoritative unread COUNT
-- 3) Email outbox: pending → sending (claim) → sent|failed|skipped
-- 4) Blanket app_private EXECUTE lockdown + intentional re-grants

-- ---------------------------------------------------------------------------
-- Quiet hours: equal start/end ≡ always quiet (explicit product rule)
-- ---------------------------------------------------------------------------

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

  -- No window OR degenerate equal bounds → always quiet while DND is on.
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

  -- Overnight window (e.g. 22:00 → 07:00).
  RETURN v_local_time >= v_start OR v_local_time < v_end;
END;
$$;

-- ---------------------------------------------------------------------------
-- emit_notification: persist durable row when in-app enabled; DND ≠ drop
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
  v_in_app boolean;
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

  IF p_type = 'mention' AND v_member.role = 'viewer' THEN
    RETURN NULL;
  END IF;

  v_prefs := app_private.get_or_init_notification_preferences(
    p_workspace_id,
    p_recipient_id
  );

  -- Quiet/DND suppresses email/browser/sound only — never durable history.
  v_quiet := app_private.notification_in_quiet_hours(v_prefs);
  v_in_app := p_force_in_app
    OR app_private.notification_in_app_enabled(v_prefs, p_type);

  IF v_in_app THEN
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

    -- Conflict path: resolve existing id so email can still reference it.
    IF v_notification_id IS NULL THEN
      SELECT n.id
      INTO v_notification_id
      FROM public.notifications n
      WHERE n.workspace_id = p_workspace_id
        AND n.recipient_id = p_recipient_id
        AND n.dedupe_key = left(p_dedupe_key, 200);
    END IF;
  END IF;

  -- Email outbox only when not quiet and email preference enabled.
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

COMMENT ON FUNCTION app_private.emit_notification(
  uuid, uuid, public.app_notification_type, text, text, text, text, uuid, uuid, uuid, jsonb, boolean
) IS
  'Persist durable in-app when in_app_* enabled. DND/quiet only suppresses email (and client browser/sound).';

-- ---------------------------------------------------------------------------
-- mark_all: lock counter, mark unread, reconcile to COUNT(*)
-- ---------------------------------------------------------------------------

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

  -- Ensure counter row exists, then lock it so concurrent emit blocks here.
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

  -- Authoritative reconcile (triggers may have decremented during UPDATE).
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

-- ---------------------------------------------------------------------------
-- Email outbox state machine: pending → sending → sent|failed|skipped
-- ---------------------------------------------------------------------------

ALTER TABLE public.notification_email_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS provider_message_id text;

ALTER TABLE public.notification_email_outbox
  DROP CONSTRAINT IF EXISTS chk_notification_email_outbox_status;

ALTER TABLE public.notification_email_outbox
  ADD CONSTRAINT chk_notification_email_outbox_status CHECK (
    status IN ('pending', 'sending', 'sent', 'skipped', 'failed')
  );

DROP INDEX IF EXISTS idx_notification_email_outbox_pending;

CREATE INDEX idx_notification_email_outbox_claimable
  ON public.notification_email_outbox (status, next_attempt_at, created_at ASC)
  WHERE status IN ('pending', 'failed');

CREATE INDEX idx_notification_email_outbox_sending
  ON public.notification_email_outbox (status, claimed_at ASC)
  WHERE status = 'sending';

COMMENT ON TABLE public.notification_email_outbox IS
  'Email outbox state machine: pending→sending→sent|failed|skipped. Claim before provider call. Stale sending recovered after 15m.';

-- Recover rows stuck in sending (crash after claim, before finalize).
CREATE OR REPLACE FUNCTION app_private.recover_stale_notification_email_outbox(
  p_stale_after interval DEFAULT interval '15 minutes'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.notification_email_outbox
  SET
    status = 'pending',
    last_error = left(
      COALESCE(last_error || '; ', '') || 'stale sending recovered',
      500
    ),
    next_attempt_at = now(),
    updated_at = now()
  WHERE status = 'sending'
    AND claimed_at IS NOT NULL
    AND claimed_at < now() - p_stale_after;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.claim_notification_email_outbox(
  p_limit integer DEFAULT 25
)
RETURNS SETOF public.notification_email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 25), 100));
BEGIN
  -- Opportunistic stale recovery (bounded).
  PERFORM app_private.recover_stale_notification_email_outbox();

  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.notification_email_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.next_attempt_at <= now()
      AND o.attempts < 10
    ORDER BY o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  )
  UPDATE public.notification_email_outbox o
  SET
    status = 'sending',
    claimed_at = now(),
    attempts = o.attempts + 1,
    updated_at = now()
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.finalize_notification_email_outbox(
  p_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_retry_after interval DEFAULT interval '2 minutes'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  IF p_status NOT IN ('sent', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', p_status;
  END IF;

  IF p_status = 'sent' THEN
    UPDATE public.notification_email_outbox
    SET
      status = 'sent',
      sent_at = now(),
      last_error = NULL,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      updated_at = now()
    WHERE id = p_id
      AND status = 'sending'
    RETURNING true INTO v_ok;
  ELSIF p_status = 'skipped' THEN
    UPDATE public.notification_email_outbox
    SET
      status = 'skipped',
      last_error = left(COALESCE(p_last_error, 'skipped'), 500),
      updated_at = now()
    WHERE id = p_id
      AND status = 'sending'
    RETURNING true INTO v_ok;
  ELSE
    -- failed → retryable pending with backoff (unless attempts exhausted at claim).
    UPDATE public.notification_email_outbox
    SET
      status = 'failed',
      last_error = left(COALESCE(p_last_error, 'send failed'), 500),
      next_attempt_at = now() + p_retry_after,
      updated_at = now()
    WHERE id = p_id
      AND status = 'sending'
    RETURNING true INTO v_ok;
  END IF;

  RETURN COALESCE(v_ok, false);
END;
$$;

-- Service-role wrappers (PostgREST / processors). Not for authenticated clients.
CREATE OR REPLACE FUNCTION public.claim_notification_email_outbox(
  p_limit integer DEFAULT 25
)
RETURNS SETOF public.notification_email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY SELECT * FROM app_private.claim_notification_email_outbox(p_limit);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_notification_email_outbox(
  p_id uuid,
  p_status text,
  p_last_error text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN app_private.finalize_notification_email_outbox(
    p_id,
    p_status,
    p_last_error,
    p_provider_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_email_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_email_outbox(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notification_email_outbox(integer) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_notification_email_outbox(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_notification_email_outbox(uuid, text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_notification_email_outbox(uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- Blanket app_private EXECUTE lockdown (repository policy)
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_private FROM authenticated;

-- Intentional RLS / helper functions callable by authenticated clients.
GRANT EXECUTE ON FUNCTION app_private.user_workspace_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.user_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.workspace_is_accessible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.get_caller_member_id(uuid) TO authenticated;
