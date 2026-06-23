/**
 * POST /api/books/setup
 *
 * Runs the books setup wizard. Three steps in one atomic-ish call:
 *   1. Seed default chart of accounts (idempotent — re-running is safe).
 *   2. Create the current month's accounting_periods row.
 *   3. Stamp organizations.books_enabled_at = NOW().
 *
 * Body (all optional):
 *   {
 *     fiscalYearStartMonth?: 1..12,  // for documentation; the period is
 *                                     // always the current month
 *     periodName?: string             // override "Month YYYY" label
 *   }
 *
 * Returns:
 *   { accountsSeeded: number, periodId: string, booksEnabledAt: string }
 *
 * Requires `bookkeeping:edit`. Owner / office_manager / super_admin.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { currentMonthRange } from '@/lib/books/format-helpers'

interface SetupBody {
  fiscalYearStartMonth?: unknown
  periodName?: unknown
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  let body: SetupBody = {}
  try {
    body = (await request.json()) as SetupBody
  } catch {
    // empty body is fine — all fields are optional
  }

  // 1. Seed default chart of accounts (RPC defined in migration 015).
  const { data: seeded, error: seedErr } = await supabase.rpc(
    'seed_default_chart_of_accounts',
    { p_org_id: organizationId }
  )
  if (seedErr) {
    return NextResponse.json(
      { error: `Failed to seed chart of accounts: ${seedErr.message}` },
      { status: 500 }
    )
  }

  // 2. Create the current month's accounting period (idempotent via
  //    UNIQUE(organization_id, start_date) — handle 23505 as a no-op).
  const { start, end } = currentMonthRange()
  const defaultName = new Date().toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })
  const periodName =
    typeof body.periodName === 'string' && body.periodName.trim()
      ? body.periodName.trim()
      : defaultName

  const { data: period, error: periodErr } = await supabase
    .from('accounting_periods')
    .insert({
      organization_id: organizationId,
      name: periodName,
      start_date: start,
      end_date: end,
    })
    .select('id')
    .single<{ id: string }>()

  let periodId: string | null = period?.id ?? null
  if (periodErr) {
    // Duplicate (already exists for this month) — look it up.
    if (periodErr.code === '23505') {
      const { data: existing } = await supabase
        .from('accounting_periods')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('start_date', start)
        .maybeSingle<{ id: string }>()
      periodId = existing?.id ?? null
    } else {
      return NextResponse.json(
        { error: `Failed to create accounting period: ${periodErr.message}` },
        { status: 500 }
      )
    }
  }

  // 3. Stamp organizations.books_enabled_at.
  const enabledAt = new Date().toISOString()
  const { error: orgErr } = await supabase
    .from('organizations')
    .update({ books_enabled_at: enabledAt })
    .eq('id', organizationId)

  if (orgErr) {
    return NextResponse.json(
      { error: `Failed to enable books: ${orgErr.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    accountsSeeded: typeof seeded === 'number' ? seeded : 0,
    periodId,
    booksEnabledAt: enabledAt,
  })
}
