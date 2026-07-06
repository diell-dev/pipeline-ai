-- ============================================================
-- Migration 023: Audit fix H8 — one active invoice per job
--
-- The regenerate bug (unconditional INSERT on every generate) left
-- some jobs with 2+ active invoices, which breaks send/Stripe/books
-- (maybeSingle lookups error on multiple rows). Deduplicate existing
-- rows (keep the most-advanced, earliest invoice per job; void the
-- rest) and add a partial unique index so it can't happen again.
-- The generate route now reuses the existing invoice instead of
-- inserting a duplicate.
-- ============================================================

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY job_id
      ORDER BY CASE status
                 WHEN 'paid' THEN 0
                 WHEN 'partially_paid' THEN 1
                 WHEN 'overdue' THEN 2
                 WHEN 'sent' THEN 3
                 ELSE 4 END,
               created_at ASC
    ) AS rn
  FROM invoices
  WHERE deleted_at IS NULL AND status <> 'void' AND job_id IS NOT NULL
)
UPDATE invoices i
   SET status = 'void', deleted_at = now()
  FROM ranked r
 WHERE i.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_active_job
  ON invoices (job_id)
  WHERE deleted_at IS NULL AND status <> 'void' AND job_id IS NOT NULL;
