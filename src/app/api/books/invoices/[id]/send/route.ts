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
 *   5. Email the client the invoice (audit G1 — this used to be a TODO that
 *      only logged to the console, so "Send" marked the invoice sent and
 *      posted the GL while the customer received nothing).
 *   6. Returns { invoice, journal_entry_id, emailed, ... }.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import {
  PostingError,
  PeriodLockedError,
  postInvoice,
} from '@/lib/books/posting'
import { buildBooksInvoiceEmail, type BooksInvoiceLine } from '@/lib/books/invoice-email'
import { createInvoiceCheckoutSession } from '@/lib/stripe-helpers'

interface InvoiceRow {
  id: string
  organization_id: string
  invoice_number: string
  status: string
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  subtotal_cents: number | null
  tax_amount_cents: number | null
  discount_amount_cents: number | null
  invoice_date: string | null
  due_date: string | null
  payment_terms_text: string | null
  notes_for_customer: string | null
  send_count: number | null
  sent_at: string | null
  locked_at: string | null
  deleted_at: string | null
  client_id: string | null
  job_id: string | null
  stripe_checkout_session_id: string | null
  stripe_payment_link_url: string | null
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
      'id, organization_id, invoice_number, status, total_cents, amount_paid_cents, balance_due_cents, subtotal_cents, tax_amount_cents, discount_amount_cents, invoice_date, due_date, payment_terms_text, notes_for_customer, send_count, sent_at, locked_at, deleted_at, client_id, job_id, stripe_checkout_session_id, stripe_payment_link_url'
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

  // 3. Email the client (audit G1).
  //    Previously a TODO: the invoice was marked sent and the GL was posted,
  //    but nothing ever reached the customer. Failure here reverts the
  //    status flip so the UI never claims "sent" when nothing was delivered.
  //    The journal entry is intentionally NOT reversed — postInvoice is
  //    idempotent, so a retry reuses the same entry.
  let emailed = false
  let emailError: string | null = null

  // Bind a non-null local: `invoice` is captured by the closure below, which
  // makes TypeScript widen it back to `InvoiceRow | null`.
  const inv = invoice
  const wasDraft = inv.status === 'draft'

  async function revertSendClaim() {
    if (!wasDraft) return // resend of an already-sent invoice — nothing to undo
    await supabase
      .from('invoices')
      .update({
        status: 'draft',
        sent_at: inv.sent_at,
        send_count: currentSendCount,
      })
      .eq('id', inv.id)
  }

  const { data: clientRow } = await supabase
    .from('clients')
    .select('id, company_name, primary_contact_name, billing_contact_email, primary_contact_email')
    .eq('id', invoice.client_id ?? '')
    .maybeSingle<{
      id: string
      company_name: string
      primary_contact_name: string | null
      billing_contact_email: string | null
      primary_contact_email: string | null
    }>()

  const clientEmail = clientRow?.billing_contact_email || clientRow?.primary_contact_email || null

  if (!clientEmail) {
    await revertSendClaim()
    return NextResponse.json(
      {
        error:
          'This client has no billing or contact email, so the invoice could not be sent. Add an email address on the client record and try again.',
        emailed: false,
      },
      { status: 422 }
    )
  }

  const resendApiKey = process.env.RESEND_API_KEY
  if (!resendApiKey && process.env.NODE_ENV === 'production') {
    await revertSendClaim()
    return NextResponse.json(
      { error: 'Email provider is not configured — cannot send invoices.', emailed: false },
      { status: 503 }
    )
  }

  const { data: org } = await supabase
    .from('organizations')
    .select(
      'id, name, settings, logo_url, primary_color, company_phone, company_email, stripe_account_id, stripe_charges_enabled'
    )
    .eq('id', invoice.organization_id)
    .maybeSingle<{
      id: string
      name: string
      settings: Record<string, unknown> | null
      logo_url: string | null
      primary_color: string | null
      company_phone: string | null
      company_email: string | null
      stripe_account_id: string | null
      stripe_charges_enabled: boolean | null
    }>()

