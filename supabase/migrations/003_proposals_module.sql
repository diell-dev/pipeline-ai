-- ============================================================
-- Pipeline AI — Proposals / Estimates Module
-- Migration 003: First-visit estimate workflow.
-- Tech captures → admin approves → client e-signs → converts to job.
-- ============================================================

-- 1. PROPOSALS TABLE
CREATE TABLE proposals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id),
  site_id UUID REFERENCES sites(id),
  created_by UUID NOT NULL REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),

  proposal_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_admin_approval', 'admin_approved', 'sent_to_client',
    'client_approved', 'client_rejected', 'converted_to_job', 'expired', 'cancelled'
  )),

  -- Internal fields (not visible to client)
  measurements TEXT,
  material_list JSONB DEFAULT '[]'::jsonb,
  material_cost_total NUMERIC DEFAULT 0,
  estimated_hours NUMERIC,
  num_techs_needed INT DEFAULT 1,
  estimated_days INT DEFAULT 1,
  equipment_list TEXT[] DEFAULT '{}',
  internal_notes TEXT,

  -- Client-facing fields
  issue_description TEXT NOT NULL,
  proposed_solution TEXT NOT NULL,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  discount_reason TEXT,
  tax_rate NUMERIC NOT NULL DEFAULT 8.875,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,

  -- Workflow timestamps
  submitted_for_approval_at TIMESTAMPTZ,
  admin_approved_at TIMESTAMPTZ,
  admin_approved_by UUID REFERENCES users(id),
  sent_to_client_at TIMESTAMPTZ,
  sent_to_client_by UUID REFERENCES users(id),
  client_approved_at TIMESTAMPTZ,
  client_rejected_at TIMESTAMPTZ,
  client_rejection_reason TEXT,
  converted_to_job_id UUID REFERENCES jobs(id),
  converted_at TIMESTAMPTZ,

  -- Public sign URL token (random, for client-facing /proposals/sign/[token])
  public_token TEXT UNIQUE,

  valid_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_proposals_org ON proposals(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_proposals_client ON proposals(client_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_proposals_status ON proposals(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_proposals_token ON proposals(public_token) WHERE public_token IS NOT NULL;
CREATE UNIQUE INDEX idx_proposals_number ON proposals(organization_id, proposal_number);

-- 2. PROPOSAL LINE ITEMS
CREATE TABLE proposal_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  service_catalog_id UUID REFERENCES service_catalog(id),
  service_name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'flat_rate',
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_proposal_lines ON proposal_line_items(proposal_id);

-- 3. SIGNATURE AUDIT TRAIL
CREATE TABLE proposal_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_by_name TEXT NOT NULL,
  signed_by_email TEXT NOT NULL,
  signed_by_title TEXT,
  signature_data TEXT,                -- base64 png of drawn signature OR typed name
  signature_type TEXT NOT NULL CHECK (signature_type IN ('drawn', 'typed')),
  ip_address TEXT,
  user_agent TEXT
);
CREATE INDEX idx_signatures_proposal ON proposal_signatures(proposal_id);

-- 4. LINK JOBS BACK TO ORIGINATING PROPOSAL
ALTER TABLE jobs ADD COLUMN proposal_id UUID REFERENCES proposals(id);
CREATE INDEX idx_jobs_proposal ON jobs(proposal_id) WHERE proposal_id IS NOT NULL;

-- 5. AUTO-UPDATE TRIGGER
CREATE TRIGGER trg_proposals_updated BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 6. ROW LEVEL SECURITY
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_signatures ENABLE ROW LEVEL SECURITY;

-- Proposals: org members read, tech+ create, creators+managers update, owners delete
CREATE POLICY "Org members can view proposals" ON proposals FOR SELECT
  USING (organization_id = public.get_user_org_id() AND deleted_at IS NULL);

CREATE POLICY "Field tech and managers can create proposals" ON proposals FOR INSERT
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner', 'office_manager', 'field_tech')
  );

CREATE POLICY "Creators and managers can update proposals" ON proposals FOR UPDATE
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
      OR (created_by = auth.uid() AND status IN ('draft', 'pending_admin_approval'))
    )
  );

CREATE POLICY "Managers can delete proposals" ON proposals FOR DELETE
  USING (
    organization_id = public.get_user_org_id()
    AND public.get_user_role() IN ('super_admin', 'owner')
  );

-- Line items inherit access from parent proposal
CREATE POLICY "View proposal lines" ON proposal_line_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_id AND p.organization_id = public.get_user_org_id()));
CREATE POLICY "Manage proposal lines" ON proposal_line_items FOR ALL
  USING (
    EXISTS (SELECT 1 FROM proposals p
      WHERE p.id = proposal_id
        AND p.organization_id = public.get_user_org_id()
        AND (
          public.get_user_role() IN ('super_admin', 'owner', 'office_manager')
          OR (p.created_by = auth.uid() AND p.status IN ('draft', 'pending_admin_approval'))
        )
    )
  );

CREATE POLICY "View proposal signatures" ON proposal_signatures FOR SELECT
  USING (EXISTS (SELECT 1 FROM proposals p WHERE p.id = proposal_id AND p.organization_id = public.get_user_org_id()));

-- Note: client-facing /proposals/sign/[token] route uses service_role client.
-- It looks up proposal by public_token and inserts signatures bypassing RLS — safe because
-- the route validates the token and proposal status.

COMMENT ON TABLE proposals IS 'First-visit estimates that convert to jobs once client signs. Bogdan feedback round 2 (2026-04-30).';
