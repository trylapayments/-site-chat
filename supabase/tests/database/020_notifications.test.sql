\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(33);

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

  -- Dedupe
  IF app_private.emit_notification(
    v_workspace_a,
    v_agent_member_a,
    'conversation_assigned',
    'conversation_assigned:test:v1',
    'Conversation assigned to you',
    'Owner assigned you',
    'conversation',
    NULL, NULL, v_owner_member_a, '{}'::jsonb
  ) IS NOT NULL THEN
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

SELECT * FROM finish();
ROLLBACK;
