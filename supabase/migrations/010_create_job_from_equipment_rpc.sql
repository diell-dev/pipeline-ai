-- ============================================================
-- Pipeline AI — create_job_from_equipment RPC
-- Migration 010
--
-- Atomicity fix for /api/jobs/start-from-equipment (audit item #4).
--
-- The route previously performed three sequential inserts:
--   1. jobs                  (the new work order)
--   2. equipment_jobs        (link the equipment to the new job)
--   3. activity_log          (audit trail)
-- If any of #2 or #3 failed after #1 succeeded, the result was an orphan
-- job with no equipment linkage or no audit entry — and no way to roll back.
--
-- This RPC wraps all three writes in a single Postgres transaction so the
-- caller either gets a fully-stitched job or a clean error with nothing
-- persisted.
--
-- SECURITY INVOKER + GRANT EXECUTE TO authenticated:
--   RLS policies on jobs, equipment_jobs, and activity_log run against the
--   calling user, exactly as if they had issued the INSERTs directly.
--
-- Named parameters (p_* prefix) so the route doesn't depend on positional
-- ordering — adding new optional columns later won't silently break callers.
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_job_from_equipment(
  p_organization_id           UUID,
  p_client_id                 UUID,
  p_site_id                   UUID,
  p_submitted_by              UUID,
  p_status                    TEXT,
  p_priority                  TEXT,
  p_service_date              DATE,
  p_scheduled_time            TIMESTAMPTZ,
  p_scheduled_end_time        TIMESTAMPTZ,
  p_estimated_duration_minutes INT,
  p_scheduled_by              UUID,
  p_assigned_to               UUID,
  p_crew_id                   UUID,
  p_tech_notes                TEXT,
  p_equipment_id              UUID,
  p_log_action                TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_job_id UUID;
BEGIN
  -- 1. Create the job
  INSERT INTO public.jobs (
    organization_id,
    client_id,
    site_id,
    submitted_by,
    status,
    priority,
    service_date,
    scheduled_time,
    scheduled_end_time,
    estimated_duration_minutes,
    scheduled_by,
    assigned_to,
    crew_id,
    tech_notes
  )
  VALUES (
    p_organization_id,
    p_client_id,
    p_site_id,
    p_submitted_by,
    p_status,
    p_priority,
    p_service_date,
    p_scheduled_time,
    p_scheduled_end_time,
    p_estimated_duration_minutes,
    p_scheduled_by,
    p_assigned_to,
    p_crew_id,
    p_tech_notes
  )
  RETURNING id INTO v_new_job_id;

  -- 2. Link the equipment
  INSERT INTO public.equipment_jobs (equipment_id, job_id)
  VALUES (p_equipment_id, v_new_job_id);

  -- 3. Audit trail
  INSERT INTO public.activity_log (
    organization_id,
    user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  VALUES (
    p_organization_id,
    p_submitted_by,
    p_log_action,
    'job',
    v_new_job_id,
    jsonb_build_object(
      'from_equipment_id', p_equipment_id,
      'scheduled_time',    p_scheduled_time,
      'assigned_to',       p_assigned_to,
      'crew_id',           p_crew_id
    )
  );

  RETURN v_new_job_id;
END;
$$;

-- Authenticated app users (the only role the API ever runs as) may call this.
GRANT EXECUTE ON FUNCTION public.create_job_from_equipment(
  UUID, UUID, UUID, UUID, TEXT, TEXT, DATE, TIMESTAMPTZ, TIMESTAMPTZ,
  INT, UUID, UUID, UUID, TEXT, UUID, TEXT
) TO authenticated;
