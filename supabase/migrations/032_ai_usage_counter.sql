-- ============================================================
-- Migration 032: Audit G7 — meter AI generations per org per month.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_counters (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_month     TEXT NOT NULL,
  kind             TEXT NOT NULL,
  count            BIGINT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_usage_counters_unique UNIQUE (organization_id, period_month, kind),
  CONSTRAINT ai_usage_counters_kind_check
    CHECK (kind IN ('report', 'dictation', 'equipment', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_org_month
  ON ai_usage_counters (organization_id, period_month);

ALTER TABLE ai_usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view AI usage" ON ai_usage_counters;
CREATE POLICY "Org members can view AI usage" ON ai_usage_counters FOR SELECT
  USING (
    public.get_user_role() <> 'client'
    AND (organization_id = public.get_user_org_id() OR public.is_super_admin())
  );

CREATE OR REPLACE FUNCTION public.increment_ai_usage(
  p_org_id UUID,
  p_period TEXT,
  p_kind   TEXT DEFAULT 'other'
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT (public.is_super_admin() OR public.get_user_org_id() = p_org_id) THEN
      RAISE EXCEPTION 'Not authorized to record usage for this organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO ai_usage_counters (organization_id, period_month, kind, count)
    VALUES (p_org_id, p_period, p_kind, 1)
  ON CONFLICT (organization_id, period_month, kind)
    DO UPDATE SET count = ai_usage_counters.count + 1, updated_at = NOW()
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$$;
