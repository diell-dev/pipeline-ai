-- ============================================================
-- Migration 021: Audit fix C2 — keep invoice money columns in sync
--
-- Migration 015 declared *_cents the source of truth but only ran a
-- one-time backfill. The legacy job -> AI -> invoice path
-- (/api/jobs/[id]/generate) writes ONLY the decimal columns
-- (amount / tax_amount / total_amount / paid_amount), so every
-- invoice created since 015 has total_cents = 0 and renders as
-- $0.00 in the cents-based lists and never posts to the ledger.
--
-- Fix: a BEFORE INSERT/UPDATE trigger that fills whichever side is
-- zero from the non-zero side (never overwrites a populated value),
-- so decimal-writers and cents-writers both end up consistent.
-- Then backfill existing rows.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_invoice_money()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- subtotal  (decimal: amount)  <->  subtotal_cents
  IF COALESCE(NEW.subtotal_cents, 0) = 0 AND COALESCE(NEW.amount, 0) <> 0 THEN
    NEW.subtotal_cents := ROUND(NEW.amount * 100)::BIGINT;
  ELSIF COALESCE(NEW.amount, 0) = 0 AND COALESCE(NEW.subtotal_cents, 0) <> 0 THEN
    NEW.amount := NEW.subtotal_cents / 100.0;
  END IF;

  -- tax  (decimal: tax_amount)  <->  tax_amount_cents
  IF COALESCE(NEW.tax_amount_cents, 0) = 0 AND COALESCE(NEW.tax_amount, 0) <> 0 THEN
    NEW.tax_amount_cents := ROUND(NEW.tax_amount * 100)::BIGINT;
  ELSIF COALESCE(NEW.tax_amount, 0) = 0 AND COALESCE(NEW.tax_amount_cents, 0) <> 0 THEN
    NEW.tax_amount := NEW.tax_amount_cents / 100.0;
  END IF;

  -- total  (decimal: total_amount)  <->  total_cents
  IF COALESCE(NEW.total_cents, 0) = 0 AND COALESCE(NEW.total_amount, 0) <> 0 THEN
    NEW.total_cents := ROUND(NEW.total_amount * 100)::BIGINT;
  ELSIF COALESCE(NEW.total_amount, 0) = 0 AND COALESCE(NEW.total_cents, 0) <> 0 THEN
    NEW.total_amount := NEW.total_cents / 100.0;
  END IF;

  -- amount paid  (decimal: paid_amount)  <->  amount_paid_cents
  IF COALESCE(NEW.amount_paid_cents, 0) = 0 AND COALESCE(NEW.paid_amount, 0) <> 0 THEN
    NEW.amount_paid_cents := ROUND(NEW.paid_amount * 100)::BIGINT;
  ELSIF COALESCE(NEW.paid_amount, 0) = 0 AND COALESCE(NEW.amount_paid_cents, 0) <> 0 THEN
    NEW.paid_amount := NEW.amount_paid_cents / 100.0;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_sync_money ON invoices;
CREATE TRIGGER trg_invoices_sync_money
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_invoice_money();

-- ── Backfill existing rows (both directions) ─────────────────
UPDATE invoices SET
  subtotal_cents = CASE WHEN COALESCE(subtotal_cents,0)=0 AND COALESCE(amount,0)<>0
                        THEN ROUND(amount*100)::BIGINT ELSE subtotal_cents END,
  tax_amount_cents = CASE WHEN COALESCE(tax_amount_cents,0)=0 AND COALESCE(tax_amount,0)<>0
                        THEN ROUND(tax_amount*100)::BIGINT ELSE tax_amount_cents END,
  total_cents = CASE WHEN COALESCE(total_cents,0)=0 AND COALESCE(total_amount,0)<>0
                        THEN ROUND(total_amount*100)::BIGINT ELSE total_cents END,
  amount_paid_cents = CASE WHEN COALESCE(amount_paid_cents,0)=0 AND COALESCE(paid_amount,0)<>0
                        THEN ROUND(paid_amount*100)::BIGINT ELSE amount_paid_cents END,
  amount = CASE WHEN COALESCE(amount,0)=0 AND COALESCE(subtotal_cents,0)<>0
                        THEN subtotal_cents/100.0 ELSE amount END,
  tax_amount = CASE WHEN COALESCE(tax_amount,0)=0 AND COALESCE(tax_amount_cents,0)<>0
                        THEN tax_amount_cents/100.0 ELSE tax_amount END,
  total_amount = CASE WHEN COALESCE(total_amount,0)=0 AND COALESCE(total_cents,0)<>0
                        THEN total_cents/100.0 ELSE total_amount END,
  paid_amount = CASE WHEN COALESCE(paid_amount,0)=0 AND COALESCE(amount_paid_cents,0)<>0
                        THEN amount_paid_cents/100.0 ELSE paid_amount END
WHERE (COALESCE(subtotal_cents,0)=0    AND COALESCE(amount,0)<>0)
   OR (COALESCE(tax_amount_cents,0)=0  AND COALESCE(tax_amount,0)<>0)
   OR (COALESCE(total_cents,0)=0       AND COALESCE(total_amount,0)<>0)
   OR (COALESCE(amount_paid_cents,0)=0 AND COALESCE(paid_amount,0)<>0)
   OR (COALESCE(amount,0)=0            AND COALESCE(subtotal_cents,0)<>0)
   OR (COALESCE(tax_amount,0)=0        AND COALESCE(tax_amount_cents,0)<>0)
   OR (COALESCE(total_amount,0)=0      AND COALESCE(total_cents,0)<>0)
   OR (COALESCE(paid_amount,0)=0       AND COALESCE(amount_paid_cents,0)<>0);
