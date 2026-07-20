-- ============================================================
-- Migration 031: Audit G4 — organizations carry their own timezone.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';

COMMENT ON COLUMN organizations.timezone IS
  'IANA timezone (e.g. America/New_York). Authoritative for all date-only math: service_date, period boundaries, "today" in dashboards and crons.';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_timezone_not_blank;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_timezone_not_blank
  CHECK (length(trim(timezone)) > 0);
