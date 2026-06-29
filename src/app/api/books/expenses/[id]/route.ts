/**
 * /api/books/expenses/[id] — read / patch / soft-delete + reverse.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import {
  softDeleteAndReverse,
  PostingError,
  postExpense,
  findExistingActiveEntry,
  reverseJournalEntry,
} from '@/lib/books/posting'

const EDITABLE = [
  'description', 'expense_category_id', 'expense_account_id',
  'payment_account_id', 'vendor_id', 'vendor_name_text',
  'is_reimbursable', 'is_reimbursed', 'is_billable', 'receipt_url',
  'notes', 'client_id', 'job_id', 'expense_date',
] as const

// Fields that affect the journal entry — changing any of these on an
// already-posted expense requires reversing the old JE and writing a
// fresh one. (Description / receipt / notes / billable flags don't
// move money.)
const POSTING_RELEVANT: readonly string[] = [
  'expense_account_id',
  'payment_account_id',
  'expense_category_id',
  'expense_date',
  'is_reimbursable',
]

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data, error } = await supabase
    .from('expenses')
    .select('*, vendor:vendor_id (id, name), category:expense_category_id (id, name), expense_account:expense_account_id (id, code, name), payment_account:payment_account_id (id, code, name)')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, (data as { organization_id: string }).organization_id)
  if (forbidden) return forbidden
  return NextResponse.json({ expense: data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('expenses').select('id, organization_id').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const update: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in body) update[key] = body[key]
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('expenses').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // MB-5: if any posting-relevant fields changed AND a JE already
  // exists for this expense, the JE is stale. Reverse it and post a
  // fresh one. Expense doesn't have a draft state — every expense is
  // immediately posted on create — so we always check.
  const postingChanged = POSTING_RELEVANT.some((k) => k in update)
  if (postingChanged) {
    try {
      const active = await findExistingActiveEntry(
        supabase,
        existing.organization_id,
        'expense',
        id
      )
      if (active) {
        await reverseJournalEntry(
          supabase,
          active.id,
          `Expense ${id} edited (posting-relevant field change)`
        )
        await supabase
          .from('journal_entries')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', active.id)
        await postExpense(supabase, id)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'reposting failed'
      console.error(`Expense ${id} re-post after edit failed: ${msg}`)
      return NextResponse.json({ expense: data, error: msg, posted: false }, { status: 200 })
    }
  }

  return NextResponse.json({ expense: data })
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('expenses').select('id, organization_id').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  try {
    const reversal = await softDeleteAndReverse(supabase, 'expenses', id, 'Expense deleted')
    return NextResponse.json({ ok: true, reversal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete'
    const code = err instanceof PostingError ? 422 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
