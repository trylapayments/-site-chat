\ir helpers/000_helpers.psql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

-- Schema(17) + privileges/search_path(8) + empty query(4) + exact email(2)
-- + company domain(6) + tag/custom field(8) + message body(3)
-- + notes agent+viewer(6) + soft-deleted notes(5) + attachment(4)
-- + contact name refresh(6) + viewer restrictions(4)
-- + workspace isolation(3) + foreign probe(2)
-- = 78
SELECT plan(78);

TRUNCATE tests.fixtures;

DO $$
DECLARE
  v_owner_a uuid;
  v_agent_a uuid;
  v_viewer_a uuid;
  v_owner_b uuid;
  v_workspace_a uuid;
  v_workspace_b uuid;
  v_agent_member_a uuid;
  v_contact_a uuid;
  v_contact_b uuid;
  v_session_a uuid;
  v_session_b uuid;
  v_conversation_a uuid;
  v_conversation_b uuid;
  v_message_a uuid;
BEGIN
  v_owner_a := tests.create_auth_user('gs-owner-a@test.local');
  v_agent_a := tests.create_auth_user('gs-agent-a@test.local');
  v_viewer_a := tests.create_auth_user('gs-viewer-a@test.local');
  v_owner_b := tests.create_auth_user('gs-owner-b@test.local');

  PERFORM tests.authenticate_as(v_owner_a, 'gs-owner-a@test.local');
  v_workspace_a := (
    public.create_workspace('GS Workspace A', 'gs-workspace-a')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  PERFORM tests.authenticate_as(v_owner_b, 'gs-owner-b@test.local');
  v_workspace_b := (
    public.create_workspace('GS Workspace B', 'gs-workspace-b')
    ->> 'workspace_id'
  )::uuid;
  PERFORM tests.clear_auth();

  INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
  VALUES
    (v_workspace_a, v_agent_a, 'agent', 'active'),
    (v_workspace_a, v_viewer_a, 'viewer', 'active');

  SELECT id INTO v_agent_member_a FROM public.workspace_members
  WHERE workspace_id = v_workspace_a AND user_id = v_agent_a;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_a,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'gs-contact-a@test.local',
    'GS Contact Alpha'
  )
  RETURNING id INTO v_contact_a;

  INSERT INTO public.contacts (workspace_id, public_id, email, name)
  VALUES (
    v_workspace_b,
    'vis_' || encode(extensions.gen_random_bytes(16), 'hex'),
    'gs-contact-b-foreign@test.local',
    'GS Contact Bravo'
  )
  RETURNING id INTO v_contact_b;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_a,
    v_contact_a,
    encode(extensions.digest('gs-session-a', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_a;

  INSERT INTO public.visitor_sessions (workspace_id, contact_id, session_token_hash, expires_at)
  VALUES (
    v_workspace_b,
    v_contact_b,
    encode(extensions.digest('gs-session-b', 'sha256'), 'hex'),
    now() + interval '1 day'
  )
  RETURNING id INTO v_session_b;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, status, channel_type
  )
  VALUES (v_workspace_a, v_session_a, v_contact_a, 'open', 'widget')
  RETURNING id INTO v_conversation_a;

  INSERT INTO public.conversations (
    workspace_id, visitor_session_id, contact_id, status, channel_type
  )
  VALUES (v_workspace_b, v_session_b, v_contact_b, 'open', 'widget')
  RETURNING id INTO v_conversation_b;

  INSERT INTO public.messages (
    workspace_id,
    conversation_id,
    sequence_number,
    sender_type,
    visitor_session_id,
    body
  )
  VALUES (
    v_workspace_a,
    v_conversation_a,
    1,
    'visitor',
    v_session_a,
    'UniqueGsMessageBodyZebra42 about pricing'
  )
  RETURNING id INTO v_message_a;

  INSERT INTO tests.fixtures (key, value) VALUES
    ('workspace_a', v_workspace_a::text),
    ('workspace_b', v_workspace_b::text),
    ('owner_a', v_owner_a::text),
    ('agent_a', v_agent_a::text),
    ('viewer_a', v_viewer_a::text),
    ('owner_b', v_owner_b::text),
    ('agent_member_a', v_agent_member_a::text),
    ('contact_a', v_contact_a::text),
    ('contact_b', v_contact_b::text),
    ('conversation_a', v_conversation_a::text),
    ('conversation_b', v_conversation_b::text),
    ('message_a', v_message_a::text);
END;
$$;

-- ---------------------------------------------------------------------------
-- Schema: search_vector columns + GIN / trigram indexes
-- ---------------------------------------------------------------------------

SELECT has_column('public', 'messages', 'search_vector',
  'messages.search_vector column exists');
SELECT has_column('public', 'conversations', 'search_vector',
  'conversations.search_vector column exists');

SELECT has_index('public', 'messages', 'idx_messages_search_vector',
  'messages search_vector GIN exists');
SELECT has_index('public', 'messages', 'idx_messages_body_trgm',
  'messages body trigram GIN exists');
SELECT has_index('public', 'messages', 'idx_messages_workspace_created',
  'messages workspace created index exists');

SELECT has_index('public', 'conversations', 'idx_conversations_search_vector',
  'conversations search_vector GIN exists');
SELECT has_index('public', 'conversations', 'idx_conversations_source_url_trgm',
  'conversations source_url trigram GIN exists');
SELECT has_index('public', 'conversations', 'idx_conversations_preview_trgm',
  'conversations preview trigram GIN exists');

SELECT has_index('public', 'message_attachments', 'idx_message_attachments_filename_trgm',
  'attachments filename trigram GIN exists');
SELECT has_index('public', 'message_attachments', 'idx_message_attachments_workspace_created',
  'attachments workspace created index exists');

SELECT has_index('public', 'contacts', 'idx_contacts_name_trgm',
  'contacts name trigram GIN exists');
SELECT has_index('public', 'contacts', 'idx_contacts_email_trgm',
  'contacts email trigram GIN exists');
SELECT has_index('public', 'contacts', 'idx_contacts_phone_trgm',
  'contacts phone trigram GIN exists');
SELECT has_index('public', 'contacts', 'idx_contacts_job_title_trgm',
  'contacts job_title trigram GIN exists');

SELECT has_index('public', 'internal_notes', 'idx_internal_notes_body_trgm',
  'internal_notes body trigram GIN exists');

SELECT has_function(
  'public',
  'global_search',
  ARRAY['uuid', 'jsonb'],
  'public.global_search(uuid, jsonb) exists'
);
SELECT has_function(
  'app_private',
  'global_search',
  ARRAY['uuid', 'jsonb'],
  'app_private.global_search(uuid, jsonb) exists'
);

-- ---------------------------------------------------------------------------
-- Privileges + SECURITY DEFINER search_path
-- ---------------------------------------------------------------------------

SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.global_search(uuid, jsonb)',
    'execute'
  ),
  'authenticated can execute public.global_search'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.global_search(uuid, jsonb)',
    'execute'
  ),
  'anon cannot execute public.global_search'
);

