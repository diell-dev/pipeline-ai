-- ============================================================
-- Pipeline AI — Audit-fix Phase 1
-- Migration 005: Schema hardening discovered during the round-2
-- code review. Two changes:
--   1. UNIQUE constraint on organizations.stripe_account_id so
--      one Stripe Express account can't be linked to two orgs.
--   2. Add job_line_items.service_name column so custom (non-catalog)
--      services can carry their display name through from a proposal
--      to the converted job (fixes the "convert-to-job drops custom
--      items" bug).
-- ============================================================

-- 1. UNIQUE on stripe_account_id (partial index so NULL is allowed)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_organizations_stripe_account_id
  ON organizations(stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;

-- 2. Add service_name fallback for custom line items
ALTER TABLE job_line_items
  ADD COLUMN IF NOT EXISTS service_name TEXT;

COMMENT ON COLUMN job_line_items.service_name IS
  'Display name for the line item. Required when service_catalog_id is NULL (custom services).';
