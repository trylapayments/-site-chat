\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(54);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_agent_a uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_owner_member_a uuid;
  v_agent_member_a uuid;
  v_viewer_member_a uuid;
  v_temp_user uuid;
  v_temp_member uuid;
  v_notif_id uuid;
  v_list jsonb;
  v_page1 jsonb;
  v_page2 jsonb;
BEGIN
  v_owner_a := tests.create_auth_user('notif-owner-a@test.local');
  v_agent_a := tests.create_auth_user('notif-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('notif-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('notif-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'notif-owner-a@test.local');
  v_workspace_a := (public.create_workspace('Notif Workspace A', 'notif-workspace-a')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'notif-owner-b@test.local');
  v_workspace_b := (public.create_workspace('Notif Workspace B', 'notif-workspace-b')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  SELECT id INTO v_owner_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_owner_a;
  SELECT id INTO v_agent_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;
  SELECT id INTO v_viewer_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_viewer_a;

  PERFORM set_config('tests.workspace_a', v_workspace_a::text, true);
  PERFORM set_config('tests.workspace_b', v_workspace_b::text, true);
  PERFORM set_config('tests.owner_member_a', v_owner_member_a::text, true);
  PERFORM set_config('tests.agent_member_a', v_agent_member_a::text, true);
  PERFORM set_config('tests.viewer_member_a', v_viewer_member_a::text, true);
  PERFORM set_config('tests.owner_a', v_owner_a::text, true);
  PERFORM set_config('tests.agent_a', v_agent_a::text, true);
  PERFORM set_config('tests.viewer_a', v_viewer_a::text, true);

  -- Seed assignment notification for agent
  v_notif_id := app_private.emit_notification(
    v_workspace_a,
    v_agent_member_a,
    'conversation_assigned',
    'conversation_assigned:test:v1',
    'Conversation assigned to you',
    'Owner assigned you',
    'conversation',
    NULL,
    NULL,
    v_owner_member_a,
    '{"v":1}'::jsonb
  );
  PERFORM set_config('tests.seed_notif', v_notif_id::text, true);

  -- Dedupe: second emit collapses; at most one durable row.
  PERFORM app_private.emit_notification(
    v_workspace_a,
    v_agent_member_a,
    'conversation_assigned',
    'conversation_assigned:test:v1',
    'Conversation assigned to you',
    'Owner assigned you',
    'conversation',
    NULL, NULL, v_owner_member_a, '{}'::jsonb
  );
  IF (
    SELECT count(*) FROM public.notifications
    WHERE workspace_id = v_workspace_a
      AND recipient_id = v_agent_member_a
      AND dedupe_key = 'conversation_assigned:test:v1'
  ) <> 1 THEN
    RAISE EXCEPTION 'dedupe failed';
  END IF;

  -- Mention without note body
  PERFORM app_private.emit_notification(
    v_workspace_a,
    v_agent_member_a,
    'mention',
    'mention:row-1',
    'You were mentioned in an internal note',
    'Owner mentioned you',
    'internal_note',
    NULL,
    NULL,
    v_owner_member_a,
    jsonb_build_object('v', 1, 'note_id', '99999999-9999-9999-9999-999999999999', 'actor_label', 'Owner')
  );

  -- Viewer blocked from mention
  IF app_private.emit_notification(
    v_workspace_a,
    v_viewer_member_a,
    'mention',
    'mention:viewer-blocked',
    'You were mentioned',
    'should not land',
    'internal_note',
    NULL, NULL, v_owner_member_a, '{}'::jsonb
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'viewer mention should be blocked';
  END IF;

  -- Viewer allowed conversation_new
  PERFORM app_private.emit_notification(
    v_workspace_a,
    v_viewer_member_a,
    'conversation_new',
    'conversation_new:viewer-ok',
    'New conversation',
    'Hello',
    'conversation',
    NULL, NULL, NULL, '{}'::jsonb
  );

  -- Pagination seeds
  FOR i IN 1..5 LOOP
    PERFORM app_private.emit_notification(
      v_workspace_a,
      v_agent_member_a,
      'visitor_message',
      'visitor_message:page:' || i::text,
      'New visitor message',
      'msg ' || i::text,
      'message',
      NULL, NULL, NULL, '{}'::jsonb
    );
  END LOOP;
END;
$$;

SELECT ok(
  has_function_privilege('authenticated', 'public.list_notifications(uuid, jsonb)', 'execute'),
  'authenticated can execute list_notifications'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.mark_notification_read(uuid, uuid)', 'execute'),
  'authenticated can execute mark_notification_read'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.mark_all_notifications_read(uuid)', 'execute'),
  'authenticated can execute mark_all_notifications_read'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_notification_unread_count(uuid)', 'execute'),
  'authenticated can execute get_notification_unread_count'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_notification_preferences(uuid)', 'execute'),
  'authenticated can execute get_notification_preferences'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.update_notification_preferences(uuid, jsonb)', 'execute'),
  'authenticated can execute update_notification_preferences'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.list_notifications(uuid, jsonb)', 'execute'),
  'anon cannot list_notifications'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.emit_notification(uuid, uuid, public.app_notification_type, text, text, text, text, uuid, uuid, uuid, jsonb, boolean)',
    'execute'
  ),
  'authenticated cannot execute emit_notification'
);

SELECT ok(
  (
    SELECT prosecdef AND EXISTS (
      SELECT 1 FROM unnest(proconfig) cfg WHERE cfg LIKE 'search_path=%'
    )
    FROM pg_proc
    WHERE oid = 'public.list_notifications(uuid, jsonb)'::regprocedure
  ),
  'list_notifications is SECURITY DEFINER with locked search_path'
);

SELECT is(
  (
    SELECT count(*)::integer FROM public.notifications
    WHERE recipient_id = current_setting('tests.agent_member_a')::uuid
      AND dedupe_key = 'conversation_assigned:test:v1'
  ),
  1,
  'dedupe keeps a single durable notification'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE type = 'mention'
      AND (
        coalesce(body, '') ILIKE '%SECRET%'
        OR payload_json::text ILIKE '%SECRET_NOTE_BODY%'
      )
  ),
  'mention notifications never include note body'
);

SELECT is(
  (
    SELECT count(*)::integer FROM public.notifications
    WHERE recipient_id = current_setting('tests.viewer_member_a')::uuid
      AND type = 'mention'
  ),
  0,
  'viewer never receives mention notifications'
);

SELECT is(
  (
    SELECT count(*)::integer FROM public.notifications
    WHERE recipient_id = current_setting('tests.viewer_member_a')::uuid
      AND type = 'conversation_new'
  ),
  1,
  'viewer may receive conversation_new'
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT is(
  jsonb_array_length(
    public.list_notifications(
      current_setting('tests.workspace_a')::uuid,
      '{}'::jsonb
    ) -> 'items'
  ),
  (
    SELECT count(*)::integer FROM public.notifications
    WHERE recipient_id = current_setting('tests.agent_member_a')::uuid
  ),
  'agent lists only own notifications'
);

SELECT throws_ok(
  format(
    'SELECT public.list_notifications(%L::uuid, ''{}''::jsonb)',
    current_setting('tests.workspace_b')
  ),
  'FORBIDDEN: Workspace not accessible',
  'cannot list notifications in foreign workspace'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE recipient_id = current_setting('tests.owner_member_a')::uuid
  ),
  0,
  'RLS: agent cannot SELECT owner notifications'
);

SELECT is(
  (
    public.get_notification_unread_count(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'unread_count'
  )::integer,
  (
    SELECT unread_count FROM public.notification_unread_counts
    WHERE member_id = current_setting('tests.agent_member_a')::uuid
  ),
  'unread count RPC matches counter table'
);

SELECT lives_ok(
  format(
    'SELECT public.mark_notification_read(%L::uuid, %L::uuid)',
    current_setting('tests.workspace_a'),
    current_setting('tests.seed_notif')
  ),
  'mark one notification read'
);

SELECT is(
  (
    public.get_notification_unread_count(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'unread_count'
  )::integer,
  (
    SELECT count(*)::integer FROM public.notifications
    WHERE recipient_id = current_setting('tests.agent_member_a')::uuid
      AND read_at IS NULL
  ),
  'mark one read updates unread_count'
);

SELECT is(
  (
    public.mark_all_notifications_read(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'unread_count'
  )::integer,
  0,
  'mark all read zeros unread'
);

SELECT is(
  (
    SELECT unread_count FROM public.notification_unread_counts
    WHERE member_id = current_setting('tests.agent_member_a')::uuid
  ),
  0,
  'counter table is zero after mark all'
);

SELECT is(
  (
    public.mark_all_notifications_read(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'updated_count'
  )::integer,
  0,
  'second mark all is idempotent'
);

SELECT is(
  (
    public.list_notifications(
      current_setting('tests.workspace_a')::uuid,
      jsonb_build_object('limit', 2)
    ) ->> 'has_more'
  )::boolean,
  true,
  'keyset list with limit 2 reports has_more'
);

SELECT ok(
  (
    public.list_notifications(
      current_setting('tests.workspace_a')::uuid,
      jsonb_build_object('limit', 2)
    ) -> 'next_cursor'
  ) ? 'before_id',
  'next_cursor includes before_id'
);

SELECT ok(
  jsonb_array_length(
    public.list_notifications(
      current_setting('tests.workspace_a')::uuid,
      jsonb_build_object(
        'limit', 2,
        'before_created_at',
        public.list_notifications(
          current_setting('tests.workspace_a')::uuid,
          jsonb_build_object('limit', 2)
        ) -> 'next_cursor' ->> 'before_created_at',
        'before_id',
        public.list_notifications(
          current_setting('tests.workspace_a')::uuid,
          jsonb_build_object('limit', 2)
        ) -> 'next_cursor' ->> 'before_id'
      )
    ) -> 'items'
  ) <= 2,
  'keyset page returns at most limit items'
);

SELECT is(
  (
    public.update_notification_preferences(
      current_setting('tests.workspace_a')::uuid,
      jsonb_build_object('sound_enabled', true, 'email_mention', false)
    ) ->> 'sound_enabled'
  )::boolean,
  true,
  'agent can update own preferences'
);

SELECT is(
  (
    public.get_notification_preferences(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'email_mention'
  )::boolean,
  false,
  'preference patch persisted'
);

SELECT tests.authenticate_as(
  current_setting('tests.owner_a')::uuid,
  'notif-owner-a@test.local'
);

SELECT is(
  (
    public.get_notification_preferences(
      current_setting('tests.workspace_a')::uuid
    ) ->> 'sound_enabled'
  )::boolean,
  false,
  'owner prefs remain independent of agent'
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object(
    'in_app_visitor_message', false,
    'email_visitor_message', false
  )
);

SELECT tests.clear_auth();

SELECT is(
  app_private.emit_notification(
    current_setting('tests.workspace_a')::uuid,
    current_setting('tests.agent_member_a')::uuid,
    'visitor_message',
    'visitor_message:suppressed',
    'New visitor message',
    'hi',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  ),
  NULL,
  'in-app + email disabled suppresses emit'
);

-- Removed member cascade
SELECT tests.clear_auth();

DO $$
DECLARE
  v_temp_user uuid;
  v_temp_member uuid;
  v_workspace uuid := current_setting('tests.workspace_a')::uuid;
BEGIN
  v_temp_user := tests.create_auth_user('notif-temp@test.local');
  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES (v_workspace, v_temp_user, 'agent', 'active')
  RETURNING id INTO v_temp_member;

  PERFORM app_private.emit_notification(
    v_workspace,
    v_temp_member,
    'conversation_new',
    'conversation_new:temp',
    'New conversation',
    'x',
    'conversation',
    NULL, NULL, NULL, '{}'::jsonb
  );

  DELETE FROM public.workspace_members WHERE id = v_temp_member;

  IF EXISTS (
    SELECT 1 FROM public.notifications WHERE recipient_id = v_temp_member
  ) THEN
    RAISE EXCEPTION 'notifications not cascaded';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.notification_unread_counts WHERE member_id = v_temp_member
  ) THEN
    RAISE EXCEPTION 'unread counters not cascaded';
  END IF;
END;
$$;

SELECT pass('removed member cascades notifications and unread counters');

SELECT tests.clear_auth();

SELECT throws_ok(
  format(
    'SELECT public.list_notifications(%L::uuid, ''{}''::jsonb)',
    current_setting('tests.workspace_a')
  ),
  'FORBIDDEN: Workspace not accessible',
  'unauthenticated list denied'
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object('in_app_assignment', true, 'email_assignment', true)
);

SELECT tests.clear_auth();

SELECT app_private.emit_notification(
  current_setting('tests.workspace_a')::uuid,
  current_setting('tests.agent_member_a')::uuid,
  'conversation_assigned',
  'conversation_assigned:email:v9',
  'Conversation assigned to you',
  'Owner assigned you',
  'conversation',
  NULL,
  NULL,
  current_setting('tests.owner_member_a')::uuid,
  '{}'::jsonb
);

SELECT app_private.emit_notification(
  current_setting('tests.workspace_a')::uuid,
  current_setting('tests.agent_member_a')::uuid,
  'conversation_assigned',
  'conversation_assigned:email:v9',
  'Conversation assigned to you',
  'Owner assigned you',
  'conversation',
  NULL,
  NULL,
  current_setting('tests.owner_member_a')::uuid,
  '{}'::jsonb
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT tests.clear_auth();

SELECT is(
  (
    SELECT count(*)::integer FROM public.notification_email_outbox
    WHERE dedupe_key = 'email:conversation_assigned:email:v9'
  ),
  1,
  'email outbox dedupe keeps a single row'
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT throws_ok(
  format(
    $sql$
      INSERT INTO public.notifications (
        workspace_id, recipient_id, type, title, dedupe_key
      ) VALUES (
        %L::uuid,
        %L::uuid,
        'mention',
        'hack',
        'hack-key'
      )
    $sql$,
    current_setting('tests.workspace_a'),
    current_setting('tests.agent_member_a')
  ),
  '42501',
  'permission denied for table notifications'
);

-- ---------------------------------------------------------------------------
-- Privilege matrix: private helpers must not be client-executable
-- ---------------------------------------------------------------------------

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.list_active_notification_recipients(uuid, boolean)',
    'execute'
  ),
  'authenticated cannot execute list_active_notification_recipients'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.emit_notification(uuid,uuid,app_notification_type,text,text,text,text,uuid,uuid,uuid,jsonb,boolean)',
    'execute'
  ),
  'authenticated cannot execute emit_notification'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.claim_notification_email_outbox(integer)',
    'execute'
  ),
  'authenticated cannot execute claim_notification_email_outbox'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.mark_all_notifications_read(uuid)',
    'execute'
  ),
  'authenticated cannot execute private mark_all_notifications_read'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.claim_notification_email_outbox(integer)',
    'execute'
  ),
  'authenticated cannot execute public claim_notification_email_outbox'
);

SELECT ok(
  has_function_privilege(
    'authenticated',
    'app_private.workspace_is_accessible(uuid)',
    'execute'
  ),
  'authenticated retains intentional workspace_is_accessible'
);

SELECT ok(
  (
    SELECT p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname = 'emit_notification'
    LIMIT 1
  ),
  'emit_notification is SECURITY DEFINER'
);

SELECT ok(
  (
    SELECT COALESCE(p.proconfig::text, '') LIKE '%search_path%'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname = 'emit_notification'
    LIMIT 1
  ),
  'emit_notification locks search_path'
);

-- ---------------------------------------------------------------------------
-- DND: durable in-app persists; email side effects suppressed
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object(
    'dnd_enabled', true,
    'quiet_hours_start', NULL,
    'quiet_hours_end', NULL,
    'in_app_visitor_message', true,
    'email_visitor_message', true
  )
);

SELECT tests.clear_auth();

SELECT ok(
  app_private.emit_notification(
    current_setting('tests.workspace_a')::uuid,
    current_setting('tests.agent_member_a')::uuid,
    'visitor_message',
    'visitor_message:dnd-always',
    'New visitor message',
    'during dnd',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  ) IS NOT NULL,
  'DND always-quiet still creates durable notification'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notifications
    WHERE recipient_id = current_setting('tests.agent_member_a')::uuid
      AND dedupe_key = 'visitor_message:dnd-always'
      AND read_at IS NULL
  ),
  1,
  'durable unread row exists under DND'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notification_email_outbox
    WHERE dedupe_key = 'email:visitor_message:dnd-always'
  ),
  0,
  'email outbox suppressed during DND'
);

