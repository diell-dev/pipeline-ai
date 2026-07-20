-- ============================================================
-- Pipeline AI — Equipment Cataloging Module (Phase 4)
-- HVAC-first asset tracking via pre-printed QR codes.
-- Spec from Bogdan 2026-05-19, refinements approved 2026-05-20.
--
-- HISTORY / AUDIT G3 (2026-07-20)
-- -------------------------------
-- This file used to be an 18-line placeholder that said "body applied
-- directly via Supabase MCP". That meant eight tables existed ONLY in the
-- live database: the repo could not rebuild the schema, and migrations 009+
-- (which ALTER these tables) would fail against a fresh project. This file
-- has now been reconstructed from the live schema of project
-- zabfuqxjjunsppotfrel so the migration chain is self-contained again.
--
-- Written to be idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) so it is
-- safe to re-run against the existing database — it is a no-op there.
--
-- Tables:
--   equipment_categories       — seeded HVAC types (see migration 012/013)
--   equipment_qr_batches       — admin pre-printed sticker batches
--   equipment_qr_codes         — one row per sticker (claimed on scan)
--   equipment                  — physical units (parent_equipment_id = systems)
--   equipment_scans            — audit log of every scan
--   equipment_jobs             — many-to-many with jobs
--   equipment_inspections      — checklist results captured during a job
--   equipment_service_requests — tenant scan → submits
--   equipment_catalog          — cross-org AI learning cache (migration 014)
-- ============================================================

-- ── equipment_categories ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_categories (
  id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                            TEXT NOT NULL UNIQUE,
  name                            TEXT NOT NULL,
  parent_category                 TEXT,
  icon                            TEXT NOT NULL DEFAULT 'wrench',
  sort_order                      INTEGER NOT NULL DEFAULT 0,
  typical_lifespan_years          INTEGER NOT NULL DEFAULT 15,
  default_service_interval_months INTEGER NOT NULL DEFAULT 12,
  estimated_replacement_cost      NUMERIC NOT NULL DEFAULT 0,
  inspection_checklist            JSONB NOT NULL DEFAULT '[]'::jsonb,
  description                     TEXT,
  is_active                       BOOLEAN NOT NULL DEFAULT true,
  is_org_specific                 BOOLEAN NOT NULL DEFAULT false,
  organization_id                 UUID REFERENCES organizations(id) ON DELETE CASCADE,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_cats_active
  ON equipment_categories (parent_category, sort_order) WHERE is_active = true;

-- ── equipment_qr_batches ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_qr_batches (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_number    INTEGER NOT NULL,
  prefix          TEXT NOT NULL,
  total_codes     INTEGER NOT NULL,
  printed_pdf_url TEXT,
  notes           TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, batch_number)
);
CREATE INDEX IF NOT EXISTS idx_eq_batches_org ON equipment_qr_batches (organization_id);

