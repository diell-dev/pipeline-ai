-- ============================================================
-- Pipeline AI — Bookkeeping Module (Books Foundation)
-- Migration 015: Schema + master data for the US GAAP-compliant
-- double-entry accounting layer. Business-tier feature.
--
-- Owner / scope: Agent B1 — schema only.
--   - NO posting logic (Agent B2)
--   - NO UI (Agent B3)
--   - NO reports (Agent B4)
--   - NO Stripe wiring (Agent B5)
--   - NO journal-entry backfill for legacy invoices (Agent B6)
--
-- Design highlights:
--   * Multi-tenant via organization_id + RLS on every new table,
--     mirroring the pattern in 001 / 002 / 008.
--   * USD only for v1 but every monetary table carries currency
--     CHAR(3) DEFAULT 'USD' so multi-currency is purely data later.
--   * Amounts in BIGINT cents to avoid float drift. Display layer
--     converts to dollars.
--   * Soft-delete (deleted_at TIMESTAMPTZ) on every domain table.
--     A future trigger (B2) will auto-reverse the journal entry on
--     soft-delete — stubbed below with a TODO comment.
--   * Per-org sequence numbers (invoice_number, bill_number,
--     journal_entry_number, payment_number) generated server-side;
--     uniqueness enforced via (organization_id, *_number) indexes.
--   * Trial-balance enforcement: trigger after journal_entry_lines
--     write checks SUM(debit) = SUM(credit) on the parent entry.
--   * Period locks: accounting_periods.is_locked guards posting/edit;
--     a journal_entries trigger refuses writes when the containing
--     period is locked.
--   * Existing invoices + job_line_items extended in place — no data
--     loss. NYSD's 12 invoices migrate via backfill at the bottom of
--     this file (computed subtotal/tax/total in cents).
--   * payments table backfilled from invoices.paid_amount/paid_date/
--     payment_method so the single paid NYSD invoice (#012) gets a
--     proper payment row.
-- ============================================================

-- ============================================================
-- 0. PER-ORG SEQUENCE HELPER (used by 4 transactional tables)
-- ============================================================
-- A single small table that gives every org its own sequence pools
-- for invoice/bill/journal-entry/payment numbers. Locks-per-row
-- give us atomic next-value semantics inside a transaction.
CREATE TABLE IF NOT EXISTS bookkeeping_number_sequences (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_kind  TEXT NOT NULL CHECK (sequence_kind IN (
    'invoice', 'bill', 'journal_entry', 'payment', 'estimate', 'credit_note'
  )),
  next_value     BIGINT NOT NULL DEFAULT 1,
  prefix         TEXT NOT NULL DEFAULT '',
  pad_width      INT  NOT NULL DEFAULT 5,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, sequence_kind)
);

ALTER TABLE bookkeeping_number_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read own sequences"
  ON bookkeeping_number_sequences
  FOR SELECT USING (
    organization_id = public.get_user_org_id()
    OR public.is_super_admin()
  );

CREATE POLICY "Staff can manage own sequences"
  ON bookkeeping_number_sequences
  FOR ALL USING (
    (organization_id = public.get_user_org_id()
     AND public.get_user_role() IN ('owner', 'office_manager'))
    OR public.is_super_admin()
  ) WITH CHECK (
    (organization_id = public.get_user_org_id()
     AND public.get_user_role() IN ('owner', 'office_manager'))
    OR public.is_super_admin()
  );

CREATE TRIGGER trg_bookkeeping_number_sequences_updated
  BEFORE UPDATE ON bookkeeping_number_sequences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- next_books_sequence(): atomic claim of the next number for an org.
-- Returns the formatted number string (prefix + zero-padded counter).
-- B2 will call this from posting helpers; reads/writes happen via
-- SECURITY DEFINER so RLS doesn't reject it.
CREATE OR REPLACE FUNCTION public.next_books_sequence(
  p_org_id UUID,
  p_kind TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next   BIGINT;
  v_prefix TEXT;
  v_pad    INT;
BEGIN
  -- Upsert the row if missing so callers don't have to initialize.
  INSERT INTO bookkeeping_number_sequences (organization_id, sequence_kind)
    VALUES (p_org_id, p_kind)
    ON CONFLICT (organization_id, sequence_kind) DO NOTHING;

  UPDATE bookkeeping_number_sequences
    SET next_value = next_value + 1,
        updated_at = NOW()
    WHERE organization_id = p_org_id AND sequence_kind = p_kind
    RETURNING next_value - 1, prefix, pad_width INTO v_next, v_prefix, v_pad;

  RETURN v_prefix || LPAD(v_next::TEXT, v_pad, '0');
END;
$$;

COMMENT ON FUNCTION public.next_books_sequence(UUID, TEXT) IS
  'Atomic per-org per-kind sequence claim for invoice/bill/journal-entry/payment numbers. Returns prefix + zero-padded counter (e.g. "JE-00042"). Posting engine (B2) is the primary caller.';

-- ============================================================
-- 1. CHART OF ACCOUNTS
-- ============================================================
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  subtype TEXT NOT NULL CHECK (subtype IN (
    'current_asset', 'non_current_asset', 'contra_asset', 'fixed_asset', 'accounts_receivable', 'bank', 'cash',
    'current_liability', 'long_term_liability', 'accounts_payable',
    'equity', 'retained_earnings', 'contra_equity',
    'operating_income', 'other_income', 'contra_revenue',
    'cogs', 'operating_expense', 'other_expense', 'depreciation_expense'
  )),
  parent_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, code)
);

