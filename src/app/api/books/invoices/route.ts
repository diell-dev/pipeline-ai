/**
 * /api/books/invoices — list + create books-mode invoices.
 *
 * On POST:
 *   - Claims invoice_number from next_books_sequence('invoice') (with a
 *     sane fallback to the legacy `INV-{n}` scheme if the org has never
 *     run the books wizard — although the layout guard normally blocks
 *     this code path for non-books orgs).
 *   - Inserts an invoice row (job_id NULL — books-mode standalone).
 *   - Inserts invoice_line_items for the UI/line storage.
 *   - When status != 'draft', calls postInvoice from B2 to write the GL.
 *
 * Field-ops invoices (job_id NOT NULL) keep flowing through the legacy
 * `/jobs/[id]` path and aren't created here.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { postInvoice, PostingError, PeriodLockedError } from '@/lib/books/posting'
import { dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'

interface InvoiceLineInput {
  item_id?: string | null
  account_id?: string | null
  tax_rate_id?: string | null
  description?: string | null
  quantity?: number
  unit_price_cents?: number
  unit_price?: number | string
  discount_pct?: number
  is_taxable?: boolean
  tax_amount_cents?: number
}

interface CreateInvoiceBody {
  client_id?: string
  invoice_date?: string
  due_date?: string
  status?: 'draft' | 'sent'
  notes_for_customer?: string | null
  notes_internal?: string | null
  payment_terms_text?: string | null
  payment_terms_days?: number | null
  po_number?: string | null
  lines?: InvoiceLineInput[]
}

export async function GET(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const clientId = searchParams.get('client_id')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)

  let q = supabase
    .from('invoices')
    .select('*, clients (company_name)', { count: 'exact' })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('invoice_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status === 'unpaid') {
    q = q.in('status', ['draft', 'sent', 'overdue', 'partially_paid'])
  } else if (status) {
    q = q.eq('status', status)
  }
  if (clientId) q = q.eq('client_id', clientId)

  const { data, error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  let body: CreateInvoiceBody = {}
  try { body = (await request.json()) as CreateInvoiceBody } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 })
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) {
    return NextResponse.json({ error: 'At least one line item required' }, { status: 400 })
  }

  // Compute totals from lines.
  let subtotalCents = 0
  let taxCents = 0
  const linePayloads = lines.map((l, idx) => {
    const qty = typeof l.quantity === 'number' ? l.quantity : 1
    const unit = typeof l.unit_price_cents === 'number'
      ? l.unit_price_cents
      : dollarsToCents(l.unit_price as string | number | undefined)
    const gross = Math.round(qty * unit)
    const discountPct = typeof l.discount_pct === 'number' ? l.discount_pct : 0
    const discount = Math.round((gross * discountPct) / 100)
    const net = gross - discount
    const tax = typeof l.tax_amount_cents === 'number' ? l.tax_amount_cents : 0
    subtotalCents += net
    taxCents += tax
    return {
      item_id: l.item_id ?? null,
      account_id: l.account_id ?? null,
      tax_rate_id: l.tax_rate_id ?? null,
      description: l.description ?? null,
      quantity: qty,
      unit_price_cents: unit,
      discount_pct: discountPct,
      discount_amount_cents: discount,
      tax_amount_cents: tax,
      total_cents: net + tax,
      is_taxable: !!l.is_taxable,
      line_number: idx + 1,
    }
  })
  const totalCents = subtotalCents + taxCents

  // Sequence-claim. Fall back to the legacy "INV-..." scheme if books
  // sequences haven't been seeded yet (the wizard normally seeds it).
  const { data: nextNum, error: seqErr } = await supabase.rpc('next_books_sequence', {
    p_org_id: organizationId,
    p_kind: 'invoice',
  })
  if (seqErr) {
    return NextResponse.json({ error: `sequence: ${seqErr.message}` }, { status: 500 })
  }
  const invoiceNumber = typeof nextNum === 'string' ? nextNum : String(nextNum)

  const status = body.status === 'sent' ? 'sent' : 'draft'

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      organization_id: organizationId,
      client_id: body.client_id,
      job_id: null,
      invoice_number: invoiceNumber,
      invoice_date: body.invoice_date ?? todayIso(),
      due_date: body.due_date ?? null,
      status,
      // Legacy decimal columns kept in sync for backwards-compat.
      amount: subtotalCents / 100,
      tax_amount: taxCents / 100,
      total_amount: totalCents / 100,
      paid_amount: 0,
      // New cents columns (source of truth).
      subtotal_cents: subtotalCents,
      tax_amount_cents: taxCents,
      total_cents: totalCents,
      amount_paid_cents: 0,
      notes_for_customer: body.notes_for_customer ?? null,
      notes_internal: body.notes_internal ?? null,
      payment_terms_text: body.payment_terms_text ?? null,
      payment_terms_days: body.payment_terms_days ?? null,
      po_number: body.po_number ?? null,
    })
    .select('*')
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: invErr?.message ?? 'Failed' }, { status: 500 })
  }

  const linesWithFk = linePayloads.map((l) => ({ ...l, invoice_id: (invoice as { id: string }).id }))
  const { error: linesErr } = await supabase.from('invoice_line_items').insert(linesWithFk)
  if (linesErr) {
    return NextResponse.json({ error: `lines: ${linesErr.message}` }, { status: 500 })
  }

  // Post journal entry when not draft.
  let journal: { entry_number: string; reused: boolean } | null = null
  if (status !== 'draft' && totalCents > 0) {
    try {
      const result = await postInvoice(supabase, (invoice as { id: string }).id)
      journal = { entry_number: result.entry_number, reused: result.reused }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'posting failed'
      const code = err instanceof PeriodLockedError ? 409
        : err instanceof PostingError ? 422 : 500
      return NextResponse.json({ invoice, error: msg, posted: false }, { status: code })
    }
  }

  return NextResponse.json({ invoice, journal }, { status: 201 })
}
