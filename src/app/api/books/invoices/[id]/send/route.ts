/**
 * POST /api/books/invoices/[id]/send
 *
 * "Send" action for standalone books-mode invoices (no backing job).
 * Field-ops invoices (job_id NOT NULL) keep flowing through the legacy
 * `/api/jobs/[id]/send` route — this one is for the Books UI when a user
 * created an invoice directly inside Books.
 *
 * Flow:
 *   1. Guard via requireBooksAccess('bookkeeping:edit').
 *   2. Load invoice + tenant check.
 *   3. If draft, flip to sent (status='sent', sent_at=NOW(), send_count += 1).
 *   4. postInvoice() to write the journal entry (idempotent on re-send).
 *   5. TODO: actually email the client. For now we log a console message
 *      so it's obvious in dev. The route is intentionally honest about
 *      this — no fake "email sent" success.
 *   6. Returns { invoice, journal_entry_id, emailed: false, ... }.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import {
  PostingError,
  PeriodLockedError,
  postInvoice,
} from '@/lib/books/posting'

interface InvoiceRow {
  id: string
  organization_id: string
  invoice_number: string
  status: string
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  send_count: number | null
  sent_at: string | null
  locked_at: string | null
  deleted_at: string | null
  client_id: string | null
  job_id: string | null
}

export async function POST(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params

  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: invoice, error: loadErr } = await supabase
    .from('invoices')
    .select(
      'id, organization_id, invoice_number, status, total_cents, amount_paid_cents, balance_due_cents, send_count, sent_at, locked_at, deleted_at, client_id, job_id'
    )
    .eq('id', id)
    .maybeSingle<InvoiceRow>()

  if (loadErr) {
    return NextResponse.json({ error: loadErr.message }, { status: 500 })
  }
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const forbidden = assertOrgMatch(guard, invoice.organization_id)
  if (forbidden) return forbidden

  if (invoice.deleted_at) {
    return NextResponse.json(
      { error: 'Invoice is voided; cannot send' },
      { status: 409 }
    )
  }
  if (invoice.status === 'void') {
    return NextResponse.json(
      { error: 'Invoice is voided; cannot send' },
      { status: 409 }
    )
  }
  if (invoice.total_cents <= 0) {
    return NextResponse.json(
      { error: 'Invoice has zero total; nothing to send' },
      { status: 400 }
    )
  }

  // 1. Flip draft → sent. Conditional update so a parallel send doesn't
  //    double-bump. If the row is already sent/paid we bump send_count
  //    only (the user hit Resend).
  const nowIso = new Date().toISOString()
  const currentSendCount = invoice.send_count ?? 0
  if (invoice.status === 'draft') {
    const { error: flipErr } = await supabase
      .from('invoices')
      .update({
        status: 'sent',
        sent_at: nowIso,
        send_count: currentSendCount + 1,
      })
      .eq('id', invoice.id)
      .eq('status', 'draft')
      .is('deleted_at', null)

    if (flipErr) {
      return NextResponse.json(
        { error: `Failed to mark invoice sent: ${flipErr.message}` },
        { status: 500 }
      )
    }
  } else {
    const { error: bumpErr } = await supabase
      .from('invoices')
      .update({ send_count: currentSendCount + 1 })
      .eq('id', invoice.id)
    if (bumpErr) {
      console.error('Invoice send_count bump failed:', bumpErr.message)
    }
  }

  // 2. Post the journal entry. Idempotent — re-sends won't double-post.
  let journalEntryId: string | null = null
  let journalEntryNumber: string | null = null
  try {
    const result = await postInvoice(supabase, invoice.id)
    journalEntryId = result.journal_entry_id
    journalEntryNumber = result.entry_number
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'posting failed'
    const code = err instanceof PeriodLockedError ? 409
      : err instanceof PostingError ? 422 : 500
    // The status flip already landed — surface the posting failure so
    // the UI can show the user, but don't roll back the status change
    // (postInvoice is idempotent and can be retried).
    return NextResponse.json({ error: msg, posted: false }, { status: code })
  }

  // 3. Email send: not yet implemented for standalone books invoices.
  //    The legacy job-send route builds a rich HTML email with the AI
  //    report — for standalone invoices we'd want a simpler invoice-only
  //    email mirroring the legacy template but without the report block.
  //    Leaving this as a TODO so the lifecycle (sent_at, send_count, JE)
  //    still works while the email body is being designed.
  // TODO: email send for standalone books invoices
  console.log(
    `[books/invoices/${invoice.invoice_number}/send] email send not yet implemented for standalone books invoices — invoice marked sent + JE posted (${journalEntryNumber})`
  )

  // 4. Re-read the invoice so the UI sees the freshly-updated row.
  const { data: refreshed } = await supabase
    .from('invoices')
    .select(
      '*, clients (id, company_name, billing_contact_email, primary_contact_email)'
    )
    .eq('id', invoice.id)
    .maybeSingle()

  return NextResponse.json({
    invoice: refreshed ?? invoice,
    journal_entry_id: journalEntryId,
    journal_entry_number: journalEntryNumber,
    emailed: false,
  })
}