CREATE INDEX idx_chart_of_accounts_org ON chart_of_accounts(organization_id);
CREATE INDEX idx_chart_of_accounts_org_type ON chart_of_accounts(organization_id, type);
CREATE INDEX idx_chart_of_accounts_active ON chart_of_accounts(organization_id) WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX idx_chart_of_accounts_parent ON chart_of_accounts(parent_account_id) WHERE parent_account_id IS NOT NULL;

COMMENT ON TABLE chart_of_accounts IS 'Per-org chart of accounts. is_system rows are seeded and cannot be deleted (only deactivated / renamed).';

-- ============================================================
-- 2. VENDORS (who we pay — distinct from clients who pay us)
-- ============================================================
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  tax_id TEXT,                                -- EIN/SSN/W-9 number
  w9_on_file BOOLEAN NOT NULL DEFAULT FALSE,
  is_1099_vendor BOOLEAN NOT NULL DEFAULT FALSE,
  payment_terms_days INT NOT NULL DEFAULT 30,
  default_expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_vendors_org ON vendors(organization_id);
CREATE INDEX idx_vendors_active ON vendors(organization_id) WHERE deleted_at IS NULL AND is_active = TRUE;

-- ============================================================
-- 3. TAX RATES
-- ============================================================
CREATE TABLE tax_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                                  -- e.g. "NYC Sales Tax 8.875%"
  rate_pct NUMERIC(7, 4) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  tax_authority_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_compound BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_tax_rates_org ON tax_rates(organization_id);
CREATE INDEX idx_tax_rates_active ON tax_rates(organization_id) WHERE deleted_at IS NULL AND is_active = TRUE;

-- ============================================================
-- 4. ITEMS (products / services catalog used in invoices + bills)
-- Note: this lives alongside the existing service_catalog. Items is
-- the bookkeeping-grade catalog with COA wiring; service_catalog is
-- the field-ops catalog. B2/B3 will decide how to bridge them; for
-- now they coexist.
-- ============================================================
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'service' CHECK (type IN ('service', 'product', 'bundle')),
  sku TEXT,
  default_unit_price_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  default_income_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  default_expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  default_tax_rate_id UUID REFERENCES tax_rates(id) ON DELETE SET NULL,
  is_billable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  service_catalog_id UUID REFERENCES service_catalog(id) ON DELETE SET NULL,  -- optional bridge
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_items_org ON items(organization_id);
CREATE INDEX idx_items_active ON items(organization_id) WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE UNIQUE INDEX uniq_items_org_sku ON items(organization_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

-- ============================================================
-- 5. EXPENSE CATEGORIES
-- ============================================================
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_expense_categories_org ON expense_categories(organization_id);

-- ============================================================
-- 6. ACCOUNTING PERIODS (period-lock anchor)
-- ============================================================
CREATE TABLE accounting_periods (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                            -- "January 2026", "FY2026 Q1"
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, start_date),
  CHECK (end_date >= start_date)
);

CREATE INDEX idx_accounting_periods_org ON accounting_periods(organization_id);
CREATE INDEX idx_accounting_periods_range ON accounting_periods(organization_id, start_date, end_date);
CREATE INDEX idx_accounting_periods_locked ON accounting_periods(organization_id) WHERE is_locked = TRUE;

COMMENT ON TABLE accounting_periods IS
  'Calendar fences. Once is_locked = TRUE, the period_lock_guard trigger refuses INSERT/UPDATE/DELETE on journal_entries with entry_date inside the range.';