SELECT ok(
  NOT has_function_privilege(
    'public',
    'public.global_search(uuid, jsonb)',
    'execute'
  ),
  'PUBLIC cannot execute public.global_search'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'app_private.global_search(uuid, jsonb)',
    'execute'
  ),
  'authenticated cannot execute app_private.global_search'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'app_private.global_search(uuid, jsonb)',
    'execute'
  ),
  'anon cannot execute app_private.global_search'
);

SELECT ok(
  (
    SELECT 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'global_search'
      AND pg_get_function_identity_arguments(p.oid) = 'p_workspace_id uuid, p_query jsonb'
  ),
  'public.global_search has empty search_path'
);

SELECT ok(
  (
    SELECT 'search_path=""' = ANY (COALESCE(p.proconfig, ARRAY[]::text[]))
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname = 'global_search'
      AND pg_get_function_identity_arguments(p.oid) = 'p_workspace_id uuid, p_query jsonb'
  ),
  'app_private.global_search has empty search_path'
);

SELECT ok(
  (
    SELECT p.prosecdef
    FROM pg_proc p
    INNER JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'global_search'
      AND pg_get_function_identity_arguments(p.oid) = 'p_workspace_id uuid, p_query jsonb'
  ),
  'public.global_search is SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- Empty query returns empty groups
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  'authenticate agent for empty-query search'
);

SELECT is(
  (
    SELECT jsonb_typeof(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', '   ')
      ) -> 'groups' -> 'contacts'
    )
  ),
  'array',
  'empty query returns contacts group as array'
);

