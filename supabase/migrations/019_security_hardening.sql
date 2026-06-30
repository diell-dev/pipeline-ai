-- ============================================================
-- Migration 019: Security hardening
-- Addresses Supabase advisor findings (Jun 2026 audit):
--   ERROR: equipment_catalog had RLS disabled (public read/write)
--   INFO:  client_pricing_overrides had RLS on but no policies (was locked)
--   WARN:  13 functions had mutable search_path (now pinned)
--   WARN:  7 SECURITY DEFINER functions exposed to anon (now revoked)
--
-- Remaining advisor items NOT in this migration (intentional or
-- dashboard-only):
--   - Auth: enable leaked-password protection in Supabase dashboard
--     (Auth → Settings → Password protection).
--   - Public buckets (company-assets, equipment-photos, job-photos,
--     qr-batches) have broad SELECT policies — narrow them in the
--     Supabase Storage dashboard if you need to prevent listing.
--   - authenticated_security_definer_function_executable remains
--     for our RLS helpers (get_user_org_id, get_user_role, etc.) —
--     they MUST be SECURITY DEFINER + callable by authenticated to
--     work inside RLS policies. This is by design.
-- ============================================================

-- ── 1) equipment_catalog: cross-tenant AI learning catalog ──
ALTER TABLE public.equipment_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "equipment_catalog: authenticated can read" ON public.equipment_catalog;
CREATE POLICY "equipment_catalog: authenticated can read"
  ON public.equipment_catalog FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE public.equipment_catalog IS
  'Cross-tenant AI learning catalog. Read-only to authenticated; writes via service role only.';

-- ── 2) client_pricing_overrides: scope via clients.organization_id ──
DROP POLICY IF EXISTS "client_pricing_overrides: org members can read" ON public.client_pricing_overrides;
CREATE POLICY "client_pricing_overrides: org members can read"
  ON public.client_pricing_overrides FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_pricing_overrides.client_id
        AND (c.organization_id = public.get_user_org_id() OR public.is_super_admin())
    )
  );

DROP POLICY IF EXISTS "client_pricing_overrides: staff can manage" ON public.client_pricing_overrides;
CREATE POLICY "client_pricing_overrides: staff can manage"
  ON public.client_pricing_overrides FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_pricing_overrides.client_id
        AND ((c.organization_id = public.get_user_org_id()
              AND public.get_user_role() IN ('owner', 'office_manager'))
             OR public.is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = client_pricing_overrides.client_id
        AND ((c.organization_id = public.get_user_org_id()
              AND public.get_user_role() IN ('owner', 'office_manager'))
             OR public.is_super_admin())
    )
  );

-- ── 3) Pin search_path on functions ──
ALTER FUNCTION public.prevent_user_self_escalation() SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_org_billing_fields() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_org_id() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_user_role() SET search_path = public, pg_temp;
ALTER FUNCTION public.books_apply_payment_delta(text, uuid, bigint) SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_equipment_org_matches_site() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_jobs_org_matches_site() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_jobs_org_matches_client() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_invoices_org_matches_client() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_invoices_org_matches_job() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_proposals_org_matches_client() SET search_path = public, pg_temp;
ALTER FUNCTION public.enforce_proposals_org_matches_site() SET search_path = public, pg_temp;

-- ── 4) Revoke EXECUTE from anon on SECURITY DEFINER functions ──
REVOKE EXECUTE ON FUNCTION public.get_user_org_id() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_books_sequence(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_chart_of_accounts(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.books_apply_payment_delta(text, uuid, bigint) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_user_self_escalation() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_org_billing_fields() FROM anon, PUBLIC;

-- Keep authenticated grant on RLS helpers + the books posting RPCs
GRANT EXECUTE ON FUNCTION public.get_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_books_sequence(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_chart_of_accounts(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.books_apply_payment_delta(text, uuid, bigint) TO authenticated;