-- ============================================================
-- 7. JOURNAL ENTRIES + LINES (the GL backbone)
-- ============================================================
CREATE TABLE journal_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_number TEXT NOT NULL,                    -- generated server-side via next_books_sequence()
  entry_date DATE NOT NULL,
  posted_at TIMESTAMPTZ,                         -- NULL = draft; non-null = posted
  description TEXT,
  reference TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN (
    'manual', 'invoice', 'bill', 'payment', 'expense', 'bank_transaction',
    'opening_balance', 'reversal', 'depreciation', 'adjustment'
  )),
  source_id UUID,                                -- FK by convention (table varies); no DB FK
  reversal_of_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  period_id UUID REFERENCES accounting_periods(id) ON DELETE SET NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate_to_base NUMERIC(20, 10) NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, entry_number)
);

CREATE INDEX idx_journal_entries_org_date ON journal_entries(organization_id, entry_date DESC);
CREATE INDEX idx_journal_entries_source ON journal_entries(organization_id, source_type, source_id);
CREATE INDEX idx_journal_entries_period ON journal_entries(period_id) WHERE period_id IS NOT NULL;
CREATE INDEX idx_journal_entries_posted ON journal_entries(organization_id, posted_at) WHERE posted_at IS NOT NULL;
CREATE INDEX idx_journal_entries_active ON journal_entries(organization_id) WHERE deleted_at IS NULL;

CREATE TABLE journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  debit_cents BIGINT NOT NULL DEFAULT 0,
  credit_cents BIGINT NOT NULL DEFAULT 0,
  description TEXT,
  line_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (debit_cents >= 0 AND credit_cents >= 0),
  CHECK ((debit_cents > 0 AND credit_cents = 0) OR (debit_cents = 0 AND credit_cents > 0))
);

CREATE INDEX idx_jel_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_jel_account ON journal_entry_lines(account_id);

COMMENT ON TABLE journal_entry_lines IS
  'GL line items. Each line is one-sided (debit XOR credit). Trial balance enforced via trg_jel_trial_balance.';

-- ─── Trial-balance enforcement trigger ────────────────────────
-- Fires AFTER any line-level write and ensures the parent entry
-- balances. Skips entries whose parent is in draft (posted_at IS
-- NULL) OR being deleted (entry row is gone). B2 owns the posting
-- pipeline; this protects the invariant regardless of caller.
CREATE OR REPLACE FUNCTION public.enforce_journal_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
  v_total_debit BIGINT;
  v_total_credit BIGINT;
  v_posted_at TIMESTAMPTZ;
  v_exists BOOLEAN;
