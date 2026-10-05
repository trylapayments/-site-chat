-- Provider retries must reuse exactly the same email even if the conversation changes.
ALTER TABLE public.conversation_transcript_requests ADD COLUMN payload jsonb CHECK(payload IS NULL OR jsonb_typeof(payload)='object');
