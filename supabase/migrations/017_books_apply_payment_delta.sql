-- Migration 017: books_apply_payment_delta
--
-- Atomic increment/decrement of a source row's amount_paid_cents
-- (with status recompute) for invoice and bill rows. Used by:
--   - /api/books/payments POST (positive delta when a manual payment is created)
--   - /api/books/payments/[id] DELETE (negative delta when a payment is voided)
--   - /api/stripe/webhook (positive delta on checkout.session.completed)
--
-- Replaces unsafe read-modify-write blocks that could race when two
-- payments hit the same invoice/bill concurrently. The single UPDATE
-- is atomic at the row level — Postgres holds the row lock for the
-- duration of the statement, so concurrent calls serialize.
--
-- Conventions:
--   - p_amount_delta_cents > 0 = payment added (e.g. POST)
--   - p_amount_delta_cents < 0 = payment removed (e.g. DELETE / void)
--   - amount_paid_cents is clamped to >= 0 (defensive — a void should
--     never push it below zero in practice, but better to clamp than
--     to leave a negative balance lying around).
--
-- Status transitions:
--   invoice:
--     amount_paid >= total           → paid
--     amount_paid in (0, total)      → partially_paid
--     amount_paid <= 0 AND was paid/partially_paid → sent (revert)
--     otherwise → leave status alone (preserve draft, void, etc.)
--   bill:
--     amount_paid >= total           → paid
--     amount_paid in (0, total)      → partially_paid
--     amount_paid <= 0 AND was paid/partially_paid → open (revert)
--     otherwise → leave status alone

CREATE OR REPLACE FUNCTION books_apply_payment_delta(
  p_source_type TEXT,
  p_source_id UUID,
  p_amount_delta_cents BIGINT
) RETURNS VOID AS $$
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION books_apply_payment_delta(TEXT, UUID, BIGINT) IS
  'Atomically increment/decrement a source row''s amount_paid_cents and recompute status. Use a positive delta to apply a payment, a negative delta to void one.';