SELECT is(
  (
    SELECT (
      SELECT count(*)::int
      FROM jsonb_array_elements(
        public.global_search(
          tests.fixture('workspace_a')::uuid,
          '{}'::jsonb
        ) -> 'groups' -> 'contacts'
      )
    ) + (
      SELECT count(*)::int
      FROM jsonb_array_elements(
        public.global_search(
          tests.fixture('workspace_a')::uuid,
          '{}'::jsonb
        ) -> 'groups' -> 'messages'
      )
    ) + (
      SELECT count(*)::int
      FROM jsonb_array_elements(
        public.global_search(
          tests.fixture('workspace_a')::uuid,
          '{}'::jsonb
        ) -> 'groups' -> 'notes'
      )
    )
  ),
  0,
  'empty query returns empty contacts/messages/notes groups'
);

SELECT is(
  (
    public.global_search(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', '')
    ) ->> 'can_search_notes'
  )::boolean,
  true,
  'agent empty query has can_search_notes true'
);

-- ---------------------------------------------------------------------------
-- Exact contact email match
-- ---------------------------------------------------------------------------

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'gs-contact-a@test.local', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
      AND hit.value ->> 'type' = 'contact'
  ),
  'exact contact email match returns contact_a'
);

SELECT ok(
  (
    SELECT (hit.value ->> 'rank')::numeric >= 100
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'gs-contact-a@test.local', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
    LIMIT 1
  ),
  'exact contact email match ranks at identity boost'
);

-- ---------------------------------------------------------------------------
-- Company domain via contacts.search_vector
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.create_company(
      tests.fixture('workspace_a')::uuid,
      'GS Domain Co',
      'gsdomainunique.test',
      NULL,
      NULL,
      NULL
    );
  $$,
  'create company with gsdomainunique.test'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'company_gs', id::text
FROM public.companies
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND lower(name) = 'gs domain co'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  're-authenticate agent after company create'
);

SELECT lives_ok(
  $$
    SELECT public.link_contact_company(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('company_gs')::uuid
    );
  $$,
  'link contact_a to GS Domain Co'
);

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'gsdomainunique.test')
    FROM public.contacts
    WHERE id = tests.fixture('contact_a')::uuid
  ),
  'contact search_vector contains company domain'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'gsdomainunique.test', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
  ),
  'global search finds contact by company domain'
);

-- ---------------------------------------------------------------------------
-- Tag / custom-field search via contact search_vector
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.create_contact_tag(
      tests.fixture('workspace_a')::uuid,
      'GsUniqueTag',
      '#00AA00'
    );
  $$,
  'create GsUniqueTag'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'tag_gs', id::text
FROM public.contact_tags
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND lower(name) = 'gsuniquetag'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('owner_a')::uuid,
      'gs-owner-a@test.local'
    );
  $$,
  'authenticate owner for custom field definition'
);

SELECT lives_ok(
  $$
    SELECT public.create_custom_field_definition(
      tests.fixture('workspace_a')::uuid,
      'gs_note_field',
      'GS Note Field',
      'text',
      '[]'::jsonb,
      1,
      false
    );
  $$,
  'create text custom field for search'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'field_gs', id::text
FROM public.custom_field_definitions
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND key = 'gs_note_field'
  AND deleted_at IS NULL
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  'authenticate agent for tag assign + custom value'
);

SELECT lives_ok(
  $$
    SELECT public.assign_contact_tag(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('tag_gs')::uuid
    );
  $$,
  'assign GsUniqueTag to contact_a'
);

SELECT lives_ok(
  $$
    SELECT public.set_contact_custom_field_value(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      tests.fixture('field_gs')::uuid,
      '"GsCustomZebra99"'::jsonb
    );
  $$,
  'set custom field value GsCustomZebra99'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsUniqueTag', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
  ),
  'global search finds contact by tag name'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsCustomZebra99', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
  ),
  'global search finds contact by custom field value'
);

-- ---------------------------------------------------------------------------
-- Message body search returns conversation_id
-- ---------------------------------------------------------------------------

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'UniqueGsMessageBodyZebra42', 'category', 'messages')
      ) -> 'groups' -> 'messages'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('message_a')
      AND hit.value ->> 'conversation_id' = tests.fixture('conversation_a')
      AND hit.value ->> 'type' = 'message'
  ),
  'message body search returns message with conversation_id'
);

