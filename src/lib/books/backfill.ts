/**
 * Pipeline AI — Books Backfill (stub for Agent B6)
 *
 * Walks an organization's existing invoices + payments + bills +
 * expenses and creates the journal entries that SHOULD have been
 * created when those rows were originally saved. Idempotent: rows
 * that already have an active entry are skipped via the same
 * `findExistingActiveEntry` check the posting helpers use.
 *
 * B6 will wire this into a one-shot admin action ("Bring books up to
 * date"). Until then it's a building block — callable from a script
 * or an API route once one exists.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  PeriodLockedError,
  PostingError,
  PostingResult,
  postBill,
  postExpense,
  postInvoice,
  postPayment,
} from './posting'

export interface BackfillStats {
  invoices: { posted: number; skipped: number; errors: BackfillError[] }
  payments: { posted: number; skipped: number; errors: BackfillError[] }
  bills: { posted: number; skipped: number; errors: BackfillError[] }
  expenses: { posted: number; skipped: number; errors: BackfillError[] }
}

export interface BackfillError {
  source_id: string
  message: string
  kind: 'period_locked' | 'posting' | 'unknown'
}

interface IdRow {
  id: string
}

/**
 * Run the backfill against an org. `sinceDate` (YYYY-MM-DD) filters
 * to rows on or after that date; omit it to process all history.
 *
 * Errors on a single row are caught and recorded; the backfill keeps
 * going. The caller decides what to do with the per-row error list.
 */
export async function backfillJournalEntriesForOrg(
  supabase: SupabaseClient,
  orgId: string,
  sinceDate?: string
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    invoices: { posted: 0, skipped: 0, errors: [] },
    payments: { posted: 0, skipped: 0, errors: [] },
    bills: { posted: 0, skipped: 0, errors: [] },
    expenses: { posted: 0, skipped: 0, errors: [] },
  }

  await backfillInvoices(supabase, orgId, sinceDate, stats)
  await backfillBills(supabase, orgId, sinceDate, stats)
  await backfillExpenses(supabase, orgId, sinceDate, stats)
  // Payments last so they post AFTER their invoices/bills exist in the GL.
  await backfillPayments(supabase, orgId, sinceDate, stats)

  return stats
}

async function backfillInvoices(
  supabase: SupabaseClient,
  orgId: string,
  sinceDate: string | undefined,
  stats: BackfillStats
): Promise<void> {
  let q = supabase
    .from('invoices')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'draft')
    .gt('total_cents', 0)
  if (sinceDate) {
    q = q.gte('invoice_date', sinceDate)
  }
  const { data, error } = await q.order('invoice_date', { ascending: true })
  if (error) {
    throw new PostingError(`Failed to enumerate invoices for backfill: ${error.message}`)
  }
  for (const row of (data ?? []) as IdRow[]) {
    await tryPost(() => postInvoice(supabase, row.id), row.id, stats.invoices)
  }
}

async function backfillBills(
  supabase: SupabaseClient,
  orgId: string,
  sinceDate: string | undefined,
  stats: BackfillStats
): Promise<void> {
  let q = supabase
    .from('bills')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'draft')
    .gt('total_cents', 0)
  if (sinceDate) {
    q = q.gte('bill_date', sinceDate)
  }
  const { data, error } = await q.order('bill_date', { ascending: true })
  if (error) {
    throw new PostingError(`Failed to enumerate bills for backfill: ${error.message}`)
  }
  for (const row of (data ?? []) as IdRow[]) {
    await tryPost(() => postBill(supabase, row.id), row.id, stats.bills)
  }
}

async function backfillExpenses(
  supabase: SupabaseClient,
  orgId: string,
  sinceDate: string | undefined,
  stats: BackfillStats
): Promise<void> {
  let q = supabase
    .from('expenses')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gt('total_cents', 0)
  if (sinceDate) {
    q = q.gte('expense_date', sinceDate)
  }
  const { data, error } = await q.order('expense_date', { ascending: true })
  if (error) {
    throw new PostingError(`Failed to enumerate expenses for backfill: ${error.message}`)
  }
  for (const row of (data ?? []) as IdRow[]) {
    await tryPost(() => postExpense(supabase, row.id), row.id, stats.expenses)
  }
}

async function backfillPayments(
  supabase: SupabaseClient,
  orgId: string,
  sinceDate: string | undefined,
  stats: BackfillStats
): Promise<void> {
  let q = supabase
    .from('payments')
    .select('id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gt('amount_cents', 0)
  if (sinceDate) {
    q = q.gte('payment_date', sinceDate)
  }
  const { data, error } = await q.order('payment_date', { ascending: true })
  if (error) {
    throw new PostingError(`Failed to enumerate payments for backfill: ${error.message}`)
  }
  for (const row of (data ?? []) as IdRow[]) {
    await tryPost(() => postPayment(supabase, row.id), row.id, stats.payments)
  }
}

async function tryPost(
  fn: () => Promise<PostingResult>,
  sourceId: string,
  bucket: BackfillStats['invoices']
): Promise<void> {
  try {
    const result = await fn()
    if (result.reused) {
      bucket.skipped += 1
    } else {
      bucket.posted += 1
    }
  } catch (err) {
    if (err instanceof PeriodLockedError) {
      bucket.errors.push({
        source_id: sourceId,
        message: err.message,
        kind: 'period_locked',
      })
    } else if (err instanceof PostingError) {
      bucket.errors.push({ source_id: sourceId, message: err.message, kind: 'posting' })
    } else {
      bucket.errors.push({
        source_id: sourceId,
        message: err instanceof Error ? err.message : String(err),
        kind: 'unknown',
      })
    }
  }
}
