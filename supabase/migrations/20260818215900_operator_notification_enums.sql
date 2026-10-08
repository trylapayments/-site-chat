-- Operator notification enum extensions (must commit before use).
-- PostgreSQL disallows using newly-added enum labels in the same transaction
-- as ALTER TYPE ... ADD VALUE when the migration is wrapped in a transaction.

ALTER TYPE public.app_notification_type ADD VALUE IF NOT EXISTS 'visitor_message';
ALTER TYPE public.app_notification_type ADD VALUE IF NOT EXISTS 'conversation_transferred';
ALTER TYPE public.app_notification_type ADD VALUE IF NOT EXISTS 'conversation_unassigned';
