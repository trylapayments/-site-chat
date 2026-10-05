-- Server Actions authorize active owner/admin membership before accessing this
-- table. Browser roles remain read-only under workspace RLS. Domain approval is
-- an explicit allowlist choice; it does not assert DNS ownership verification.
GRANT SELECT, INSERT, UPDATE ON TABLE public.allowed_domains TO service_role;
