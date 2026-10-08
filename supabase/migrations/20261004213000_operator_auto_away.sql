-- Keep the manual choice separate from idle availability. Offline is never
-- inferred from a missing heartbeat. Zero disables automatic Away.
ALTER TABLE public.operator_availability
  ADD COLUMN idle_timeout_minutes integer NOT NULL DEFAULT 5 CHECK (idle_timeout_minutes BETWEEN 0 AND 120),
  ADD COLUMN last_activity_at timestamptz NOT NULL DEFAULT now();
