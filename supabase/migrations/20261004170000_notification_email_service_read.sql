-- Server-only email delivery must recheck membership, current preferences and
-- unread notification context. Mutations remain behind existing RPCs.
-- Do not grant these privileges to visitor or authenticated browser roles.
GRANT SELECT ON TABLE public.workspace_members TO service_role;
GRANT SELECT ON TABLE public.notification_preferences TO service_role;
GRANT SELECT ON TABLE public.notifications TO service_role;
