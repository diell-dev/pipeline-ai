-- ============================================================
-- Pipeline AI — Scheduling & Dispatch Module
-- Migration 002: Adds crews, recurring schedules, and
-- scheduling fields to the jobs table.
-- Business tier only.
-- ============================================================

-- ============================================================
-- 1. EXTEND JOBS STATUS ENUM
-- Add 'scheduled' status for pre-planned jobs
-- ============================================================
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN (
  'scheduled', 'submitted', 'ai_generating', 'pending_review', 'approved',
  'sent', 'revision_requested', 'revised', 'rejected',
  'completed', 'cancelled'
));

-- ============================================================
-- 2. CREWS (multi-crew management, Business tier)
-- ============================================================
CREATE TABLE crews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6', -- hex color for calendar UI
  lead_tech_id UUID REFERENCES users(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_crews_org ON crews(organization_id);
CREATE INDEX idx_crews_active ON crews(organization_id) WHERE is_active = TRUE;

-- Crew members join table
CREATE TABLE crew_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crew_id UUID NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(crew_id, user_id)
);

CREATE INDEX idx_crew_members_crew ON crew_members(crew_id);
CREATE INDEX idx_crew_members_user ON crew_members(user_id);

-- ============================================================
-- 3. RECURRING JOB SCHEDULES
-- ============================================================
CREATE TABLE recurring_job_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  assigned_to UUID REFERENCES users(id),     -- individual tech
  crew_id UUID REFERENCES crews(id),         -- or a crew
  created_by UUID NOT NULL REFERENCES users(id),

  -- Schedule pattern
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  day_of_week INT[] DEFAULT '{}',            -- 0=Sun, 1=Mon, ..., 6=Sat (for weekly/biweekly)
  day_of_month INT,                          -- 1-31 (for monthly; NULL if weekly)
  scheduled_time TIME NOT NULL,              -- time of day for each occurrence
  estimated_duration_minutes INT NOT NULL DEFAULT 60,

  -- Services to include (array of service_catalog IDs)
  service_ids UUID[] NOT NULL DEFAULT '{}',

  -- Auto-creation
  advance_creation_days INT NOT NULL DEFAULT 7,  -- create job N days before occurrence
  next_occurrence_date DATE NOT NULL,            -- when the next job should happen

  -- State
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  paused_until DATE,                             -- temporarily paused until this date

  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recurring_org ON recurring_job_schedules(organization_id);
CREATE INDEX idx_recurring_active ON recurring_job_schedules(organization_id, next_occurrence_date)
  WHERE is_active = TRUE;
CREATE INDEX idx_recurring_client ON recurring_job_schedules(client_id);

-- ============================================================
-- 4. ADD SCHEDULING COLUMNS TO JOBS
-- ============================================================

-- Who scheduled this job (NULL if tech self-submitted)
ALTER TABLE jobs ADD COLUMN scheduled_by UUID REFERENCES users(id);

-- Estimated end time for calendar block rendering
ALTER TABLE jobs ADD COLUMN scheduled_end_time TIMESTAMPTZ;

-- How long the job should take (in minutes)
ALTER TABLE jobs ADD COLUMN estimated_duration_minutes INT;

-- If rescheduled, what was the original time?
ALTER TABLE jobs ADD COLUMN original_scheduled_time TIMESTAMPTZ;

-- Why was it rescheduled?
ALTER TABLE jobs ADD COLUMN reschedule_reason TEXT;

-- Crew assignment (NULL if assigned to individual tech)
ALTER TABLE jobs ADD COLUMN crew_id UUID REFERENCES crews(id);

-- Link to recurring schedule (NULL if one-off job)
ALTER TABLE jobs ADD COLUMN recurring_schedule_id UUID REFERENCES recurring_job_schedules(id);

-- ============================================================
-- 5. NEW INDEXES FOR SCHEDULING QUERIES
-- ============================================================

-- Calendar view: fetch jobs in a date range for an org
CREATE INDEX idx_jobs_schedule_range ON jobs(organization_id, scheduled_time, scheduled_end_time)
  WHERE status NOT IN ('completed', 'cancelled') AND deleted_at IS NULL;

-- Tech schedule: fetch a tech's upcoming jobs
CREATE INDEX idx_jobs_tech_schedule ON jobs(assigned_to, scheduled_time)
  WHERE status = 'scheduled' AND deleted_at IS NULL;

-- Crew schedule: fetch a crew's upcoming jobs
CREATE INDEX idx_jobs_crew ON jobs(crew_id)
  WHERE crew_id IS NOT NULL AND deleted_at IS NULL;

-- Recurring link: find jobs spawned from a recurring schedule
CREATE INDEX idx_jobs_recurring ON jobs(recurring_schedule_id)
  WHERE recurring_schedule_id IS NOT NULL;

-- ============================================================
-- 6. AUTO-UPDATE TRIGGERS
-- ============================================================
CREATE TRIGGER trg_crews_updated
  BEFORE UPDATE ON crews FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_recurring_schedules_updated
  BEFORE UPDATE ON recurring_job_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS
ALTER TABLE crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_job_schedules ENABLE ROW LEVEL SECURITY;

-- CREWS: org-scoped, everyone can view, managers can manage
CREATE POLICY "Org members can view crews" ON crews
  FOR SELECT USING (organization_id = public.get_user_org_id());

CREATE POLICY "Managers can insert crews" ON crews
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

CREATE POLICY "Managers can update crews" ON crews
  FOR UPDATE USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

CREATE POLICY "Managers can delete crews" ON crews
  FOR DELETE USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- CREW MEMBERS: viewable by org, manageable by managers
CREATE POLICY "Org members can view crew members" ON crew_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM crews c
      WHERE c.id = crew_id AND c.organization_id = public.get_user_org_id()
    )
  );

CREATE POLICY "Managers can manage crew members" ON crew_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM crews c
      WHERE c.id = crew_id AND c.organization_id = public.get_user_org_id()
    )
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- RECURRING SCHEDULES: org-scoped, managers can manage
CREATE POLICY "Org members can view recurring schedules" ON recurring_job_schedules
  FOR SELECT USING (organization_id = public.get_user_org_id());

CREATE POLICY "Managers can insert recurring schedules" ON recurring_job_schedules
  FOR INSERT WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

CREATE POLICY "Managers can update recurring schedules" ON recurring_job_schedules
  FOR UPDATE USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

CREATE POLICY "Managers can delete recurring schedules" ON recurring_job_schedules
  FOR DELETE USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- ============================================================
-- 8. UPDATE EXISTING JOBS RLS
-- Techs should also see jobs assigned to their crew
-- ============================================================

-- Drop the old select policy and replace with one that includes crew visibility
DROP POLICY IF EXISTS "Staff can view all jobs" ON jobs;

CREATE POLICY "Staff can view all jobs" ON jobs
  FOR SELECT USING (
    organization_id = public.get_user_org_id()
    AND (
      public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
      OR submitted_by = auth.uid()
      OR assigned_to = auth.uid()
      OR (
        crew_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM crew_members cm WHERE cm.crew_id = jobs.crew_id AND cm.user_id = auth.uid()
        )
      )
    )
  );
