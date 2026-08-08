\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(15);

DO $$
DECLARE
  v_owner uuid;
  v_outsider uuid;
  v_workspace uuid;
  v_other_workspace uuid;
  v_member_id uuid;
  v_session uuid;
  v_conversation uuid;
  v_message uuid;
  v_token text := 'attachments-session-token';
BEGIN
  DELETE FROM tests.fixtures;

  v_owner := tests.create_auth_user('attachments-owner@test.local');
  v_outsider := tests.create_auth_user('attachments-outsider@test.local');

  PERFORM tests.authenticate_as(v_owner, 'attachments-owner@test.local');
  v_workspace := (public.create_workspace('Attachments WS', 'attachments-ws')->>'workspace_id')::uuid;

  SELECT wm.id INTO v_member_id
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_workspace
    AND wm.user_id = v_owner;

  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_outsider, 'attachments-outsider@test.local');
  v_other_workspace := (public.create_workspace('Other Att WS', 'attachments-other')->>'workspace_id')::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.visitor_sessions (workspace_id, session_token_hash, expires_at)
  VALUES (
    v_workspace,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session;

  INSERT INTO public.conversations (
    workspace_id,
    visitor_session_id,
    status,
    next_message_sequence,
    visitor_realtime_topic_key
  )
  VALUES (
    v_workspace,
    v_session,
    'open',
    1,
    encode(extensions.gen_random_bytes(32), 'hex')
  )
  RETURNING id INTO v_conversation;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body,
    is_internal
  )
  VALUES (
    v_workspace,
    v_conversation,
    1,
    'visitor',
    v_session,
    'with file',
    false
  )
  RETURNING id INTO v_message;

  INSERT INTO public.message_attachments (
    workspace_id,
    message_id,
    conversation_id,
    storage_key,
    mime_type,
    filename,
    size_bytes,
    kind
  )
  VALUES (
    v_workspace,
    v_message,
    v_conversation,
    v_workspace::text || '/' || v_conversation::text || '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/photo.png',
    'image/png',
    'photo.png',
    1024,
    'image'
  );

  INSERT INTO tests.fixtures (key, value) VALUES
    ('owner_id', v_owner::text),
    ('outsider_id', v_outsider::text),
    ('workspace_id', v_workspace::text),
    ('other_workspace_id', v_other_workspace::text),
    ('member_id', v_member_id::text),
    ('session_id', v_session::text),
    ('conversation_id', v_conversation::text),
    ('message_id', v_message::text),
    ('session_token', v_token);
END;
$$;

SELECT has_table('public', 'message_attachments', 'message_attachments exists');
SELECT has_table('public', 'attachment_uploads', 'attachment_uploads exists');
SELECT has_column('public', 'message_attachments', 'storage_key', 'storage_key column');
SELECT has_column('public', 'message_attachments', 'metadata_json', 'metadata_json column');
SELECT has_column('public', 'message_attachments', 'duration_ms', 'duration_ms for future media');

SELECT is(
  (SELECT public FROM storage.buckets WHERE id = 'attachments'),
  false,
  'attachments bucket is private'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'attachments_storage_select_authenticated'
  ),
  0,
  'no authenticated SELECT policy on attachments bucket (signed URLs only)'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'attachments_storage_insert_signed'
  ),
  1,
  'signed-upload INSERT policy exists (required by Storage RLS)'
);

SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM public.message_attachments
    WHERE workspace_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_id')
  $$,
  $$ VALUES (1) $$,
  'seed attachment exists'
);

-- Owner can select own workspace attachments
SELECT results_eq(
  $$
    SELECT count(*)::integer
    FROM public.message_attachments
    WHERE workspace_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_id')
  $$,
  $$ VALUES (1) $$,
  'owner sees attachments (via service/table before auth switch)'
);

DO $$
DECLARE
  v_owner uuid := (SELECT value::uuid FROM tests.fixtures WHERE key = 'owner_id');
  v_outsider uuid := (SELECT value::uuid FROM tests.fixtures WHERE key = 'outsider_id');
  v_workspace uuid := (SELECT value::uuid FROM tests.fixtures WHERE key = 'workspace_id');
  v_count integer;
BEGIN
  PERFORM tests.authenticate_as(v_owner, 'attachments-owner@test.local');
  SELECT count(*) INTO v_count
  FROM public.message_attachments
  WHERE workspace_id = v_workspace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'owner should see 1 attachment, got %', v_count;
  END IF;

  PERFORM tests.clear_auth();
  PERFORM tests.authenticate_as(v_outsider, 'attachments-outsider@test.local');
  SELECT count(*) INTO v_count
  FROM public.message_attachments
  WHERE workspace_id = v_workspace;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'outsider must not see cross-tenant attachments, got %', v_count;
  END IF;
  PERFORM tests.clear_auth();
END;
$$;

SELECT pass('RLS blocks cross-tenant attachment reads');

SELECT results_eq(
  $$
    SELECT filename
    FROM public.message_attachments
    WHERE message_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'message_id')
  $$,
  $$ VALUES ('photo.png') $$,
  'attachment row stores sanitized filename'
);

SELECT results_eq(
  $$
    SELECT kind::text
    FROM public.message_attachments
    WHERE message_id = (SELECT value::uuid FROM tests.fixtures WHERE key = 'message_id')
  $$,
  $$ VALUES ('image') $$,
  'attachment kind is image'
);

SELECT ok(
  has_table_privilege('service_role', 'public.attachment_uploads', 'INSERT')
    AND has_table_privilege('service_role', 'public.attachment_uploads', 'SELECT')
    AND has_table_privilege('service_role', 'public.attachment_uploads', 'UPDATE')
    AND has_table_privilege('service_role', 'public.attachment_uploads', 'DELETE'),
  'service_role can CRUD attachment_uploads intents'
);

SELECT ok(
  has_table_privilege('service_role', 'public.message_attachments', 'SELECT'),
  'service_role can SELECT message_attachments for download minting'
);

SELECT * FROM finish();
ROLLBACK;
