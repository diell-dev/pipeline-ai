-- ============================================================
-- Pipeline AI — Initial Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ORGANIZATIONS (multi-tenant root)
-- ============================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'basic' CHECK (tier IN ('basic', 'professional', 'business')),

  -- Branding
  logo_url TEXT,
  primary_color TEXT NOT NULL DEFAULT '#05093d',
  accent_color TEXT NOT NULL DEFAULT '#00ff85',
  secondary_color TEXT DEFAULT '#0d06ff',

  -- Limits (denormalized from tier for fast access)
  max_users INTEGER NOT NULL DEFAULT 2,
  max_ai_generations_per_month INTEGER NOT NULL DEFAULT 50,
  storage_limit_gb INTEGER NOT NULL DEFAULT 5,

  -- Billing
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- USERS (extends Supabase Auth)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'field_tech' CHECK (role IN ('super_admin', 'owner', 'office_manager', 'field_tech', 'client')),
  phone TEXT,
  avatar_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(organization_id);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(organization_id, role);

-- ============================================================
-- CLIENTS (CRM)
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'commercial' CHECK (client_type IN ('property_mgmt', 'landlord', 'commercial', 'residential', 'contractor')),
  primary_contact_name TEXT NOT NULL,
  primary_contact_phone TEXT,
  primary_contact_email TEXT,
  billing_contact_name TEXT,
  billing_contact_email TEXT,
  billing_address TEXT,
  payment_terms TEXT NOT NULL DEFAULT 'net_30' CHECK (payment_terms IN ('on_receipt', 'net_15', 'net_30', 'net_60', 'custom')),
  service_contract_type TEXT NOT NULL DEFAULT 'one_time' CHECK (service_contract_type IN ('one_time', 'recurring', 'emergency')),
  insurance_coi_on_file BOOLEAN NOT NULL DEFAULT false,
  insurance_expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_clients_org ON clients(organization_id);
CREATE INDEX idx_clients_active ON clients(organization_id) WHERE deleted_at IS NULL;

-- ============================================================
-- SITES (nested under clients)
-- ============================================================
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  borough TEXT,
  site_type TEXT NOT NULL DEFAULT 'commercial' CHECK (site_type IN ('residential', 'commercial', 'industrial', 'mixed_use')),
  unit_count INTEGER,
  access_instructions TEXT,
  drain_types JSONB NOT NULL DEFAULT '[]',
  pipe_material TEXT NOT NULL DEFAULT 'unknown' CHECK (pipe_material IN ('cast_iron', 'pvc', 'clay', 'copper', 'unknown')),
  known_issues TEXT,
  equipment_notes TEXT,
  reference_photos JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_sites_client ON sites(client_id);
CREATE INDEX idx_sites_org ON sites(organization_id);
CREATE INDEX idx_sites_active ON sites(organization_id) WHERE deleted_at IS NULL;

-- ============================================================
-- SERVICE CATALOG
-- ============================================================
CREATE TABLE service_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'flat_rate' CHECK (unit IN ('per_drain', 'per_line', 'per_trap', 'flat_rate', 'hourly')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, code)
);

CREATE INDEX idx_service_catalog_org ON service_catalog(organization_id);

-- ============================================================
-- CLIENT PRICING OVERRIDES
-- ============================================================
CREATE TABLE client_pricing_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_catalog_id UUID NOT NULL REFERENCES service_catalog(id) ON DELETE CASCADE,
  custom_price DECIMAL(10, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, service_catalog_id)
);

-- ============================================================
-- JOBS
-- ============================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'ai_generating', 'pending_review', 'approved',
    'sent', 'revision_requested', 'revised', 'rejected'
  )),
  service_date DATE NOT NULL DEFAULT CURRENT_DATE,
  tech_notes TEXT,
  photos JSONB NOT NULL DEFAULT '[]',
  ai_report_content JSONB,
  ai_invoice_content JSONB,
  report_pdf_url TEXT,
  invoice_pdf_url TEXT,
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  rejection_notes TEXT,
  revision_request TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_org ON jobs(organization_id);