  const { data: lineRows } = await supabase
    .from('invoice_line_items')
    .select('description, quantity, unit_price_cents, total_cents')
    .eq('invoice_id', invoice.id)
    .order('line_number', { ascending: true })

  // Pay-with-Card link — best effort. A Stripe hiccup must not block the
  // invoice going out; we just send without the button.
  let payWithCardUrl: string | null = invoice.stripe_payment_link_url
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!payWithCardUrl && appUrl && org?.stripe_account_id && org?.stripe_charges_enabled) {
    try {
      const result = await createInvoiceCheckoutSession(
        supabase,
        {
          id: invoice.id,
          organization_id: invoice.organization_id,
          invoice_number: invoice.invoice_number,
          // total_amount is the legacy decimal mirror; stripe-helpers charges
          // from *_cents and only falls back to this for pre-cents rows.
          total_amount: invoice.total_cents / 100,
          total_cents: invoice.total_cents,
          amount_paid_cents: invoice.amount_paid_cents,
          balance_due_cents: invoice.balance_due_cents,
          status: invoice.status,
          stripe_checkout_session_id: invoice.stripe_checkout_session_id,
          stripe_payment_link_url: invoice.stripe_payment_link_url,
        },
        { id: org.id, stripe_account_id: org.stripe_account_id, stripe_charges_enabled: !!org.stripe_charges_enabled },
        appUrl
      )
      payWithCardUrl = result.url ?? null
    } catch (stripeErr) {
      console.error('Books invoice: Stripe link failed, sending without Pay button:', stripeErr)
    }
  }

  const emailHtml = buildBooksInvoiceEmail({
    orgName: org?.name || 'Your service provider',
    orgLogoUrl: org?.logo_url,
    orgPhone: org?.company_phone,
    orgEmail: org?.company_email,
    brandColor: org?.primary_color,
    clientName: clientRow?.primary_contact_name || clientRow?.company_name || 'there',
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
    dueDate: invoice.due_date,
    paymentTermsText: invoice.payment_terms_text,
    notesForCustomer: invoice.notes_for_customer,
    lines: (lineRows as BooksInvoiceLine[] | null) ?? [],
    subtotalCents: invoice.subtotal_cents ?? invoice.total_cents,
    taxCents: invoice.tax_amount_cents ?? 0,
    discountCents: invoice.discount_amount_cents ?? 0,
    totalCents: invoice.total_cents,
    amountPaidCents: invoice.amount_paid_cents ?? 0,
    balanceDueCents: invoice.balance_due_cents ?? invoice.total_cents,
    payWithCardUrl,
  })

  if (resendApiKey) {
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(resendApiKey)
      const orgName = org?.name || 'Pipeline AI'
      const fromEmail =
        ((org?.settings as Record<string, unknown> | null)?.from_email as string) ||
        `invoices@${orgName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`

      const { error: sendError } = await resend.emails.send({
        from: `${orgName} <${fromEmail}>`,
        to: clientEmail,
        subject: `Invoice ${invoice.invoice_number} from ${orgName}`,
        html: emailHtml,
      })

      if (sendError) {
        emailError = sendError.message
      } else {
        emailed = true
      }
    } catch (err) {
      emailError = err instanceof Error ? err.message : 'Email send failed'
    }

    if (!emailed) {
      await revertSendClaim()
      return NextResponse.json(
        { error: `Email failed: ${emailError}`, emailed: false },
        { status: 502 }
      )
    }
  } else {
    // Development-only fallback (production is blocked above).
    console.log('=== BOOKS INVOICE EMAIL WOULD BE SENT (dev only) ===')
    console.log('To:', clientEmail)
    console.log('Subject:', `Invoice ${invoice.invoice_number}`)
    console.log('HTML length:', emailHtml.length)
    emailed = true
  }

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
    emailed,
    sent_to: clientEmail,
  })
}
