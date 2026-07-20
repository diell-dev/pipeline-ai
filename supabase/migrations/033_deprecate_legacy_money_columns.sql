-- ============================================================
-- Migration 033: Audit G5 — mark the legacy decimal money columns deprecated.
--
-- DELIBERATELY NOT DROPPING THEM (2026-07-20). Rationale:
--   * `trg_invoices_sync_money` (migration 021) keeps decimal <-> cents in
--     lockstep on every write, so the two representations cannot drift. The
--     correctness risk the audit flagged is already neutralised.
--   * ~170 references across 20 files still read the decimal columns,
--     including the PDF generator, Stripe helpers and the proposals module
--     (proposals were never migrated to cents at all — for them decimal is
--     not "legacy", it is the only representation).
--   * Dropping the columns is irreversible and would need all of that
--     migrated in one shot, for zero user-visible benefit.
--
-- So: document the intent in the schema itself, which is what actually stops
-- a future contributor reaching for the wrong column. The physical DROP
-- belongs in its own change, after the readers are migrated and verified.
-- Applied live to zabfuqxjjunsppotfrel on 2026-07-20.
-- ============================================================

COMMENT ON COLUMN invoices.total_amount IS
  'DEPRECATED (audit G5) — legacy NUMERIC mirror of total_cents, kept in sync by trg_invoices_sync_money. Read total_cents in new code; never write this directly.';

COMMENT ON COLUMN invoices.paid_amount IS
  'DEPRECATED (audit G5) — legacy NUMERIC mirror of amount_paid_cents, kept in sync by trg_invoices_sync_money. Read amount_paid_cents in new code; never write this directly.';

COMMENT ON COLUMN invoices.total_cents IS
  'SOURCE OF TRUTH for invoice totals. All money math is integer cents.';

COMMENT ON COLUMN invoices.amount_paid_cents IS
  'SOURCE OF TRUTH for amounts received. All money math is integer cents.';