CREATE INDEX idx_jobs_status ON jobs(organization_id, status);
CREATE INDEX idx_jobs_client ON jobs(client_id);
CREATE INDEX idx_jobs_site ON jobs(site_id);
CREATE INDEX idx_jobs_submitted_by ON jobs(submitted_by);
CREATE INDEX idx_jobs_service_date ON jobs(organization_id, service_date DESC);

-- ============================================================
-- JOB LINE ITEMS
-- ============================================================
CREATE TABLE job_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  service_catalog_id UUID NOT NULL REFERENCES service_catalog(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  total_price DECIMAL(10, 2) NOT NULL,
  notes TEXT
);

CREATE INDEX idx_job_line_items_job ON job_line_items(job_id);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  invoice_number TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  tax_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'void')),
  due_date DATE NOT NULL,
  paid_date DATE,
  paid_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('check', 'ach', 'wire', 'cash', 'other')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, invoice_number)
);

CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(organization_id, status);
CREATE INDEX idx_invoices_due ON invoices(organization_id, due_date) WHERE status NOT IN ('paid', 'void');

-- ============================================================
-- BANK TRANSACTIONS (for payment matching)
-- ============================================================
CREATE TABLE bank_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  upload_batch_id UUID NOT NULL,
  transaction_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  matched_invoice_id UUID REFERENCES invoices(id),
  match_confidence DECIMAL(3, 2),
  match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched', 'suggested', 'confirmed', 'rejected')),
  raw_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bank_tx_org ON bank_transactions(organization_id);
CREATE INDEX idx_bank_tx_batch ON bank_transactions(upload_batch_id);
CREATE INDEX idx_bank_tx_unmatched ON bank_transactions(organization_id) WHERE match_status = 'unmatched';

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_org ON activity_log(organization_id, created_at DESC);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);

-- ============================================================
-- AUTO-UPDATE updated_at TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_sites_updated BEFORE UPDATE ON sites FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_service_catalog_updated BEFORE UPDATE ON service_catalog FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_client_pricing_updated BEFORE UPDATE ON client_pricing_overrides FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

-- Helper function: get the current user's organization_id
CREATE OR REPLACE FUNCTION auth.user_org_id()
RETURNS UUID AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: get the current user's role
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ORGANIZATIONS: users can only see their own org
CREATE POLICY "Users can view own org" ON organizations
  FOR SELECT USING (id = auth.user_org_id());

-- USERS: see users in same org
CREATE POLICY "Users can view org members" ON users
  FOR SELECT USING (organization_id = auth.user_org_id());

-- USERS: only owner/admin can insert
CREATE POLICY "Admins can insert users" ON users
  FOR INSERT WITH CHECK (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner')
  );

-- USERS: can update own profile
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- USERS: admins can update any user in org
CREATE POLICY "Admins can update org users" ON users
  FOR UPDATE USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner')
  );

-- CLIENTS: org-scoped
CREATE POLICY "Org members can view clients" ON clients
  FOR SELECT USING (organization_id = auth.user_org_id());

CREATE POLICY "Staff can insert clients" ON clients
  FOR INSERT WITH CHECK (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner', 'office_manager')
  );

CREATE POLICY "Staff can update clients" ON clients
  FOR UPDATE USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- SITES: org-scoped
CREATE POLICY "Org members can view sites" ON sites
  FOR SELECT USING (organization_id = auth.user_org_id());

CREATE POLICY "Staff can manage sites" ON sites
  FOR ALL USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- SERVICE CATALOG: org-scoped, everyone can read
CREATE POLICY "Org members can view services" ON service_catalog
  FOR SELECT USING (organization_id = auth.user_org_id());

CREATE POLICY "Admins can manage services" ON service_catalog
  FOR ALL USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner')
  );

-- CLIENT PRICING: linked through client org
CREATE POLICY "Staff can view pricing" ON client_pricing_overrides
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id AND c.organization_id = auth.user_org_id()
    )
  );

