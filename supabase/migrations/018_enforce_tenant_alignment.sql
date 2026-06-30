-- Migration 018: enforce tenant alignment across multi-tenant FK relationships
--
-- Context (D-C2 from the 2026-05-23 fresh audit):
--   Equipment row 8f464da4-d9d2-46be-96fc-b569a6132b37 was created under
--   organization a0000000-... (Pipeline AI demo) but pointed at site
--   ff5c8204-... which belongs to organization b0000000-... (NYSD). A linked
--   job (8af410e6-...) had the same problem — wrong org, NYSD client + site.
--   With cross-tenant data like that, RLS-protected lists silently leak
--   foreign rows and joins produce wrong tenant totals.
--
--   This migration adds BEFORE-INSERT/UPDATE triggers on every table that
--   carries both an `organization_id` AND a FK to another tenant-scoped
--   table. The trigger compares the row's org to the parent's org and
--   raises if they disagree, so no future cross-tenant row can land.
--
-- The 3 known-bad rows are repaired ahead of time (manual UPDATE), so
-- this DDL doesn't need to backfill — it just locks the door behind us.
--
-- Tables covered:
--   equipment.site_id   → site.organization_id
--   jobs.site_id        → site.organization_id
--   jobs.client_id      → client.organization_id
--   invoices.client_id  → client.organization_id
--   invoices.job_id     → job.organization_id
--   proposals.client_id → client.organization_id
--   proposals.site_id   → site.organization_id
--
-- All triggers no-op when the FK column is NULL (these are optional refs
-- on some tables). They also no-op when the parent row is unfindable —
-- the existing FK constraint already prevents that case, so the trigger
-- doesn't double-up the error.

-- ── equipment.site_id ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_equipment_org_matches_site() RETURNS TRIGGER AS $$
DECLARE v_site_org UUID;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    SELECT organization_id INTO v_site_org FROM sites WHERE id = NEW.site_id;
    IF v_site_org IS NOT NULL AND v_site_org != NEW.organization_id THEN
      RAISE EXCEPTION 'equipment.organization_id (%) does not match site.organization_id (%)',
        NEW.organization_id, v_site_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_org_matches_site ON equipment;
CREATE TRIGGER trg_equipment_org_matches_site
  BEFORE INSERT OR UPDATE ON equipment
  FOR EACH ROW EXECUTE FUNCTION enforce_equipment_org_matches_site();

-- ── jobs.site_id ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_jobs_org_matches_site() RETURNS TRIGGER AS $$
DECLARE v_site_org UUID;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    SELECT organization_id INTO v_site_org FROM sites WHERE id = NEW.site_id;
    IF v_site_org IS NOT NULL AND v_site_org != NEW.organization_id THEN
      RAISE EXCEPTION 'jobs.organization_id (%) does not match site.organization_id (%)',
        NEW.organization_id, v_site_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_org_matches_site ON jobs;
CREATE TRIGGER trg_jobs_org_matches_site
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_jobs_org_matches_site();

-- ── jobs.client_id ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_jobs_org_matches_client() RETURNS TRIGGER AS $$
DECLARE v_client_org UUID;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT organization_id INTO v_client_org FROM clients WHERE id = NEW.client_id;
    IF v_client_org IS NOT NULL AND v_client_org != NEW.organization_id THEN
      RAISE EXCEPTION 'jobs.organization_id (%) does not match client.organization_id (%)',
        NEW.organization_id, v_client_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_jobs_org_matches_client ON jobs;
CREATE TRIGGER trg_jobs_org_matches_client
  BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION enforce_jobs_org_matches_client();

-- ── invoices.client_id ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_invoices_org_matches_client() RETURNS TRIGGER AS $$
DECLARE v_client_org UUID;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT organization_id INTO v_client_org FROM clients WHERE id = NEW.client_id;
    IF v_client_org IS NOT NULL AND v_client_org != NEW.organization_id THEN
      RAISE EXCEPTION 'invoices.organization_id (%) does not match client.organization_id (%)',
        NEW.organization_id, v_client_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_org_matches_client ON invoices;
CREATE TRIGGER trg_invoices_org_matches_client
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_invoices_org_matches_client();

-- ── invoices.job_id ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_invoices_org_matches_job() RETURNS TRIGGER AS $$
DECLARE v_job_org UUID;
BEGIN
  IF NEW.job_id IS NOT NULL THEN
    SELECT organization_id INTO v_job_org FROM jobs WHERE id = NEW.job_id;
    IF v_job_org IS NOT NULL AND v_job_org != NEW.organization_id THEN
      RAISE EXCEPTION 'invoices.organization_id (%) does not match job.organization_id (%)',
        NEW.organization_id, v_job_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_org_matches_job ON invoices;
CREATE TRIGGER trg_invoices_org_matches_job
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION enforce_invoices_org_matches_job();

-- ── proposals.client_id ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_proposals_org_matches_client() RETURNS TRIGGER AS $$
DECLARE v_client_org UUID;
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT organization_id INTO v_client_org FROM clients WHERE id = NEW.client_id;
    IF v_client_org IS NOT NULL AND v_client_org != NEW.organization_id THEN
      RAISE EXCEPTION 'proposals.organization_id (%) does not match client.organization_id (%)',
        NEW.organization_id, v_client_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proposals_org_matches_client ON proposals;
CREATE TRIGGER trg_proposals_org_matches_client
  BEFORE INSERT OR UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION enforce_proposals_org_matches_client();

-- ── proposals.site_id ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_proposals_org_matches_site() RETURNS TRIGGER AS $$
DECLARE v_site_org UUID;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    SELECT organization_id INTO v_site_org FROM sites WHERE id = NEW.site_id;
    IF v_site_org IS NOT NULL AND v_site_org != NEW.organization_id THEN
      RAISE EXCEPTION 'proposals.organization_id (%) does not match site.organization_id (%)',
        NEW.organization_id, v_site_org;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proposals_org_matches_site ON proposals;
CREATE TRIGGER trg_proposals_org_matches_site
  BEFORE INSERT OR UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION enforce_proposals_org_matches_site();
