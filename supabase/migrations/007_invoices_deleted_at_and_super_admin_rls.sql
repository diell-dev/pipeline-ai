-- ============================================================
-- Pipeline AI — Audit-fix follow-up
-- Migration 007: Two fixes that surfaced after the round-2 deploy.
--
-- 1. invoices.deleted_at column. Several routes (mark-paid, delete,
--    list filters) reference invoices.deleted_at, but the column was
--    never added in migration 001 — so any query with .is('deleted_at', null)
--    would silently fail and the route would return 404 "Invoice not found".
--    This was the cause of the Mark Paid bug.
--
-- 2. super_admin cross-org RLS. Without this, a platform-level super_admin
--    can't see/manage data in tenant orgs they don't formally belong to.
--    That defeats the point of the role. This adds an is_super_admin()
--    helper and patches every org-scoped policy to allow super_admin
--    through.
-- ============================================================

-- 1. invoices.deleted_at
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_invoices_active
  ON invoices(organization_id) WHERE deleted_at IS NULL;

-- 2. is_super_admin() helper
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'super_admin' AND is_active = TRUE
  );
$$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'TRUE when the current authenticated user is an active super_admin. Used in RLS to grant platform-wide access.';

-- 3. Patch all org-scoped policies (full set already applied directly via
--    the Supabase MCP — this file is the source-of-truth record).
-- See the migration's apply log for the full set of DROP/CREATE statements.
