-- Availability is workspace-wide, independent of conversation Presence.
-- Browser clients never read/write these rows directly. Server Actions verify
-- the caller's active membership; visitor API exposes only an aggregate status.
CREATE TABLE public.operator_availability (
  member_id uuid PRIMARY KEY REFERENCES public.workspace_members(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('available', 'away', 'offline')),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.operator_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_availability FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operator_availability TO service_role;
