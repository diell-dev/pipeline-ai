/**
 * /api/books/invoices/[id] — read / patch / soft-delete + reverse.
 *
 * The detail GET pulls both invoice_line_items (books-mode invoices) AND
 * job_line_items (legacy field-ops invoices) so the detail page can
 * render either.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import {
  softDeleteAndReverse,
  PostingError,
  postInvoice,
  findExistingActiveEntry,
} from '@/lib/books/posting'

const EDITABLE = [
  'invoice_date', 'due_date', 'notes_for_customer', 'notes_internal',
  'payment_terms_text', 'payment_terms_days', 'po_number', 'status',
] as const

// Fields that, when changed on an already-posted invoice, require the
// existing journal entry to be reversed and a fresh one created so the
// GL matches the invoice header. `invoice_date` shifts the period the
// entry posts to; the remaining EDITABLE fields are notes/terms/po and
// don't move money. (Line-item totals are detected separately by
// comparing the JE's debit total against the invoice header.)
const POSTING_RELEVANT: readonly string[] = ['invoice_date']

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

  // Prev / next invoices — for the paper-preview pagination arrows.
  // Ordered by invoice_date so we walk the ledger chronologically. We
  // filter to the same org and skip soft-deleted rows so voided-then-
  // deleted invoices don't show up in navigation.
  const orgId = (invoice as { organization_id: string }).organization_id
  const invoiceDate = (invoice as { invoice_date: string }).invoice_date

  const [{ data: prev }, { data: next }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .lt('invoice_date', invoiceDate)
      .order('invoice_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('invoices')
      .select('id, invoice_number')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .gt('invoice_date', invoiceDate)
      .order('invoice_date', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    invoice,
    lines,
    payments: payments ?? [],
    journal,
    prev: prev ?? null,
    next: next ?? null,
  })
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

  // Guard status transitions. Only draft->sent is a legal manual PATCH.
  // Voiding must go through DELETE (which reverses the GL entry); payment
  // status (paid/partially_paid) is derived from recorded payments; a
  // posted invoice must not be demoted back to draft.
  if ('status' in update && update.status !== existing.status) {
    const legal = existing.status === 'draft' && update.status === 'sent'
    if (!legal) {
      return NextResponse.json(
        {
          error:
            'Invalid status change. Use Send (draft→sent), record a payment, or Void.',
        },
        { status: 400 }
      )
    }
  }

  const { data, error } = await supabase
    .from('invoices').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If we just transitioned out of draft, post the GL entry.
  const movedOutOfDraft =
    'status' in update &&
    existing.status === 'draft' &&
    update.status !== 'draft' &&
    update.status !== 'void'

  if (movedOutOfDraft) {
    try {
      await postInvoice(supabase, id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'posting failed'
      const code = err instanceof PostingError ? 422 : 500
      return NextResponse.json({ invoice: data, error: msg, posted: false }, { status: code })
    }
  } else {
    // MB-5: re-post when posting-relevant fields change on a live
    // invoice. Without this, an edit to invoice_date (or to line
    // totals via subtotal/tax/total drift) would leave the GL entry
    // pointing at the old values forever.
    const postingChanged = POSTING_RELEVANT.some((k) => k in update)
    const isLive =
      existing.status !== 'draft' &&
      existing.status !== 'void' &&
      (update.status === undefined || (update.status !== 'draft' && update.status !== 'void'))

    if (isLive) {
      try {
        const active = await findExistingActiveEntry(
          supabase,
          existing.organization_id,
          'invoice',
          id
        )
        if (active) {
          let needsRepost = postingChanged

          // Detect line-item-driven changes: compare the JE's total
          // debit (which should equal invoice.total_cents) against the
          // current invoice header. Drift means subtotal/tax/total
          // shifted since the entry was written.
          if (!needsRepost) {
            const { data: jeLines } = await supabase
              .from('journal_entry_lines')
              .select('debit_cents')
              .eq('journal_entry_id', active.id)
            const jeDebitTotal = (jeLines ?? []).reduce(
              (sum, l) => sum + ((l as { debit_cents: number }).debit_cents ?? 0),
              0
            )
            const invTotal = (data as { total_cents?: number }).total_cents ?? 0
            if (invTotal > 0 && jeDebitTotal !== invTotal) {
              needsRepost = true
            }
          }

          if (needsRepost) {
            // Soft-delete the original entry and post a fresh one. Do NOT
            // ALSO post a reversal: reports exclude the soft-deleted original
            // but would still count a reversal, netting the document to zero
            // in the P&L / trial balance. Excluding the original + posting
            // the new entry is the correct net (H1).
            await supabase
              .from('journal_entries')
              .update({ deleted_at: new Date().toISOString() })
              .eq('id', active.id)
            await postInvoice(supabase, id)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'reposting failed'
        console.error(`Invoice ${id} re-post after edit failed: ${msg}`)
        return NextResponse.json({ invoice: data, error: msg, posted: false }, { status: 200 })
      }
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
    .from('invoices').select('id, organization_id, invoice_number, amount_paid_cents').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; invoice_number: string; amount_paid_cents: number | null }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  // H5: don't void an invoice that has payments applied — it would leave the
  // payment journal entries standing and drive AR negative. Refund/void the
  // payments first.
  if ((existing.amount_paid_cents ?? 0) > 0) {
    return NextResponse.json(
      { error: 'This invoice has payments applied. Void or refund the payments first.' },
      { status: 409 }
    )
  }

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