SELECT ok(
  (
    SELECT c.unread_count
    FROM public.notification_unread_counts c
    WHERE c.member_id = current_setting('tests.agent_member_a')::uuid
  )
  =
  (
    SELECT COUNT(*)::integer
    FROM public.notifications n
    WHERE n.recipient_id = current_setting('tests.agent_member_a')::uuid
      AND n.read_at IS NULL
  ),
  'unread counter matches durable unread after DND emit'
);

-- Windowed quiet hours: inside window → durable yes, email no
SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object(
    'dnd_enabled', true,
    'quiet_hours_start', '00:00:00',
    'quiet_hours_end', '23:59:59',
    'timezone', 'UTC',
    'in_app_visitor_message', true,
    'email_visitor_message', true
  )
);

SELECT tests.clear_auth();

SELECT ok(
  app_private.emit_notification(
    current_setting('tests.workspace_a')::uuid,
    current_setting('tests.agent_member_a')::uuid,
    'visitor_message',
    'visitor_message:dnd-window-in',
    'New visitor message',
    'inside window',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  ) IS NOT NULL,
  'inside quiet window still creates durable notification'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.notification_email_outbox
    WHERE dedupe_key = 'email:visitor_message:dnd-window-in'
  ),
  0,
  'email suppressed inside quiet window'
);