CREATE POLICY "Admins can manage pricing" ON client_pricing_overrides
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_id AND c.organization_id = auth.user_org_id()
    )
    AND auth.user_role() IN ('super_admin', 'owner')
  );

-- JOBS: org-scoped, field techs see own only
CREATE POLICY "Staff can view all jobs" ON jobs
  FOR SELECT USING (
    organization_id = auth.user_org_id()
    AND (
      auth.user_role() IN ('super_admin', 'owner', 'office_manager')
      OR submitted_by = auth.uid()
    )
  );

CREATE POLICY "Users can create jobs" ON jobs
  FOR INSERT WITH CHECK (
    organization_id = auth.user_org_id()
    AND submitted_by = auth.uid()
  );

CREATE POLICY "Staff can update jobs" ON jobs
  FOR UPDATE USING (
    organization_id = auth.user_org_id()
    AND (
      auth.user_role() IN ('super_admin', 'owner', 'office_manager')
      OR (submitted_by = auth.uid() AND status = 'submitted')
    )
  );

-- JOB LINE ITEMS: through job org
CREATE POLICY "View job line items" ON job_line_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_id AND j.organization_id = auth.user_org_id()
    )
  );

CREATE POLICY "Manage job line items" ON job_line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM jobs j
      WHERE j.id = job_id AND j.organization_id = auth.user_org_id()
    )
  );

-- INVOICES: org-scoped
CREATE POLICY "Staff can view invoices" ON invoices
  FOR SELECT USING (organization_id = auth.user_org_id());

CREATE POLICY "Staff can manage invoices" ON invoices
  FOR ALL USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner', 'office_manager')
  );

-- BANK TRANSACTIONS: owner/admin only
CREATE POLICY "Admins can view bank transactions" ON bank_transactions
  FOR SELECT USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner')
  );

CREATE POLICY "Admins can manage bank transactions" ON bank_transactions
  FOR ALL USING (
    organization_id = auth.user_org_id()
    AND auth.user_role() IN ('super_admin', 'owner')
  );

-- ACTIVITY LOG: org-scoped read
CREATE POLICY "Org members can view activity" ON activity_log
  FOR SELECT USING (organization_id = auth.user_org_id());

CREATE POLICY "System can insert activity" ON activity_log
  FOR INSERT WITH CHECK (organization_id = auth.user_org_id());

-- ============================================================
-- SEED DATA: Initial organizations and users
-- NOTE: The user records reference auth.users IDs.
-- After running this migration, create the auth users in Supabase
-- Dashboard (Authentication > Users), then run the seed below
-- with the correct UUIDs.
-- ============================================================

-- Pipeline AI (PBA's own org — super admin level)
INSERT INTO organizations (id, name, slug, tier, primary_color, accent_color, secondary_color, max_users, max_ai_generations_per_month, storage_limit_gb)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Pipeline AI',
  'pipeline-ai',
  'business',
  '#05093d',
  '#00ff85',
  '#0d06ff',
  15, 0, 100
);

-- New York Sewer & Drain (Bogdan's org)
INSERT INTO organizations (id, name, slug, tier, primary_color, accent_color, secondary_color, max_users, max_ai_generations_per_month, storage_limit_gb)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'New York Sewer & Drain',
  'nysd',
  'professional',
  '#1a365d',
  '#3182ce',
  '#2b6cb0',
  5, 0, 25
);

-- NOTE: After creating auth users in Supabase Dashboard, run:
--
-- INSERT INTO users (id, organization_id, email, full_name, role) VALUES
--   ('<diell-auth-uuid>', 'a0000000-0000-0000-0000-000000000001', 'diell@polarbearagency.com', 'Diell Grazhdani', 'super_admin'),
--   ('<bogdan-auth-uuid>', 'b0000000-0000-0000-0000-000000000001', 'natan@nysewerdrain.com', 'Bogdan May', 'owner');