SELECT is(
  (
    SELECT hit.value ->> 'message_id'
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'UniqueGsMessageBodyZebra42', 'category', 'messages')
      ) -> 'groups' -> 'messages'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('message_a')
    LIMIT 1
  ),
  tests.fixture('message_a'),
  'message hit message_id matches message id'
);

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'UniqueGsMessageBodyZebra42')
    FROM public.messages
    WHERE id = tests.fixture('message_a')::uuid
  ),
  'message search_vector indexes body'
);

-- ---------------------------------------------------------------------------
-- Notes: agent finds; viewer empty notes + can_search_notes false
-- ---------------------------------------------------------------------------

SELECT isnt(
  public.create_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('conversation_a')::uuid,
    'GsSecretNoteBodyAlpha777 for handoff',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    NULL
  )->>'id',
  NULL,
  'agent can create searchable internal note'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_active', id::text
FROM public.internal_notes
WHERE conversation_id = tests.fixture('conversation_a')::uuid
  AND client_note_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  're-authenticate agent for note search'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsSecretNoteBodyAlpha777', 'category', 'notes')
      ) -> 'groups' -> 'notes'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('note_active')
      AND hit.value ->> 'conversation_id' = tests.fixture('conversation_a')
  ),
  'agent note search returns active note'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('viewer_a')::uuid,
      'gs-viewer-a@test.local'
    );
  $$,
  'authenticate viewer for notes restriction'
);

SELECT is(
  (
    public.global_search(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', 'GsSecretNoteBodyAlpha777')
    ) ->> 'can_search_notes'
  )::boolean,
  false,
  'viewer can_search_notes is false'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsSecretNoteBodyAlpha777', 'category', 'notes')
      ) -> 'groups' -> 'notes'
    )
  ),
  0,
  'viewer notes group is empty (no existence leak)'
);

-- ---------------------------------------------------------------------------
-- Soft-deleted notes excluded
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  'authenticate agent for soft-delete note'
);

SELECT isnt(
  public.create_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('conversation_a')::uuid,
    'GsDeletedNoteBodyOmega888 should vanish',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
    NULL
  )->>'id',
  NULL,
  'agent creates note that will be soft-deleted'
);

SELECT tests.clear_auth();

INSERT INTO tests.fixtures (key, value)
SELECT 'note_deleted', id::text
FROM public.internal_notes
WHERE conversation_id = tests.fixture('conversation_a')::uuid
  AND client_note_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  're-authenticate agent before soft delete'
);

SELECT ok(
  (public.soft_delete_internal_note(
    tests.fixture('workspace_a')::uuid,
    tests.fixture('note_deleted')::uuid
  )->>'deleted_at') IS NOT NULL,
  'soft delete sets deleted_at on note'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsDeletedNoteBodyOmega888', 'category', 'notes')
      ) -> 'groups' -> 'notes'
    )
  ),
  0,
  'soft-deleted notes excluded from global search'
);

-- ---------------------------------------------------------------------------
-- Attachment filename search
-- ---------------------------------------------------------------------------

SELECT tests.clear_auth();

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
  tests.fixture('workspace_a')::uuid,
  tests.fixture('message_a')::uuid,
  tests.fixture('conversation_a')::uuid,
  tests.fixture('workspace_a') || '/' || tests.fixture('conversation_a')
    || '/dddddddd-dddd-4ddd-8ddd-dddddddddddd/GsUniqueInvoice42.pdf',
  'application/pdf',
  'GsUniqueInvoice42.pdf',
  2048,
  'document'
);

INSERT INTO tests.fixtures (key, value)
SELECT 'attachment_gs', id::text
FROM public.message_attachments
WHERE workspace_id = tests.fixture('workspace_a')::uuid
  AND filename = 'GsUniqueInvoice42.pdf'
LIMIT 1;

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  'authenticate agent for attachment search'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsUniqueInvoice42', 'category', 'attachments')
      ) -> 'groups' -> 'attachments'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('attachment_gs')
      AND hit.value ->> 'conversation_id' = tests.fixture('conversation_a')
      AND hit.value ->> 'title' = 'GsUniqueInvoice42.pdf'
  ),
  'attachment filename search returns hit with conversation_id'
);

