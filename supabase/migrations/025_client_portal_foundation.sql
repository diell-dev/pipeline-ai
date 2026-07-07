-- ============================================================
-- Migration 025: Client portal foundation (Phase 0)
--
-- 1. Link a login to a client company (users.client_id, role='client').
-- 2. get_user_client_id() RLS helper.
-- 3. service_requests table ("request more work").
-- 4. Client-scoped SELECT policies (own clients/sites/jobs/invoices/
--    proposals + line items + signatures).
-- 5. THE ISOLATION SWEEP: exclude the client role from every org-wide
--    read policy so a client can ONLY see rows via the narrow policies
--    in (4). Two techniques:
--      - RESTRICTIVE "block client read" on tables clients never touch.
--      - wrap the broad staff SELECT policy with `AND role <> 'client'`
--        on tables where clients get a narrow view.
-- ============================================================

-- ── 1. users.client_id ───────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE CASCADE;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_client_link_ck;
ALTER TABLE users ADD CONSTRAINT users_client_link_ck CHECK (
  (role = 'client'  AND client_id IS NOT NULL) OR
  (role <> 'client' AND client_id IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_users_client ON users(client_id) WHERE client_id IS NOT NULL;

-- ── 2. get_user_client_id() helper ───────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_client_id()
RETURNS UUID
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$ SELECT client_id FROM public.users WHERE id = auth.uid() $$;
REVOKE EXECUTE ON FUNCTION public.get_user_client_id() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_client_id() TO authenticated;

-- ── 3. service_requests table ────────────────────────────────
CREATE TABLE IF NOT EXISTS service_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  site_id UUID REFERENCES sites(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  details TEXT,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','emergency')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_review','converted','declined','closed')),
  preferred_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_service_requests_org ON service_requests(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_requests_client ON service_requests(client_id) WHERE deleted_at IS NULL;
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view service requests" ON service_requests FOR SELECT USING (
  is_super_admin() OR (organization_id = get_user_org_id()
    AND get_user_role() IN ('owner','office_manager','field_tech'))
);
CREATE POLICY "Staff can manage service requests" ON service_requests FOR ALL USING (
  is_super_admin() OR (organization_id = get_user_org_id()
    AND get_user_role() IN ('owner','office_manager'))
) WITH CHECK (
  is_super_admin() OR (organization_id = get_user_org_id()
    AND get_user_role() IN ('owner','office_manager'))
);
CREATE POLICY "Client can view own service requests" ON service_requests FOR SELECT USING (
  get_user_role() = 'client' AND client_id = get_user_client_id()
);
CREATE POLICY "Client can create own service requests" ON service_requests FOR INSERT WITH CHECK (
  get_user_role() = 'client'
  AND client_id = get_user_client_id()
  AND organization_id = get_user_org_id()
);

-- ── 4. Narrow client-scoped SELECT policies ──────────────────
CREATE POLICY "Client can view own client row" ON clients FOR SELECT USING (
  get_user_role() = 'client' AND id = get_user_client_id()
);
CREATE POLICY "Client can view own sites" ON sites FOR SELECT USING (
  get_user_role() = 'client' AND client_id = get_user_client_id()
);
CREATE POLICY "Client can view own jobs" ON jobs FOR SELECT USING (
  get_user_role() = 'client'
  AND client_id = get_user_client_id()
  AND status IN ('scheduled','sent','completed')
);
CREATE POLICY "Client can view own job lines" ON job_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_line_items.job_id
    AND j.client_id = get_user_client_id()
    AND get_user_role() = 'client'
    AND j.status IN ('scheduled','sent','completed'))
);
CREATE POLICY "Client can view own invoices" ON invoices FOR SELECT USING (
  get_user_role() = 'client'
  AND client_id = get_user_client_id()
  AND status <> 'draft' AND deleted_at IS NULL
);
CREATE POLICY "Client can view own invoice lines" ON invoice_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items.invoice_id
    AND i.client_id = get_user_client_id()
    AND get_user_role() = 'client'
    AND i.status <> 'draft' AND i.deleted_at IS NULL)
);
CREATE POLICY "Client can view own proposals" ON proposals FOR SELECT USING (
  get_user_role() = 'client'
  AND client_id = get_user_client_id()
  AND deleted_at IS NULL
  AND status IN ('sent_to_client','client_approved','client_rejected','converted_to_job')
);
CREATE POLICY "Client can view own proposal lines" ON proposal_line_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_line_items.proposal_id
    AND p.client_id = get_user_client_id()
    AND get_user_role() = 'client'
    AND p.status IN ('sent_to_client','client_approved','client_rejected','converted_to_job'))
);
CREATE POLICY "Client can view own proposal signatures" ON proposal_signatures FOR SELECT USING (
  EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_signatures.proposal_id
    AND p.client_id = get_user_client_id()
    AND get_user_role() = 'client')
);

-- ── 5a. Wrap the broad staff SELECT policies to exclude client ──
-- (These tables also grant clients a narrow view above; the broad
--  policy must not ALSO leak the whole org to them.)
DROP POLICY IF EXISTS "Org members can view clients" ON clients;
CREATE POLICY "Org members can view clients" ON clients FOR SELECT USING (
  ((organization_id = get_user_org_id()) OR is_super_admin()) AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "Org members can view sites" ON sites;
CREATE POLICY "Org members can view sites" ON sites FOR SELECT USING (
  ((organization_id = get_user_org_id()) OR is_super_admin()) AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "Staff can view invoices" ON invoices;
CREATE POLICY "Staff can view invoices" ON invoices FOR SELECT USING (
  ((organization_id = get_user_org_id()) OR is_super_admin()) AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "Books: members can view inv lines" ON invoice_line_items;
CREATE POLICY "Books: members can view inv lines" ON invoice_line_items FOR SELECT USING (
  (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_line_items.invoice_id
    AND ((i.organization_id = get_user_org_id()) OR is_super_admin())))
  AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "Org members can view proposals" ON proposals;
CREATE POLICY "Org members can view proposals" ON proposals FOR SELECT USING (
  (is_super_admin() OR ((organization_id = get_user_org_id()) AND (deleted_at IS NULL)))
  AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "View proposal lines" ON proposal_line_items;
CREATE POLICY "View proposal lines" ON proposal_line_items FOR SELECT USING (
  (is_super_admin() OR (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_line_items.proposal_id
    AND p.organization_id = get_user_org_id())))
  AND get_user_role() <> 'client'
);
DROP POLICY IF EXISTS "View proposal signatures" ON proposal_signatures;
CREATE POLICY "View proposal signatures" ON proposal_signatures FOR SELECT USING (
  (is_super_admin() OR (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_signatures.proposal_id
    AND p.organization_id = get_user_org_id())))
  AND get_user_role() <> 'client'
);

-- ── 5b. RESTRICTIVE "block client read" on tables clients never see ──
-- Restrictive policies AND-combine with permissive ones, so this blocks
-- the client role from every existing read policy on these tables without
-- rewriting them. (jobs / job_line_items already deny clients by role, but
-- these tables had bare org-wide read policies.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'activity_log','crews','crew_members','equipment','equipment_categories',
    'equipment_inspections','equipment_jobs','equipment_qr_batches','equipment_qr_codes',
    'equipment_scans','equipment_service_requests','service_catalog','recurring_job_schedules',
    'users','vendors','items','tax_rates','chart_of_accounts','expense_categories',
    'accounting_periods','bookkeeping_number_sequences','client_pricing_overrides','equipment_catalog'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'portal_block_client_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO public USING (public.get_user_role() <> ''client'')',
      'portal_block_client_read', t
    );
  END LOOP;
END $$;