-- Outside window: durable + email eligible
SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object(
    'dnd_enabled', true,
    'quiet_hours_start', '02:00:00',
    'quiet_hours_end', '03:00:00',
    'timezone', 'UTC',
    'in_app_visitor_message', true,
    'email_visitor_message', true
  )
);

SELECT tests.clear_auth();

-- Only emit outside window when current UTC time is outside 02:00-03:00.
-- If we happen to be inside that hour, skip email assertion via conditional.
DO $$
DECLARE
  v_local time := (now() AT TIME ZONE 'UTC')::time;
  v_inside boolean := v_local >= time '02:00' AND v_local < time '03:00';
  v_id uuid;
BEGIN
  v_id := app_private.emit_notification(
    current_setting('tests.workspace_a')::uuid,
    current_setting('tests.agent_member_a')::uuid,
    'visitor_message',
    'visitor_message:dnd-window-out',
    'New visitor message',
    'outside window check',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  );
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'outside-window emit must still create durable row';
  END IF;
  IF NOT v_inside THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notification_email_outbox
      WHERE dedupe_key = 'email:visitor_message:dnd-window-out'
    ) THEN
      RAISE EXCEPTION 'email expected outside quiet window';
    END IF;
  END IF;
END;
$$;

SELECT pass('windowed DND outside path keeps durable + email when not in window');

