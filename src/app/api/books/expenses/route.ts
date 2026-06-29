/**
 * /api/books/expenses — list / create one-off expenses.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { postExpense, PostingError, PeriodLockedError } from '@/lib/books/posting'
import { dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'

export async function GET(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)

  const { data, error, count } = await supabase
    .from('expenses')
    .select(
      '*, vendor:vendor_id (id, name), category:expense_category_id (id, name), expense_account:expense_account_id (id, code, name)',
      { count: 'exact' }
    )
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('expense_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expenses: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId, userId } = guard

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const amountCents = typeof body.amount_cents === 'number'
    ? body.amount_cents
    : dollarsToCents(body.amount as string | number | undefined)
  const taxCents = typeof body.tax_amount_cents === 'number'
    ? body.tax_amount_cents
    : dollarsToCents(body.tax_amount as string | number | undefined)

  if (amountCents <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }

  // MB-7: Cross-tenant FK validation. Anything that takes a FK to
  // an org-scoped row must be verified to belong to the caller's org
  // BEFORE the insert. Without this, a bookkeeper could (intentionally
  // or by mistake) attach an expense to another org's vendor, client,
  // job, or expense category — RLS on `expenses` lets the insert
  // succeed because the row's `organization_id` matches the caller,
  // but the referenced FK doesn't have to.
  const fkChecks: Array<{ field: string; table: string; id: string }> = []
  if (body.vendor_id) {
    fkChecks.push({ field: 'vendor_id', table: 'vendors', id: body.vendor_id as string })
  }
  if (body.expense_category_id) {
    fkChecks.push({
      field: 'expense_category_id',
      table: 'expense_categories',
      id: body.expense_category_id as string,
    })
  }
  if (body.client_id) {
    fkChecks.push({ field: 'client_id', table: 'clients', id: body.client_id as string })
  }
  if (body.job_id) {
    fkChecks.push({ field: 'job_id', table: 'jobs', id: body.job_id as string })
  }
  for (const fk of fkChecks) {
    const { data: row, error: fkErr } = await supabase
      .from(fk.table)
      .select('id')
      .eq('id', fk.id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (fkErr) {
      return NextResponse.json(
        { error: `Failed to validate ${fk.field}: ${fkErr.message}` },
        { status: 500 }
      )
    }
    if (!row) {
      return NextResponse.json(
        { error: `${fk.field} does not belong to this organization` },
        { status: 400 }
      )
    }
  }

  const insert = {
    organization_id: organizationId,
    expense_date: (body.expense_date as string) || todayIso(),
    vendor_id: body.vendor_id ?? null,
    vendor_name_text: body.vendor_name_text ?? null,
    description: body.description ?? null,
    expense_category_id: body.expense_category_id ?? null,
    expense_account_id: body.expense_account_id ?? null,
    payment_account_id: body.payment_account_id ?? null,
    amount_cents: amountCents,
    tax_amount_cents: taxCents,
    total_cents: amountCents + taxCents,
    receipt_url: body.receipt_url ?? null,
    paid_by_user_id: body.paid_by_user_id ?? userId,
    is_reimbursable: !!body.is_reimbursable,
    is_billable: !!body.is_billable,
    client_id: body.client_id ?? null,
    job_id: body.job_id ?? null,
    notes: body.notes ?? null,
    created_by: userId,
  }

  const { data: expense, error } = await supabase
    .from('expenses').insert(insert).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-post to GL.
  let journal: { entry_number: string; reused: boolean } | null = null
  try {
    const result = await postExpense(supabase, (expense as { id: string }).id)
    journal = { entry_number: result.entry_number, reused: result.reused }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'posting failed'
    const code = err instanceof PeriodLockedError ? 409
      : err instanceof PostingError ? 422 : 500
    return NextResponse.json({ expense, error: msg, posted: false }, { status: code })
  }

  return NextResponse.json({ expense, journal }, { status: 201 })
}
