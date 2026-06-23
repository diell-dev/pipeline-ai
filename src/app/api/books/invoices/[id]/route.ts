/**
 * /api/books/invoices/[id] — read / patch / soft-delete + reverse.
 *
 * The detail GET pulls both invoice_line_items (books-mode invoices) AND
 * job_line_items (legacy field-ops invoices) so the detail page can
 * render either.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import { softDeleteAndReverse, PostingError, postInvoice } from '@/lib/books/posting'

const EDITABLE = [
  'invoice_date', 'due_date', 'notes_for_customer', 'notes_internal',
  'payment_terms_text', 'payment_terms_days', 'po_number', 'status',
] as const

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: invoice, error } = await supabase
    .from('invoices')
    .select('*, clients (id, company_name, billing_contact_email, primary_contact_email)')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forbidden = assertOrgMatch(guard, (invoice as { organization_id: string }).organization_id)
  if (forbidden) return forbidden

  const inv = invoice as { id: string; job_id: string | null }

  // Lines: books-mode first, fall back to job_line_items.
  const { data: invLines } = await supabase
    .from('invoice_line_items')
    .select('*, account:account_id (id, code, name)')
    .eq('invoice_id', inv.id)
    .order('line_number', { ascending: true })

  let lines: unknown[] = invLines ?? []
  if (lines.length === 0 && inv.job_id) {
    const { data: jobLines } = await supabase
      .from('job_line_items')
      .select('*, account:account_id (id, code, name)')
      .eq('job_id', inv.job_id)
      .order('line_number', { ascending: true })
    lines = jobLines ?? []
  }

  // Associated payments.
  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('source_type', 'invoice')
    .eq('source_id', inv.id)
    .is('deleted_at', null)
    .order('payment_date', { ascending: false })

  // Most recent active journal entry.
  const { data: journal } = await supabase
    .from('journal_entries')
    .select('id, entry_number, entry_date, posted_at')
    .eq('source_type', 'invoice')
    .eq('source_id', inv.id)
    .is('deleted_at', null)
    .is('reversal_of_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ invoice, lines, payments: payments ?? [], journal })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('invoices').select('id, organization_id, status, locked_at').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; status: string; locked_at: string | null }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden
  if (existing.locked_at) {
    return NextResponse.json({ error: 'Invoice is locked' }, { status: 409 })
  }

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
    .from('invoices').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If we just transitioned out of draft, post the GL entry.
  if (
    'status' in update &&
    existing.status === 'draft' &&
    update.status !== 'draft' &&
    update.status !== 'void'
  ) {
    try {
      await postInvoice(supabase, id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'posting failed'
      const code = err instanceof PostingError ? 422 : 500
      return NextResponse.json({ invoice: data, error: msg, posted: false }, { status: code })
    }
  }

  return NextResponse.json({ invoice: data })
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('invoices').select('id, organization_id, invoice_number').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  try {
    const reversal = await softDeleteAndReverse(
      supabase, 'invoices', id, `Voided invoice ${existing.invoice_number}`
    )
    // Also mark status void on the row (softDelete just sets deleted_at).
    await supabase.from('invoices').update({ status: 'void' }).eq('id', id)
    return NextResponse.json({ ok: true, reversal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed'
    const code = err instanceof PostingError ? 422 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