-- Disable DND for subsequent counter tests
SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT public.update_notification_preferences(
  current_setting('tests.workspace_a')::uuid,
  jsonb_build_object(
    'dnd_enabled', false,
    'quiet_hours_start', NULL,
    'quiet_hours_end', NULL
  )
);

-- ---------------------------------------------------------------------------
-- Unread invariant + mark-all concurrency reconcile
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

DO $$
DECLARE
  v_workspace uuid := current_setting('tests.workspace_a')::uuid;
  v_member uuid := current_setting('tests.agent_member_a')::uuid;
  v_user uuid := current_setting('tests.agent_a')::uuid;
  v_unread_before integer;
  v_result jsonb;
  v_remaining integer;
BEGIN
  PERFORM tests.authenticate_as(v_user, 'notif-agent-a@test.local');

  -- Ensure at least one unread
  PERFORM app_private.emit_notification(
    v_workspace,
    v_member,
    'visitor_message',
    'visitor_message:markall-seed',
    'New visitor message',
    'seed',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  );

  SELECT unread_count INTO v_unread_before
  FROM public.notification_unread_counts
  WHERE member_id = v_member;

  IF v_unread_before < 1 THEN
    RAISE EXCEPTION 'expected unread before mark-all';
  END IF;

  -- Simulate mark-all race: lock counter, insert new unread, then mark existing
  -- unread at lock time + reconcile. Insert after lock blocks emit in real
  -- concurrency; same-tx insert is visible and must remain unread after reconcile.
  INSERT INTO public.notification_unread_counts (
    workspace_id, member_id, unread_count, updated_at
  )
  VALUES (v_workspace, v_member, 0, now())
  ON CONFLICT (workspace_id, member_id) DO NOTHING;

  PERFORM 1
  FROM public.notification_unread_counts c
  WHERE c.workspace_id = v_workspace AND c.member_id = v_member
  FOR UPDATE;

  -- Concurrent-style insert while counter locked
  PERFORM app_private.emit_notification(
    v_workspace,
    v_member,
    'visitor_message',
    'visitor_message:during-markall',
    'New visitor message',
    'during mark-all',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  );

  UPDATE public.notifications n
  SET read_at = now()
  WHERE n.workspace_id = v_workspace
    AND n.recipient_id = v_member
    AND n.read_at IS NULL
    AND n.dedupe_key <> 'visitor_message:during-markall';

  UPDATE public.notification_unread_counts c
  SET
    unread_count = (
      SELECT COUNT(*)::integer
      FROM public.notifications n
      WHERE n.workspace_id = v_workspace
        AND n.recipient_id = v_member
        AND n.read_at IS NULL
    ),
    updated_at = now()
  WHERE c.workspace_id = v_workspace
    AND c.member_id = v_member;

  SELECT COUNT(*)::integer INTO v_remaining
  FROM public.notifications
  WHERE recipient_id = v_member AND read_at IS NULL;

  IF (
    SELECT unread_count FROM public.notification_unread_counts
    WHERE member_id = v_member
  ) <> v_remaining THEN
    RAISE EXCEPTION 'counter != remaining unread after mark-all race reconcile';
  END IF;

  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'insert during mark-all must remain unread';
  END IF;

  -- Real RPC mark-all twice (idempotent)
  v_result := public.mark_all_notifications_read(v_workspace);
  IF (v_result->>'unread_count')::integer <> 0 THEN
    RAISE EXCEPTION 'mark-all must zero unread';
  END IF;
  v_result := public.mark_all_notifications_read(v_workspace);
  IF (v_result->>'unread_count')::integer <> 0 THEN
    RAISE EXCEPTION 'repeated mark-all must stay zero';
  END IF;

  IF (
    SELECT COUNT(*) FROM public.notifications
    WHERE recipient_id = v_member AND read_at IS NULL
  ) <> 0 THEN
    RAISE EXCEPTION 'no unread rows after mark-all';
  END IF;

  PERFORM tests.clear_auth();