-- ── equipment ────────────────────────────────────────────────
-- Created before equipment_qr_codes because the latter FKs to it.
CREATE TABLE IF NOT EXISTS equipment (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id                  UUID NOT NULL REFERENCES sites(id),
  unit_number              TEXT,
  common_area_name         TEXT,
  category_id              UUID NOT NULL REFERENCES equipment_categories(id),
  qr_code                  TEXT UNIQUE,
  parent_equipment_id      UUID REFERENCES equipment(id),
  make                     TEXT,
  model                    TEXT,
  serial_number            TEXT,
  manufacture_date         DATE,
  installed_date           DATE,
  last_serviced_date       DATE,
  next_service_due_date    DATE,
  service_interval_months  INTEGER,
  data_plate_photo_url     TEXT,
  unit_photo_url           TEXT,
  ai_metadata              JSONB DEFAULT '{}'::jsonb,
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'replaced', 'removed', 'archived')),
  replaced_by_equipment_id UUID REFERENCES equipment(id),
  replaced_at              TIMESTAMPTZ,
  notes                    TEXT,
  created_by               UUID NOT NULL REFERENCES users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at               TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_equipment_org    ON equipment (organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_site   ON equipment (site_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_qr     ON equipment (qr_code) WHERE qr_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_parent ON equipment (parent_equipment_id) WHERE parent_equipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_due
  ON equipment (organization_id, next_service_due_date)
  WHERE status = 'active' AND deleted_at IS NULL;

-- ── equipment_qr_codes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_qr_codes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code            TEXT NOT NULL UNIQUE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  batch_id        UUID NOT NULL REFERENCES equipment_qr_batches(id) ON DELETE CASCADE,
  claimed_at      TIMESTAMPTZ,
  equipment_id    UUID REFERENCES equipment(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_qr_org       ON equipment_qr_codes (organization_id);
CREATE INDEX IF NOT EXISTS idx_eq_qr_batch     ON equipment_qr_codes (batch_id);
CREATE INDEX IF NOT EXISTS idx_eq_qr_unclaimed ON equipment_qr_codes (organization_id) WHERE claimed_at IS NULL;

-- ── equipment_scans ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_scans (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id         UUID REFERENCES equipment(id) ON DELETE CASCADE,
  qr_code              TEXT NOT NULL,
  scanned_by           UUID REFERENCES users(id),
  scanned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action               TEXT NOT NULL
                         CHECK (action IN ('view', 'register', 'start_job', 'tenant_request')),
  ip_address           TEXT,
  user_agent           TEXT,
  ai_extraction        JSONB,
  confirmed_extraction JSONB,
  field_corrections    JSONB,
  photo_url            TEXT
);
CREATE INDEX IF NOT EXISTS idx_eq_scans_equip ON equipment_scans (equipment_id, scanned_at DESC);

-- ── equipment_jobs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_jobs (
  equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  job_id       UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (equipment_id, job_id)
);
CREATE INDEX IF NOT EXISTS idx_eq_jobs_job ON equipment_jobs (job_id);

-- ── equipment_inspections ────────────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_inspections (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id               UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  equipment_id         UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  checklist_item_code  TEXT NOT NULL,
  checklist_item_label TEXT NOT NULL,
  result               TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'na')),
  notes                TEXT,
  recorded_by          UUID NOT NULL REFERENCES users(id),
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_insp_job   ON equipment_inspections (job_id);
CREATE INDEX IF NOT EXISTS idx_eq_insp_equip ON equipment_inspections (equipment_id, recorded_at DESC);

-- ── equipment_service_requests ───────────────────────────────
CREATE TABLE IF NOT EXISTS equipment_service_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id     UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  requester_name   TEXT NOT NULL,
  requester_email  TEXT,
  requester_phone  TEXT,
  description      TEXT NOT NULL,
  urgency          TEXT NOT NULL DEFAULT 'normal'
                     CHECK (urgency IN ('normal', 'urgent', 'emergency')),
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'contacted', 'scheduled', 'completed', 'cancelled')),
  resulting_job_id UUID REFERENCES jobs(id),
  ip_address       TEXT,
  user_agent       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eq_svc_req_equip ON equipment_service_requests (equipment_id);
CREATE INDEX IF NOT EXISTS idx_eq_svc_req_new
  ON equipment_service_requests (status, created_at DESC) WHERE status = 'new';

-- ── equipment_catalog (cross-org AI learning cache; see migration 014) ──
CREATE TABLE IF NOT EXISTS equipment_catalog (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand              TEXT NOT NULL,
  model              TEXT NOT NULL,
  confirmed_count    INTEGER NOT NULL DEFAULT 1,
  common_values      JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_metadata        JSONB,
  first_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (brand, model)
);
CREATE INDEX IF NOT EXISTS idx_equipment_catalog_brand_model ON equipment_catalog (brand, model);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE equipment                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_qr_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_qr_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_scans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_jobs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_inspections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_catalog          ENABLE ROW LEVEL SECURITY;

-- equipment
DROP POLICY IF EXISTS "View equipment" ON equipment;
CREATE POLICY "View equipment" ON equipment FOR SELECT
  USING (((organization_id = public.get_user_org_id()) AND deleted_at IS NULL) OR public.is_super_admin());
