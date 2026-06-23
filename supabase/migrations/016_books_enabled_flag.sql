-- ============================================================
-- Pipeline AI — Books module activation flag
-- Migration 016: Adds `books_enabled_at TIMESTAMPTZ` to organizations.
--
-- Purpose:
--   * Lets the UI distinguish orgs that haven't yet run the bookkeeping
--     setup wizard ("Welcome to Books" empty state) from orgs that
--     have ("show full dashboard").
--   * Set by /api/books/setup once the wizard completes its three steps
--     (fiscal year + seed COA + create first period).
--   * NULL = wizard never finished. Non-NULL = books are live.
--
-- Backwards-compatible: defaults NULL, no existing rows touched.
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS books_enabled_at TIMESTAMPTZ;

COMMENT ON COLUMN organizations.books_enabled_at IS
  'Timestamp when the bookkeeping setup wizard completed. NULL until then; once set, the books UI assumes seed_default_chart_of_accounts has been run and at least one accounting_periods row exists.';

-- ============================================================
-- Allow invoices without a backing job (books-mode standalone invoices).
--
-- Historically every invoice was generated from a job (jobs:1 → invoices:N).
-- The new books module lets bookkeepers create invoices that don't
-- correspond to any field-ops job (subscription line, retainer fee,
-- one-off product sale, etc.). Drop NOT NULL on job_id; the FK to jobs
-- stays so DELETE behavior is unchanged.
-- ============================================================
ALTER TABLE invoices ALTER COLUMN job_id DROP NOT NULL;

COMMENT ON COLUMN invoices.job_id IS
  'Optional FK to jobs. Field-ops invoices set this; books-mode standalone invoices created via /books/invoices/new leave it NULL and store line items in invoice_line_items instead.';

-- ============================================================
-- Books-mode invoice line items table.
--
-- Field-ops invoices reuse job_line_items via invoices.job_id. Books-mode
-- invoices (no job) need their own line storage — this is it. The posting
-- engine reads from this table first when invoice.job_id IS NULL, else
-- falls back to job_line_items (see B2 posting.ts).
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  tax_rate_id UUID REFERENCES tax_rates(id) ON DELETE SET NULL,
  description TEXT,
  quantity NUMERIC(15, 4) NOT NULL DEFAULT 1,
  unit_price_cents BIGINT NOT NULL DEFAULT 0,
  discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,
  discount_amount_cents BIGINT NOT NULL DEFAULT 0,
  tax_amount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  is_taxable BOOLEAN NOT NULL DEFAULT FALSE,
  line_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_account ON invoice_line_items(account_id);

ALTER TABLE invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Books: members can view inv lines"
  ON invoice_line_items FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM invoices i WHERE i.id = invoice_id
        AND (i.organization_id = public.get_user_org_id() OR public.is_super_admin())
    )
  );

CREATE POLICY "Books: staff can manage inv lines"
  ON invoice_line_items FOR ALL USING (
    EXISTS (
      SELECT 1 FROM invoices i WHERE i.id = invoice_id
        AND ((i.organization_id = public.get_user_org_id()
              AND public.get_user_role() IN ('owner','office_manager'))
             OR public.is_super_admin())
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices i WHERE i.id = invoice_id
        AND ((i.organization_id = public.get_user_org_id()
              AND public.get_user_role() IN ('owner','office_manager'))
             OR public.is_super_admin())
    )
  );

-- End of migration 016_books_enabled_flag.
