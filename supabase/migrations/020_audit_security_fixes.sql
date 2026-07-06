-- ============================================================
-- Migration 020: Audit fixes (2026-07-06) — security hardening
-- Addresses audit findings C1, H6, H7, M8, M2/M13.
--
--   C1  books_apply_payment_delta / next_books_sequence /
--       seed_default_chart_of_accounts were SECURITY DEFINER and
--       GRANTed to `authenticated` with NO caller-org / role check,
--       so any signed-in user of any tenant could call them via
--       /rest/v1/rpc/*. Add in-function caller validation. Service
--       role (webhook) has auth.uid() = NULL and bypasses the check.
--   H6  Books financial SELECT policies granted read to ALL org
--       members; restrict the ledger/AP/payment tables to
--       owner/office_manager/super_admin (matches the API guard).
--   H7  Period-lock guard only checked the NEW date on the JE header
--       and never the lines; extend to OLD+NEW and add a lines guard.
--   M8  office_manager could unlock a locked period via PostgREST;
--       restrict is_locked TRUE->FALSE to owner/super_admin.
--   M2/M13  Concurrent posting could create duplicate journal entries
--       for one source; add a partial unique index.
-- ============================================================

-- ── C1a) books_apply_payment_delta: validate caller ──────────
CREATE OR REPLACE FUNCTION public.books_apply_payment_delta(
  p_source_type TEXT,
  p_source_id UUID,
  p_amount_delta_cents BIGINT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_org UUID;
BEGIN
  -- auth.uid() IS NULL => called with the service role key (Stripe
  -- webhook / server jobs). anon is already REVOKEd, so a non-null
  -- uid is always a real authenticated user we must authorize.
  IF auth.uid() IS NOT NULL THEN
    IF p_source_type = 'invoice' THEN
      SELECT organization_id INTO v_target_org FROM invoices WHERE id = p_source_id;
    ELSIF p_source_type = 'bill' THEN
      SELECT organization_id INTO v_target_org FROM bills WHERE id = p_source_id;
    ELSE
      RAISE EXCEPTION 'Unknown source type %', p_source_type USING ERRCODE = 'check_violation';
    END IF;

    IF v_target_org IS NULL THEN
      RAISE EXCEPTION 'Source % not found', p_source_id USING ERRCODE = 'no_data_found';
    END IF;

    IF NOT (
      public.is_super_admin()
      OR (public.get_user_org_id() = v_target_org
          AND public.get_user_role() IN ('owner','office_manager'))
    ) THEN
      RAISE EXCEPTION 'Not authorized to apply a payment to this %', p_source_type
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF p_source_type = 'invoice' THEN
    UPDATE invoices
      SET amount_paid_cents = GREATEST(0, amount_paid_cents + p_amount_delta_cents),
          status = CASE
            WHEN amount_paid_cents + p_amount_delta_cents <= 0 THEN
              CASE WHEN status IN ('paid','partially_paid') THEN 'sent' ELSE status END
            WHEN amount_paid_cents + p_amount_delta_cents >= total_cents THEN 'paid'
            WHEN amount_paid_cents + p_amount_delta_cents > 0 THEN 'partially_paid'
            ELSE status
          END
      WHERE id = p_source_id AND deleted_at IS NULL;
  ELSIF p_source_type = 'bill' THEN
    UPDATE bills
      SET amount_paid_cents = GREATEST(0, amount_paid_cents + p_amount_delta_cents),
          status = CASE
            WHEN amount_paid_cents + p_amount_delta_cents <= 0 THEN
              CASE WHEN status IN ('paid','partially_paid') THEN 'open' ELSE status END
            WHEN amount_paid_cents + p_amount_delta_cents >= total_cents THEN 'paid'
            WHEN amount_paid_cents + p_amount_delta_cents > 0 THEN 'partially_paid'
            ELSE status
          END
      WHERE id = p_source_id AND deleted_at IS NULL;
  END IF;
END;
$$;

-- ── C1b) next_books_sequence: validate caller org ────────────
CREATE OR REPLACE FUNCTION public.next_books_sequence(
  p_org_id UUID,
  p_kind TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next   BIGINT;
  v_prefix TEXT;
  v_pad    INT;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT (
      public.is_super_admin()
      OR (public.get_user_org_id() = p_org_id
          AND public.get_user_role() IN ('owner','office_manager'))
    ) THEN
      RAISE EXCEPTION 'Not authorized to claim a sequence for this organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

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

-- ── C1c) seed_default_chart_of_accounts: validate caller org ──
CREATE OR REPLACE FUNCTION public.seed_default_chart_of_accounts(p_org_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INT := 0;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT (
      public.is_super_admin()
      OR (public.get_user_org_id() = p_org_id
          AND public.get_user_role() IN ('owner','office_manager'))
    ) THEN
      RAISE EXCEPTION 'Not authorized to seed accounts for this organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO chart_of_accounts (organization_id, code, name, type, subtype, is_system)
  VALUES
    (p_org_id, '1000', 'Cash on Hand',              'asset',     'cash',                  TRUE),
    (p_org_id, '1010', 'Operating Bank Account',    'asset',     'bank',                  TRUE),
    (p_org_id, '1020', 'Savings Account',           'asset',     'bank',                  TRUE),
    (p_org_id, '1100', 'Accounts Receivable',       'asset',     'accounts_receivable',   TRUE),
    (p_org_id, '1200', 'Inventory',                 'asset',     'current_asset',         TRUE),
    (p_org_id, '1300', 'Prepaid Expenses',          'asset',     'current_asset',         TRUE),
    (p_org_id, '1400', 'Equipment',                 'asset',     'fixed_asset',           TRUE),
    (p_org_id, '1410', 'Accumulated Depreciation',  'asset',     'contra_asset',          TRUE),
    (p_org_id, '2000', 'Accounts Payable',          'liability', 'accounts_payable',      TRUE),
    (p_org_id, '2100', 'Credit Card Payable',       'liability', 'current_liability',     TRUE),
    (p_org_id, '2200', 'Sales Tax Payable',         'liability', 'current_liability',     TRUE),
    (p_org_id, '2300', 'Payroll Taxes Payable',     'liability', 'current_liability',     TRUE),
    (p_org_id, '2400', 'Notes Payable',             'liability', 'long_term_liability',   TRUE),
    (p_org_id, '3000', 'Owner''s Equity',           'equity',    'equity',                TRUE),
    (p_org_id, '3100', 'Retained Earnings',         'equity',    'retained_earnings',     TRUE),
    (p_org_id, '3200', 'Owner''s Drawings',         'equity',    'contra_equity',         TRUE),
    (p_org_id, '4000', 'Service Revenue',           'income',    'operating_income',      TRUE),
    (p_org_id, '4100', 'Product Sales',             'income',    'operating_income',      TRUE),
    (p_org_id, '4200', 'Other Income',              'income',    'other_income',          TRUE),
    (p_org_id, '4900', 'Sales Returns',             'income',    'contra_revenue',        TRUE),
    (p_org_id, '5000', 'Cost of Goods Sold',        'expense',   'cogs',                  TRUE),
    (p_org_id, '5100', 'Materials',                 'expense',   'cogs',                  TRUE),
    (p_org_id, '5200', 'Subcontractors',            'expense',   'cogs',                  TRUE),
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

-- ── M2/M13) prevent duplicate journal entries per source ─────
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_active_source
  ON journal_entries (organization_id, source_type, source_id)
  WHERE deleted_at IS NULL
    AND reversal_of_id IS NULL
    AND source_type <> 'manual';

-- ── H7) period-lock guard: check OLD+NEW date on the header ───
CREATE OR REPLACE FUNCTION public.guard_locked_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_locked BOOLEAN;
BEGIN
  -- Block if the entry is (or was) posted and either its OLD or NEW
  -- date lands inside a locked period. Checking OLD as well stops a
  -- posted entry being moved OUT of a locked period.
  SELECT EXISTS (
    SELECT 1 FROM accounting_periods ap
    WHERE ap.is_locked = TRUE
      AND (
        (TG_OP <> 'INSERT' AND OLD.posted_at IS NOT NULL
          AND ap.organization_id = OLD.organization_id
          AND OLD.entry_date BETWEEN ap.start_date AND ap.end_date)
        OR
        (TG_OP <> 'DELETE' AND NEW.posted_at IS NOT NULL
          AND ap.organization_id = NEW.organization_id
          AND NEW.entry_date BETWEEN ap.start_date AND ap.end_date)
      )
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'Cannot modify a posted journal entry inside a locked accounting period'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── H7) period-lock guard on journal_entry_lines ─────────────
CREATE OR REPLACE FUNCTION public.guard_locked_period_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  UUID;
  v_date DATE;
  v_posted TIMESTAMPTZ;
  v_locked BOOLEAN;
BEGIN
  SELECT organization_id, entry_date, posted_at
    INTO v_org, v_date, v_posted
    FROM journal_entries
    WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

  IF v_posted IS NULL THEN
    RETURN COALESCE(NEW, OLD);  -- draft entry: lines always editable
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM accounting_periods ap
    WHERE ap.organization_id = v_org
      AND ap.is_locked = TRUE
      AND v_date BETWEEN ap.start_date AND ap.end_date
  ) INTO v_locked;

  IF v_locked THEN
    RAISE EXCEPTION 'Cannot modify journal entry lines inside a locked accounting period'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_jel_period_lock ON journal_entry_lines;
CREATE TRIGGER trg_jel_period_lock
  BEFORE INSERT OR UPDATE OR DELETE ON journal_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_locked_period_lines();

-- ── M8) only owner / super_admin may unlock a period ─────────
CREATE OR REPLACE FUNCTION public.guard_period_unlock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_locked = TRUE AND NEW.is_locked = FALSE THEN
    IF auth.uid() IS NOT NULL
       AND NOT public.is_super_admin()
       AND public.get_user_role() IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'Only an owner or super_admin can unlock an accounting period'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_periods_unlock ON accounting_periods;
CREATE TRIGGER trg_accounting_periods_unlock
  BEFORE UPDATE ON accounting_periods
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_period_unlock();

-- ── H6) restrict financial SELECT to managers ────────────────
-- Ledger, AP, payments and bank tables carry the actual financials.
-- Match the API guard (bookkeeping:view = owner/office_manager).
DROP POLICY IF EXISTS "Books: members can view JE" ON journal_entries;
CREATE POLICY "Books: managers can view JE" ON journal_entries FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view JE lines" ON journal_entry_lines;
CREATE POLICY "Books: managers can view JE lines" ON journal_entry_lines FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM journal_entries je
    WHERE je.id = journal_entry_id
      AND ((je.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ));

DROP POLICY IF EXISTS "Books: members can view bills" ON bills;
CREATE POLICY "Books: managers can view bills" ON bills FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view bill lines" ON bill_line_items;
CREATE POLICY "Books: managers can view bill lines" ON bill_line_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM bills b
    WHERE b.id = bill_id
      AND ((b.organization_id = public.get_user_org_id()
            AND public.get_user_role() IN ('owner','office_manager'))
           OR public.is_super_admin())
  ));

DROP POLICY IF EXISTS "Books: members can view expenses" ON expenses;
CREATE POLICY "Books: managers can view expenses" ON expenses FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view payments" ON payments;
CREATE POLICY "Books: managers can view payments" ON payments FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view bank_accounts" ON bank_accounts;
CREATE POLICY "Books: managers can view bank_accounts" ON bank_accounts FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view recons" ON bank_reconciliations;
CREATE POLICY "Books: managers can view recons" ON bank_reconciliations FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());

DROP POLICY IF EXISTS "Books: members can view bk_btx" ON bookkeeping_bank_transactions;
CREATE POLICY "Books: managers can view bk_btx" ON bookkeeping_bank_transactions FOR SELECT
  USING ((organization_id = public.get_user_org_id()
          AND public.get_user_role() IN ('owner','office_manager'))
         OR public.is_super_admin());