DROP POLICY IF EXISTS "Staff manage equipment" ON equipment;
CREATE POLICY "Staff manage equipment" ON equipment FOR ALL
  USING (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager', 'field_tech')))
  WITH CHECK (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager', 'field_tech')));

-- equipment_categories
DROP POLICY IF EXISTS "View equipment categories" ON equipment_categories;
CREATE POLICY "View equipment categories" ON equipment_categories FOR SELECT
  USING (public.is_super_admin() OR organization_id IS NULL OR organization_id = public.get_user_org_id());
DROP POLICY IF EXISTS "Owners can manage org categories" ON equipment_categories;
CREATE POLICY "Owners can manage org categories" ON equipment_categories FOR ALL
  USING (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager')))
  WITH CHECK (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager')));

-- equipment_qr_batches / equipment_qr_codes
-- (the INSERT/DELETE policies land in migration 009)
DROP POLICY IF EXISTS "View QR batches" ON equipment_qr_batches;
CREATE POLICY "View QR batches" ON equipment_qr_batches FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "Managers manage QR batches" ON equipment_qr_batches;
CREATE POLICY "Managers manage QR batches" ON equipment_qr_batches FOR ALL
  USING (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager')))
  WITH CHECK (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager')));

DROP POLICY IF EXISTS "View QR codes" ON equipment_qr_codes;
CREATE POLICY "View QR codes" ON equipment_qr_codes FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
DROP POLICY IF EXISTS "Staff can claim QR codes" ON equipment_qr_codes;
CREATE POLICY "Staff can claim QR codes" ON equipment_qr_codes FOR UPDATE
  USING (public.is_super_admin() OR (organization_id = public.get_user_org_id()
         AND public.get_user_role() IN ('owner', 'office_manager', 'field_tech')));

-- equipment_scans
DROP POLICY IF EXISTS "View equipment scans" ON equipment_scans;
CREATE POLICY "View equipment scans" ON equipment_scans FOR SELECT
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_scans.equipment_id AND e.organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS "Staff insert scans" ON equipment_scans;
CREATE POLICY "Staff insert scans" ON equipment_scans FOR INSERT
  WITH CHECK (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_scans.equipment_id AND e.organization_id = public.get_user_org_id()));

-- equipment_jobs
DROP POLICY IF EXISTS "View equipment jobs" ON equipment_jobs;
CREATE POLICY "View equipment jobs" ON equipment_jobs FOR SELECT
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_jobs.equipment_id AND e.organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS "Staff manage equipment jobs" ON equipment_jobs;
CREATE POLICY "Staff manage equipment jobs" ON equipment_jobs FOR ALL
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_jobs.equipment_id AND e.organization_id = public.get_user_org_id()
      AND public.get_user_role() IN ('owner', 'office_manager', 'field_tech')));

-- equipment_inspections
DROP POLICY IF EXISTS "View equipment inspections" ON equipment_inspections;
CREATE POLICY "View equipment inspections" ON equipment_inspections FOR SELECT
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_inspections.equipment_id AND e.organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS "Staff manage inspections" ON equipment_inspections;
CREATE POLICY "Staff manage inspections" ON equipment_inspections FOR ALL
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_inspections.equipment_id AND e.organization_id = public.get_user_org_id()
      AND public.get_user_role() IN ('owner', 'office_manager', 'field_tech')));

-- equipment_service_requests
DROP POLICY IF EXISTS "View service requests" ON equipment_service_requests;
CREATE POLICY "View service requests" ON equipment_service_requests FOR SELECT
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_service_requests.equipment_id AND e.organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS "Staff update service requests" ON equipment_service_requests;
CREATE POLICY "Staff update service requests" ON equipment_service_requests FOR UPDATE
  USING (public.is_super_admin() OR EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = equipment_service_requests.equipment_id AND e.organization_id = public.get_user_org_id()
      AND public.get_user_role() IN ('owner', 'office_manager')));

-- equipment_catalog: cross-org learning cache, readable by any staff login.
DROP POLICY IF EXISTS "equipment_catalog: authenticated can read" ON equipment_catalog;
CREATE POLICY "equipment_catalog: authenticated can read" ON equipment_catalog FOR SELECT USING (true);

-- Portal clients are excluded from the entire module (see migration 025's
-- isolation sweep, reproduced here so a fresh rebuild is safe by default).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'equipment', 'equipment_categories', 'equipment_qr_batches', 'equipment_qr_codes',
    'equipment_scans', 'equipment_jobs', 'equipment_inspections',
    'equipment_service_requests', 'equipment_catalog'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "portal_block_client_read" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "portal_block_client_read" ON %I AS RESTRICTIVE FOR SELECT TO public USING (public.get_user_role() <> ''client'')',
      t
    );
  END LOOP;
END $$;