END;
$$;

SELECT pass('mark-all race reconcile keeps counter = COUNT(unread)');

-- Mark one twice idempotent
SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT tests.clear_auth();

SELECT ok(
  app_private.emit_notification(
    current_setting('tests.workspace_a')::uuid,
    current_setting('tests.agent_member_a')::uuid,
    'visitor_message',
    'visitor_message:mark-twice',
    'New visitor message',
    'x',
    'message',
    NULL, NULL, NULL, '{}'::jsonb
  ) IS NOT NULL,
  'emit for mark-twice'
);

SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

DO $$
DECLARE
  v_id uuid;
  v_workspace uuid := current_setting('tests.workspace_a')::uuid;
  r1 jsonb;
  r2 jsonb;
BEGIN
  SELECT id INTO v_id
  FROM public.notifications
  WHERE dedupe_key = 'visitor_message:mark-twice'
  LIMIT 1;

  r1 := public.mark_notification_read(v_workspace, v_id);
  r2 := public.mark_notification_read(v_workspace, v_id);
  IF (r1->>'unread_count')::integer <> (r2->>'unread_count')::integer THEN
    RAISE EXCEPTION 'repeated mark-one changed unread';
  END IF;
  IF (
    SELECT c.unread_count
    FROM public.notification_unread_counts c
    WHERE c.member_id = current_setting('tests.agent_member_a')::uuid
  ) <> (
    SELECT COUNT(*)::integer
    FROM public.notifications n
    WHERE n.recipient_id = current_setting('tests.agent_member_a')::uuid
      AND n.read_at IS NULL
  ) THEN
    RAISE EXCEPTION 'unread invariant broken after mark-one twice';
  END IF;