BEGIN
  v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  SELECT TRUE, posted_at INTO v_exists, v_posted_at
    FROM journal_entries WHERE id = v_entry_id;

  -- Parent already gone (cascade delete): nothing to enforce.
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Drafts are allowed to be out-of-balance while being built.
  IF v_posted_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(debit_cents), 0), COALESCE(SUM(credit_cents), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines WHERE journal_entry_id = v_entry_id;

  IF v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'Journal entry % is out of balance: debits=% credits=%',
      v_entry_id, v_total_debit, v_total_credit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_jel_trial_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_journal_entry_balance();

-- ─── Period-lock guard on journal_entries ─────────────────────
-- Reject INSERT/UPDATE/DELETE on a posted journal entry whose
-- entry_date falls inside a locked accounting_period. Drafts are
-- exempt (posted_at IS NULL).
CREATE OR REPLACE FUNCTION public.guard_locked_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry_date DATE;
  v_org UUID;
  v_was_posted BOOLEAN;
  v_will_post  BOOLEAN;
  v_is_locked BOOLEAN;
BEGIN
  -- INSERT / UPDATE: use NEW values.
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    v_entry_date := NEW.entry_date;
    v_org := NEW.organization_id;
    v_will_post := NEW.posted_at IS NOT NULL;
  END IF;

  -- DELETE: use OLD values.
  IF TG_OP = 'DELETE' THEN
    v_entry_date := OLD.entry_date;
    v_org := OLD.organization_id;
    v_will_post := OLD.posted_at IS NOT NULL;
  END IF;

  -- Drafts are always allowed.
  IF v_will_post = FALSE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Block if any locked period contains entry_date.
  SELECT EXISTS (
    SELECT 1 FROM accounting_periods ap
    WHERE ap.organization_id = v_org
      AND ap.is_locked = TRUE
      AND v_entry_date BETWEEN ap.start_date AND ap.end_date
  ) INTO v_is_locked;

  IF v_is_locked THEN
    RAISE EXCEPTION 'Cannot modify a posted journal entry inside a locked accounting period (% for org %)',
      v_entry_date, v_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_je_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_period();

-- TODO (B2 — posting engine): on soft-delete of a posted entry
-- (deleted_at set), automatically insert a mirror "reversal" entry
-- in the next open period with reversal_of_id pointing back. The
-- trigger lives in B2 because it needs to invoke next_books_sequence
-- and pick the destination period. Stub left here as a marker.

-- ============================================================
-- 8. EXTEND invoices (PA already has 12 NYSD rows — ALTER, never DROP)
-- ============================================================

-- 8a. Add new columns. Defaults make the ALTER zero-downtime.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS invoice_date DATE,
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS exchange_rate_to_base_currency NUMERIC(20, 10) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS subtotal_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_type TEXT NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent', 'fixed_amount', 'none')),
  ADD COLUMN IF NOT EXISTS discount_value NUMERIC(15, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_terms_text TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_days INT,
  ADD COLUMN IF NOT EXISTS notes_for_customer TEXT,
  ADD COLUMN IF NOT EXISTS notes_internal TEXT,
  ADD COLUMN IF NOT EXISTS footer_text TEXT,
  ADD COLUMN IF NOT EXISTS terms_and_conditions TEXT,
  ADD COLUMN IF NOT EXISTS attachment_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_number TEXT,
  ADD COLUMN IF NOT EXISTS branch_id UUID;

-- 8b. Backfill the new monetary columns from existing values.
--   subtotal_cents     = amount * 100
--   tax_amount_cents   = tax_amount * 100
--   total_cents        = total_amount * 100
--   amount_paid_cents  = paid_amount * 100
--   invoice_date       = COALESCE(created_at::date)
UPDATE invoices
   SET subtotal_cents    = COALESCE(ROUND(amount * 100)::BIGINT, 0),
       tax_amount_cents  = COALESCE(ROUND(tax_amount * 100)::BIGINT, 0),
       total_cents       = COALESCE(ROUND(total_amount * 100)::BIGINT, 0),
       amount_paid_cents = COALESCE(ROUND(paid_amount * 100)::BIGINT, 0),
       invoice_date      = COALESCE(invoice_date, created_at::date),
       updated_at        = updated_at  -- avoid bumping the trigger; same value
 WHERE TRUE;

-- 8c. After backfill, make invoice_date NOT NULL with a sane default.
ALTER TABLE invoices
  ALTER COLUMN invoice_date SET DEFAULT CURRENT_DATE,
  ALTER COLUMN invoice_date SET NOT NULL;

-- 8d. balance_due_cents — generated column. Add only after backfill,
-- since generated columns require all referenced columns to exist.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS balance_due_cents BIGINT
    GENERATED ALWAYS AS (total_cents - amount_paid_cents) STORED;

COMMENT ON COLUMN invoices.amount IS
  'LEGACY DECIMAL. Source of truth is now subtotal_cents (BIGINT, post-migration 015). Keep in sync via posting engine until B6 retires the legacy columns.';
COMMENT ON COLUMN invoices.total_amount IS
  'LEGACY DECIMAL. Source of truth is now total_cents.';
COMMENT ON COLUMN invoices.tax_amount IS
  'LEGACY DECIMAL. Source of truth is now tax_amount_cents.';
COMMENT ON COLUMN invoices.paid_amount IS
  'LEGACY DECIMAL. Source of truth is now amount_paid_cents. Future payments funnel through the payments table.';

CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(organization_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_balance ON invoices(organization_id, balance_due_cents)
  WHERE balance_due_cents > 0 AND deleted_at IS NULL;

-- ============================================================
-- 9. EXTEND job_line_items (acts as PA's invoice-line-items)
-- ============================================================
-- PA does not have a separate invoice_line_items table — invoice line
-- items live on job_line_items via invoices.job_id. We extend in
-- place so the bookkeeping engine can wire each line to an income
-- account + tax rate + item.
ALTER TABLE job_line_items
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_rate_id UUID REFERENCES tax_rates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(7, 4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_taxable BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS line_number INT,
  ADD COLUMN IF NOT EXISTS unit_price_cents BIGINT,
  ADD COLUMN IF NOT EXISTS total_price_cents BIGINT;

-- Backfill cents columns from existing decimal values.
UPDATE job_line_items
   SET unit_price_cents  = COALESCE(ROUND(unit_price  * 100)::BIGINT, 0),
       total_price_cents = COALESCE(ROUND(total_price * 100)::BIGINT, 0)
 WHERE unit_price_cents IS NULL OR total_price_cents IS NULL;

COMMENT ON COLUMN job_line_items.unit_price IS
  'LEGACY DECIMAL. Source of truth is now unit_price_cents (migration 015).';
COMMENT ON COLUMN job_line_items.total_price IS
  'LEGACY DECIMAL. Source of truth is now total_price_cents (migration 015).';

-- ============================================================
-- 10. BILLS (AP — bills from vendors)
-- ============================================================
CREATE TABLE bills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  bill_number TEXT,                                  -- vendor's number on their invoice
  internal_number TEXT NOT NULL,                     -- our sequence (next_books_sequence)
  reference TEXT,
  bill_date DATE NOT NULL,
  due_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate_to_base_currency NUMERIC(20, 10) NOT NULL DEFAULT 1,
  subtotal_cents BIGINT NOT NULL DEFAULT 0,
  discount_type TEXT NOT NULL DEFAULT 'none'
    CHECK (discount_type IN ('percent', 'fixed_amount', 'none')),
  discount_value NUMERIC(15, 4) NOT NULL DEFAULT 0,
  discount_amount_cents BIGINT NOT NULL DEFAULT 0,
  tax_amount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  amount_paid_cents BIGINT NOT NULL DEFAULT 0,
  balance_due_cents BIGINT GENERATED ALWAYS AS (total_cents - amount_paid_cents) STORED,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'open', 'partially_paid', 'paid', 'void'
  )),
  payment_terms_text TEXT,
  payment_terms_days INT,
  notes TEXT,
  attachment_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  locked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, internal_number)
);

CREATE INDEX idx_bills_org ON bills(organization_id);
CREATE INDEX idx_bills_vendor ON bills(vendor_id);
CREATE INDEX idx_bills_status ON bills(organization_id, status);
CREATE INDEX idx_bills_due ON bills(organization_id, due_date) WHERE status NOT IN ('paid', 'void');
CREATE INDEX idx_bills_balance ON bills(organization_id, balance_due_cents)
  WHERE balance_due_cents > 0 AND deleted_at IS NULL;
CREATE INDEX idx_bills_active ON bills(organization_id) WHERE deleted_at IS NULL;

CREATE TABLE bill_line_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT, -- expense being debited
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

CREATE INDEX idx_bill_line_items_bill ON bill_line_items(bill_id);
CREATE INDEX idx_bill_line_items_account ON bill_line_items(account_id);

-- ============================================================
-- 11. EXPENSES (one-off, receipts, reimbursables)
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL,
  vendor_name_text TEXT,                              -- when vendor_id IS NULL
  description TEXT,
  expense_category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  expense_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  payment_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL, -- cash/cc/bank from which paid
  amount_cents BIGINT NOT NULL DEFAULT 0,
  tax_amount_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate_to_base_currency NUMERIC(20, 10) NOT NULL DEFAULT 1,
  receipt_url TEXT,
  paid_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_reimbursable BOOLEAN NOT NULL DEFAULT FALSE,
  is_reimbursed BOOLEAN NOT NULL DEFAULT FALSE,
  reimbursed_at TIMESTAMPTZ,
  is_billable BOOLEAN NOT NULL DEFAULT FALSE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  notes TEXT,
  attachment_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_expenses_org ON expenses(organization_id);
CREATE INDEX idx_expenses_date ON expenses(organization_id, expense_date DESC);
CREATE INDEX idx_expenses_vendor ON expenses(vendor_id) WHERE vendor_id IS NOT NULL;
CREATE INDEX idx_expenses_reimbursable ON expenses(organization_id)
  WHERE is_reimbursable = TRUE AND is_reimbursed = FALSE AND deleted_at IS NULL;
CREATE INDEX idx_expenses_active ON expenses(organization_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 12. PAYMENTS (NEW — split out from invoice columns)
-- ============================================================
CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  payment_number TEXT NOT NULL,                       -- next_books_sequence('payment')
  reference TEXT,
  type TEXT NOT NULL DEFAULT 'invoice_payment' CHECK (type IN (
    'invoice_payment', 'bill_payment', 'refund', 'transfer'
  )),
  source_type TEXT NOT NULL DEFAULT 'invoice' CHECK (source_type IN (
    'invoice', 'bill', 'manual', 'stripe', 'bank', 'backfill'
  )),
  source_id UUID,                                     -- invoice_id / bill_id when applicable
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  exchange_rate_to_base_currency NUMERIC(20, 10) NOT NULL DEFAULT 1,
  payment_method TEXT NOT NULL CHECK (payment_method IN (
    'cash', 'check', 'ach', 'wire', 'credit_card', 'debit_card', 'stripe', 'other'
  )),
  payment_method_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  deposit_to_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (organization_id, payment_number)
);

CREATE INDEX idx_payments_org ON payments(organization_id);
CREATE INDEX idx_payments_date ON payments(organization_id, payment_date DESC);
CREATE INDEX idx_payments_source ON payments(organization_id, source_type, source_id);
CREATE INDEX idx_payments_active ON payments(organization_id) WHERE deleted_at IS NULL;

-- ============================================================
-- 13. BANK ACCOUNTS
-- ============================================================
CREATE TABLE bank_accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                                 -- "Chase Business Checking"
  type TEXT NOT NULL CHECK (type IN (
    'checking', 'savings', 'credit_card', 'cash', 'paypal', 'stripe', 'other'
  )),
  chart_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
  account_number_last4 TEXT,
  bank_name TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  opening_balance_cents BIGINT NOT NULL DEFAULT 0,
  opening_balance_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_bank_accounts_org ON bank_accounts(organization_id);
CREATE INDEX idx_bank_accounts_active ON bank_accounts(organization_id) WHERE deleted_at IS NULL AND is_active = TRUE;

-- ============================================================
-- 14. BANK RECONCILIATIONS  (defined before bank_transactions for FK)
-- ============================================================
CREATE TABLE bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  statement_date DATE NOT NULL,
  statement_balance_cents BIGINT NOT NULL,
  reconciled_balance_cents BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed')),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_bank_recon_org ON bank_reconciliations(organization_id);
CREATE INDEX idx_bank_recon_bank ON bank_reconciliations(bank_account_id);

-- ============================================================
-- 15. BANK TRANSACTIONS (the books-grade table)
-- Note: the existing bank_transactions table from 001 is a CSV
-- staging table for invoice-payment matching. To avoid shaping
-- chaos, we keep it untouched and add a parallel
-- `bookkeeping_bank_transactions` table here. Future agent (B4 or
-- B5) can decide whether to merge.
-- ============================================================
CREATE TABLE bookkeeping_bank_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  txn_date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,        -- positive = deposit, negative = withdrawal
  running_balance_cents BIGINT,
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'posted'
    CHECK (status IN ('pending', 'posted', 'reconciled', 'void')),
  reconciliation_id UUID REFERENCES bank_reconciliations(id) ON DELETE SET NULL,
  matched_payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  matched_journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv_import', 'plaid')),
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_bkbtx_org ON bookkeeping_bank_transactions(organization_id);
CREATE INDEX idx_bkbtx_account ON bookkeeping_bank_transactions(bank_account_id, txn_date DESC);
CREATE INDEX idx_bkbtx_status ON bookkeeping_bank_transactions(organization_id, status);
CREATE INDEX idx_bkbtx_unreconciled ON bookkeeping_bank_transactions(bank_account_id)
  WHERE status IN ('pending', 'posted') AND deleted_at IS NULL;

-- ============================================================
-- 16. AUTO-UPDATE TRIGGERS
-- ============================================================
CREATE TRIGGER trg_chart_of_accounts_updated BEFORE UPDATE ON chart_of_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_tax_rates_updated BEFORE UPDATE ON tax_rates FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expense_categories_updated BEFORE UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_accounting_periods_updated BEFORE UPDATE ON accounting_periods FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_journal_entries_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bills_updated BEFORE UPDATE ON bills FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bank_accounts_updated BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bank_reconciliations_updated BEFORE UPDATE ON bank_reconciliations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bookkeeping_bank_transactions_updated BEFORE UPDATE ON bookkeeping_bank_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 17. RLS — ENABLE + POLICIES
-- Pattern (mirrors 001/002/008):
--   SELECT  : org members OR super_admin
--   INSERT  : owner / office_manager / super_admin
--   UPDATE  : owner / office_manager / super_admin
--   DELETE  : owner / super_admin (most cases)
-- Period locking is enforced separately by trg_je_period_lock and by
-- app-layer checks. Authorization to LOCK a period itself sits at
-- the permission layer (bookkeeping:lock_period) — not enforceable in
-- RLS without leaking role-checks into the policy body, so DB
-- writes here only check the broader bookkeeping write set.
-- ============================================================
ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_bank_transactions ENABLE ROW LEVEL SECURITY;

-- ─── chart_of_accounts ────────────────────────────────────────
CREATE POLICY "Books: members can view COA" ON chart_of_accounts FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can insert COA" ON chart_of_accounts FOR INSERT
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());
CREATE POLICY "Books: staff can update COA" ON chart_of_accounts FOR UPDATE
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());
CREATE POLICY "Books: staff can delete COA" ON chart_of_accounts FOR DELETE
  USING (((organization_id = public.get_user_org_id()
           AND public.get_user_role() = 'owner')
          OR public.is_super_admin())
         AND is_system = FALSE);

