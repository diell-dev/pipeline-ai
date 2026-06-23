/**
 * /api/books/payments/[id] — read / soft-delete + reverse.
 *
 * Patching a posted payment is intentionally not supported — the
 * accountant practice is "void + re-enter" to keep the audit trail
 * clean. We only allow notes / reference edits, not amount / account.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import { softDeleteAndReverse, PostingError } from '@/lib/books/posting'

const EDITABLE = ['notes', 'reference'] as const

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data, error } = await supabase
    .from('payments')
    .select('*, deposit_account:deposit_to_account_id (id, code, name)')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, (data as { organization_id: string }).organization_id)
  if (forbidden) return forbidden
  return NextResponse.json({ payment: data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('payments').select('id, organization_id').eq('id', id)
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
    .from('payments').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ payment: data })
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('payments').select('id, organization_id, payment_number').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; payment_number: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  try {
    const reversal = await softDeleteAndReverse(
      supabase, 'payments', id, `Voided payment ${existing.payment_number}`
    )
    return NextResponse.json({ ok: true, reversal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed'
    const code = err instanceof PostingError ? 422 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