SELECT ok(
  (
    SELECT hit.value ->> 'message_id' = tests.fixture('message_a')
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsUniqueInvoice42.pdf', 'category', 'attachments')
      ) -> 'groups' -> 'attachments'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('attachment_gs')
    LIMIT 1
  ),
  'attachment hit includes message_id'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsUniqueInvoice42', 'category', 'attachments')
      ) -> 'groups' -> 'attachments'
    ) AS hit(value)
    WHERE hit.value ? 'storage_key'
       OR (hit.value ->> 'snippet') ILIKE '%dddddddd%'
  ),
  'attachment hits never expose storage_key'
);

-- ---------------------------------------------------------------------------
-- Contact name change: new name searchable; old name gone from conversation vector
-- ---------------------------------------------------------------------------

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'Alpha')
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  'conversation search_vector contains original contact name token'
);

SELECT lives_ok(
  $$
    SELECT public.update_contact_profile(
      tests.fixture('workspace_a')::uuid,
      tests.fixture('contact_a')::uuid,
      jsonb_build_object('name', 'GS Contact RenamedOmega')
    );
  $$,
  'update contact name to GS Contact RenamedOmega'
);

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'RenamedOmega')
    FROM public.contacts
    WHERE id = tests.fixture('contact_a')::uuid
  ),
  'contact search_vector contains new name'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'RenamedOmega', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
  ),
  'global search finds contact by updated name'
);

SELECT ok(
  (
    SELECT search_vector @@ plainto_tsquery('english', 'RenamedOmega')
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  'conversation search_vector refreshed with new contact name'
);

SELECT ok(
  NOT (
    SELECT search_vector @@ plainto_tsquery('english', 'Alpha')
    FROM public.conversations
    WHERE id = tests.fixture('conversation_a')::uuid
  ),
  'old contact name token gone from conversation search_vector'
);

-- ---------------------------------------------------------------------------
-- Viewer restrictions (contacts still searchable; notes blocked already covered)
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('viewer_a')::uuid,
      'gs-viewer-a@test.local'
    );
  $$,
  'authenticate viewer for contact + message search'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'gs-contact-a@test.local', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_a')
  ),
  'viewer can search contacts'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'UniqueGsMessageBodyZebra42', 'category', 'messages')
      ) -> 'groups' -> 'messages'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('message_a')
  ),
  'viewer can search non-internal messages'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object('q', 'GsSecretNoteBodyAlpha777')
      ) -> 'groups' -> 'notes'
    )
  ),
  0,
  'viewer all-category search still returns empty notes'
);

-- ---------------------------------------------------------------------------
-- Workspace isolation + foreign id probe
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('owner_b')::uuid,
      'gs-owner-b@test.local'
    );
  $$,
  'authenticate workspace B owner'
);

SELECT throws_like(
  $$
    SELECT public.global_search(
      tests.fixture('workspace_a')::uuid,
      jsonb_build_object('q', 'gs-contact-a@test.local')
    );
  $$,
  '%Workspace not accessible%',
  'workspace B member cannot search workspace A'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_b')::uuid,
        jsonb_build_object('q', 'gs-contact-a@test.local', 'category', 'contacts')
      ) -> 'groups' -> 'contacts'
    )
  ),
  0,
  'workspace B search for workspace A email returns no contacts'
);

SELECT lives_ok(
  $$
    SELECT tests.authenticate_as(
      tests.fixture('agent_a')::uuid,
      'gs-agent-a@test.local'
    );
  $$,
  'authenticate agent A for foreign email probe'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'q',
          'gs-contact-b-foreign@test.local',
          'category',
          'contacts'
        )
      ) -> 'groups' -> 'contacts'
    ) AS hit(value)
    WHERE hit.value ->> 'id' = tests.fixture('contact_b')
  ),
  'foreign workspace contact email probe returns no that contact'
);

SELECT is(
  (
    SELECT count(*)::int
    FROM jsonb_array_elements(
      public.global_search(
        tests.fixture('workspace_a')::uuid,
        jsonb_build_object(
          'q',
          'gs-contact-b-foreign@test.local',
          'category',
          'contacts'
        )
      ) -> 'groups' -> 'contacts'
    )
  ),
  0,
  'foreign email probe returns empty contacts group in workspace A'
);

SELECT * FROM finish();
ROLLBACK;