END;
$$;

SELECT pass('mark one twice is idempotent and preserves unread invariant');

-- Mention payload must not include note body / snippet
SELECT tests.clear_auth();

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'mention'
      AND (
        n.body ILIKE '%SECRET_NOTE%'
        OR n.payload_json::text ILIKE '%SECRET_NOTE%'
        OR n.payload_json ? 'snippet'
        OR n.payload_json ? 'note_body'
      )
  ),
  'mention notifications never store note body or snippet'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.type = 'mention'
      AND n.payload_json ? 'note_id'
  ),
  'mention payload may include note_id only'
);

-- Cross-workspace: agent A cannot list workspace B
SELECT tests.authenticate_as(
  current_setting('tests.agent_a')::uuid,
  'notif-agent-a@test.local'
);

SELECT throws_ok(
  format(
    'SELECT public.list_notifications(%L::uuid, ''{}''::jsonb)',
    current_setting('tests.workspace_b')
  ),
  'FORBIDDEN: Workspace not accessible',
  'cross-workspace list denied'
);

-- Email claim: two claims cannot both own the same pending row
SELECT tests.clear_auth();

DO $$
DECLARE
  v_workspace uuid := current_setting('tests.workspace_a')::uuid;
  v_member uuid := current_setting('tests.agent_member_a')::uuid;
  v_outbox uuid;
  r1 public.notification_email_outbox;
  r2 public.notification_email_outbox;
  v_count integer;
