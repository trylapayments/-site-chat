-- Realtime postgres_changes filters on non-PK columns require FULL replica identity.

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