-- ─── vendors ──────────────────────────────────────────────────
CREATE POLICY "Books: members can view vendors" ON vendors FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can insert vendors" ON vendors FOR INSERT
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());
CREATE POLICY "Books: staff can update vendors" ON vendors FOR UPDATE
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());
CREATE POLICY "Books: staff can delete vendors" ON vendors FOR DELETE
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() = 'owner')
         OR public.is_super_admin());

-- ─── tax_rates ────────────────────────────────────────────────
CREATE POLICY "Books: members can view tax_rates" ON tax_rates FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage tax_rates" ON tax_rates FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── items ────────────────────────────────────────────────────
CREATE POLICY "Books: members can view items" ON items FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage items" ON items FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── expense_categories ───────────────────────────────────────
CREATE POLICY "Books: members can view exp_cat" ON expense_categories FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage exp_cat" ON expense_categories FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── accounting_periods ───────────────────────────────────────
CREATE POLICY "Books: members can view periods" ON accounting_periods FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage periods" ON accounting_periods FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── journal_entries / lines ──────────────────────────────────
CREATE POLICY "Books: members can view JE" ON journal_entries FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage JE" ON journal_entries FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

CREATE POLICY "Books: members can view JE lines" ON journal_entry_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_entry_id
      AND (je.organization_id = public.get_user_org_id() OR public.is_super_admin())
  ));
