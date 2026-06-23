/**
 * Pipeline AI — Accounting Period Helpers
 *
 * Period locks are enforced at the DB layer by the
 * `guard_locked_period` trigger from migration 015. The helpers here
 * give the TypeScript posting layer a friendlier (and more
 * informative) failure mode than letting the DB throw a check_violation.
 *
 * Two questions get asked over and over:
 *   1. For this entry_date, which period does it land in?
 *   2. Is that period locked?
 *
 * `getOpenPeriodOrFail` resolves both and throws `PeriodLockedError`
 * if the answer says "locked." `getNextOpenPeriodAfter` powers the
 * reversal-into-next-open-period flow.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface AccountingPeriodRow {
  id: string
  organization_id: string
  name: string
  start_date: string // YYYY-MM-DD
  end_date: string
  is_locked: boolean
}

export class PeriodLockedError extends Error {
  constructor(
    message: string,
    public readonly orgId: string,
    public readonly date: string,
    public readonly period?: AccountingPeriodRow
  ) {
    super(message)
    this.name = 'PeriodLockedError'
  }
}

export class PeriodLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PeriodLookupError'
  }
}

/**
 * Find the accounting_periods row whose [start_date, end_date]
 * window contains `date`. Returns null if no period covers the date.
 * Books work without periods (period_id on a journal entry is
 * nullable), so a missing period is NOT an error — only a locked
 * period is.
 */
export async function getPeriodForDate(
  supabase: SupabaseClient,
  orgId: string,
  date: string
): Promise<AccountingPeriodRow | null> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id, organization_id, name, start_date, end_date, is_locked')
    .eq('organization_id', orgId)
    .lte('start_date', date)
    .gte('end_date', date)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle<AccountingPeriodRow>()

  if (error) {
    throw new PeriodLookupError(
      `Failed to look up accounting period for ${date} (org ${orgId}): ${error.message}`
    )
  }
  return data ?? null
}

/**
 * Resolve the period that contains `date`. If that period is locked,
 * throws `PeriodLockedError`. Returns null when no period exists for
 * the date (which is fine — the DB trigger only blocks LOCKED periods,
 * not the absence of one).
 */
export async function getOpenPeriodOrFail(
  supabase: SupabaseClient,
  orgId: string,
  date: string
): Promise<AccountingPeriodRow | null> {
  const period = await getPeriodForDate(supabase, orgId, date)
  if (period && period.is_locked) {
    throw new PeriodLockedError(
      `Cannot post to ${date}: period "${period.name}" (${period.start_date} – ${period.end_date}) is locked.`,
      orgId,
      date,
      period
    )
  }
  return period
}

/**
 * Find the earliest open (non-locked) period whose start_date is
 * strictly after `afterDate`. Returns null if no later open period
 * exists (caller can fall back to posting on the original date and
 * letting the DB trigger decide, or just on `today`).
 */
export async function getNextOpenPeriodAfter(
  supabase: SupabaseClient,
  orgId: string,
  afterDate: string
): Promise<AccountingPeriodRow | null> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id, organization_id, name, start_date, end_date, is_locked')
    .eq('organization_id', orgId)
    .eq('is_locked', false)
    .gt('start_date', afterDate)
    .order('start_date', { ascending: true })
    .limit(1)
    .maybeSingle<AccountingPeriodRow>()

  if (error) {
    throw new PeriodLookupError(
      `Failed to look up next open period after ${afterDate}: ${error.message}`
    )
  }
  return data ?? null
}

/**
 * Pick the right date for a reversing entry given the original entry's
 * date. Strategy:
 *   1. Try to post the reversal on the same date as the original.
 *   2. If that period is locked, find the next open period and post
 *      on its start_date.
 *   3. If no later open period exists, post on today's date (caller
 *      can override if they want a specific date).
 *
 * Returns { date, period } — `period` is null when no period covers
 * the chosen date (allowed, but the caller may want to know).
 */
export async function pickReversalDate(
  supabase: SupabaseClient,
  orgId: string,
  originalDate: string
): Promise<{ date: string; period: AccountingPeriodRow | null }> {
  const originalPeriod = await getPeriodForDate(supabase, orgId, originalDate)
  if (!originalPeriod || !originalPeriod.is_locked) {
    return { date: originalDate, period: originalPeriod }
  }

  const next = await getNextOpenPeriodAfter(supabase, orgId, originalPeriod.end_date)
  if (next) {
    return { date: next.start_date, period: next }
  }

  // Fall back to today; the trigger will reject if today is also
  // inside a locked period, and the caller will see a clear error.
  const today = new Date().toISOString().slice(0, 10)
  const todayPeriod = await getPeriodForDate(supabase, orgId, today)
  return { date: today, period: todayPeriod }
}