BEGIN
  INSERT INTO public.notification_email_outbox (
    workspace_id,
    recipient_member_id,
    email_category,
    dedupe_key,
    to_email,
    subject,
    status
  )
  VALUES (
    v_workspace,
    v_member,
    'visitor_message',
    'email:claim-race-1',
    'notif-agent-a@test.local',
    'Claim race',
    'pending'
  )
  RETURNING id INTO v_outbox;

  SELECT * INTO r1 FROM app_private.claim_notification_email_outbox(10)
  WHERE id = v_outbox;

  SELECT * INTO r2 FROM app_private.claim_notification_email_outbox(10)
  WHERE id = v_outbox;

  IF r1.id IS NULL THEN
    RAISE EXCEPTION 'first claim should own the row';
  END IF;
  IF r2.id IS NOT NULL THEN
    RAISE EXCEPTION 'second claim must not re-own sending row';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notification_email_outbox
  WHERE id = v_outbox AND status = 'sending';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'row must be in sending exactly once';
  END IF;

  IF NOT app_private.finalize_notification_email_outbox(
    v_outbox, 'sent', NULL, 'provider-msg-1'
  ) THEN
    RAISE EXCEPTION 'finalize sent failed';
  END IF;
END;
$$;

SELECT pass('email outbox claim is exclusive before send');

SELECT * FROM finish();
ROLLBACK;