CREATE POLICY "Books: staff can manage JE lines" ON journal_entry_lines FOR ALL
  USING (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_entry_id
      AND ((je.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_entry_id
      AND ((je.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ));

-- ─── bills + lines ────────────────────────────────────────────
CREATE POLICY "Books: members can view bills" ON bills FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage bills" ON bills FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

CREATE POLICY "Books: members can view bill lines" ON bill_line_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM bills b
    WHERE b.id = bill_id
      AND (b.organization_id = public.get_user_org_id() OR public.is_super_admin())
  ));
CREATE POLICY "Books: staff can manage bill lines" ON bill_line_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM bills b
    WHERE b.id = bill_id
      AND ((b.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM bills b
    WHERE b.id = bill_id
      AND ((b.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ));

-- ─── expenses ─────────────────────────────────────────────────
CREATE POLICY "Books: members can view expenses" ON expenses FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage expenses" ON expenses FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── payments ─────────────────────────────────────────────────
CREATE POLICY "Books: members can view payments" ON payments FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage payments" ON payments FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── bank_accounts ────────────────────────────────────────────
CREATE POLICY "Books: members can view bank_accounts" ON bank_accounts FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage bank_accounts" ON bank_accounts FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── bank_reconciliations ─────────────────────────────────────
CREATE POLICY "Books: members can view recons" ON bank_reconciliations FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage recons" ON bank_reconciliations FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ─── bookkeeping_bank_transactions ────────────────────────────
CREATE POLICY "Books: members can view bk_btx" ON bookkeeping_bank_transactions FOR SELECT
  USING (organization_id = public.get_user_org_id() OR public.is_super_admin());
CREATE POLICY "Books: staff can manage bk_btx" ON bookkeeping_bank_transactions FOR ALL
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin())
  WITH CHECK ((organization_id = public.get_user_org_id()
               AND public.get_user_role() IN ('owner','office_manager'))
              OR public.is_super_admin());

-- ============================================================
-- 18. SEED — Standard US small-business chart of accounts
-- Called for an org via SELECT public.seed_default_chart_of_accounts(uuid).
-- Idempotent: skips codes that already exist.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  INSERT INTO chart_of_accounts (organization_id, code, name, type, subtype, is_system)
  VALUES
    -- Assets
    (p_org_id, '1000', 'Cash on Hand',              'asset',     'cash',                  TRUE),
    (p_org_id, '1010', 'Operating Bank Account',    'asset',     'bank',                  TRUE),
    (p_org_id, '1020', 'Savings Account',           'asset',     'bank',                  TRUE),
    (p_org_id, '1100', 'Accounts Receivable',       'asset',     'accounts_receivable',   TRUE),
    (p_org_id, '1200', 'Inventory',                 'asset',     'current_asset',         TRUE),
    (p_org_id, '1300', 'Prepaid Expenses',          'asset',     'current_asset',         TRUE),
    (p_org_id, '1400', 'Equipment',                 'asset',     'fixed_asset',           TRUE),
    (p_org_id, '1410', 'Accumulated Depreciation',  'asset',     'contra_asset',          TRUE),

    -- Liabilities
    (p_org_id, '2000', 'Accounts Payable',          'liability', 'accounts_payable',      TRUE),
    (p_org_id, '2100', 'Credit Card Payable',       'liability', 'current_liability',     TRUE),
    (p_org_id, '2200', 'Sales Tax Payable',         'liability', 'current_liability',     TRUE),
    (p_org_id, '2300', 'Payroll Taxes Payable',     'liability', 'current_liability',     TRUE),
    (p_org_id, '2400', 'Notes Payable',             'liability', 'long_term_liability',   TRUE),

    -- Equity
    (p_org_id, '3000', 'Owner''s Equity',           'equity',    'equity',                TRUE),
    (p_org_id, '3100', 'Retained Earnings',         'equity',    'retained_earnings',     TRUE),
    (p_org_id, '3200', 'Owner''s Drawings',         'equity',    'contra_equity',         TRUE),

    -- Income
    (p_org_id, '4000', 'Service Revenue',           'income',    'operating_income',      TRUE),
    (p_org_id, '4100', 'Product Sales',             'income',    'operating_income',      TRUE),
    (p_org_id, '4200', 'Other Income',              'income',    'other_income',          TRUE),
    (p_org_id, '4900', 'Sales Returns',             'income',    'contra_revenue',        TRUE),

    -- COGS
    (p_org_id, '5000', 'Cost of Goods Sold',        'expense',   'cogs',                  TRUE),
    (p_org_id, '5100', 'Materials',                 'expense',   'cogs',                  TRUE),
    (p_org_id, '5200', 'Subcontractors',            'expense',   'cogs',                  TRUE),

    -- Operating Expenses
    (p_org_id, '6000', 'Salaries',                  'expense',   'operating_expense',     TRUE),
    (p_org_id, '6100', 'Rent',                      'expense',   'operating_expense',     TRUE),
    (p_org_id, '6200', 'Utilities',                 'expense',   'operating_expense',     TRUE),
    (p_org_id, '6300', 'Insurance',                 'expense',   'operating_expense',     TRUE),
    (p_org_id, '6400', 'Vehicle',                   'expense',   'operating_expense',     TRUE),
    (p_org_id, '6500', 'Fuel',                      'expense',   'operating_expense',     TRUE),
    (p_org_id, '6600', 'Tools & Equipment',         'expense',   'operating_expense',     TRUE),
    (p_org_id, '6700', 'Office Supplies',           'expense',   'operating_expense',     TRUE),
    (p_org_id, '6800', 'Professional Fees',         'expense',   'operating_expense',     TRUE),
    (p_org_id, '6900', 'Marketing',                 'expense',   'operating_expense',     TRUE),
    (p_org_id, '7000', 'Software & Subscriptions',  'expense',   'operating_expense',     TRUE),
    (p_org_id, '7100', 'Bank Fees',                 'expense',   'operating_expense',     TRUE),
    (p_org_id, '7200', 'Depreciation',              'expense',   'depreciation_expense',  TRUE),
    (p_org_id, '7300', 'Repairs & Maintenance',     'expense',   'operating_expense',     TRUE),
    (p_org_id, '7900', 'Miscellaneous',             'expense',   'operating_expense',     TRUE)
  ON CONFLICT (organization_id, code) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION public.seed_default_chart_of_accounts(UUID) IS
  'Seeds 38 standard US small-business accounts (is_system=true) for a given organization. Idempotent. Call once when an org enables bookkeeping.';

-- ============================================================
-- 19. PAYMENTS BACKFILL — port existing invoice payment columns
-- into the new payments table for every invoice with paid_amount > 0.
-- ============================================================
DO $$
DECLARE
  v_inv RECORD;
  v_count INT := 0;
BEGIN
  FOR v_inv IN
    SELECT id, organization_id, paid_amount, paid_date, payment_method, invoice_number, currency
    FROM invoices
    WHERE paid_amount > 0
      AND deleted_at IS NULL
  LOOP
    -- Use next_books_sequence for proper per-org numbering. The
    -- function bumps the sequence and returns the formatted string.
    INSERT INTO payments (
      organization_id, payment_date, payment_number, reference,
      type, source_type, source_id,
      amount_cents, currency, payment_method,
      payment_method_details, notes
    )
    VALUES (
      v_inv.organization_id,
      COALESCE(v_inv.paid_date, CURRENT_DATE),
      public.next_books_sequence(v_inv.organization_id, 'payment'),
      'Backfilled from invoice ' || v_inv.invoice_number,
      'invoice_payment',
      'backfill',
      v_inv.id,
      ROUND(v_inv.paid_amount * 100)::BIGINT,
      COALESCE(v_inv.currency, 'USD'),
      COALESCE(v_inv.payment_method, 'other'),
      '{}'::jsonb,
      'Auto-created by migration 015 from legacy invoice payment columns.'
    );
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled % payment row(s) from existing invoices.', v_count;
END
$$;

-- ============================================================
-- 20. SUMMARY COMMENTS
-- ============================================================
COMMENT ON COLUMN invoices.balance_due_cents IS
  'Generated: total_cents - amount_paid_cents. Replaces the historic derived "balance" UI calc.';
COMMENT ON COLUMN bills.balance_due_cents IS
  'Generated: total_cents - amount_paid_cents.';

-- End of migration 015_books_foundation.
