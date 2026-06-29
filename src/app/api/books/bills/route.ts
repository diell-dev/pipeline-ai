/**
 * /api/books/bills — list bills + create new bill (with line items).
 *
 * On create:
 *   - Server-side claims an `internal_number` via next_books_sequence.
 *   - Inserts the bill header.
 *   - Inserts bill_line_items.
 *   - Recomputes monetary totals from the lines (so the header always
 *     matches what's stored).
 *   - When status != 'draft', calls postBill from B2 to write the GL entry.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { postBill, PostingError, PeriodLockedError } from '@/lib/books/posting'
import { dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'

interface BillLineInput {
  item_id?: string | null
  account_id: string
  tax_rate_id?: string | null
  description?: string | null
  quantity?: number
  unit_price_cents?: number
  unit_price?: number | string
  discount_pct?: number
  is_taxable?: boolean
  tax_amount_cents?: number
}

interface CreateBillBody {
  vendor_id?: string
  bill_number?: string | null
  bill_date?: string
  due_date?: string | null
  reference?: string | null
  notes?: string | null
  status?: 'draft' | 'open'
  lines?: BillLineInput[]
}

export async function GET(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const vendorId = searchParams.get('vendor_id')
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)

  let q = supabase
    .from('bills')
    .select('*, vendor:vendor_id (id, name)', { count: 'exact' })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('bill_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) q = q.eq('status', status)
  if (vendorId) q = q.eq('vendor_id', vendorId)

  const { data, error, count } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bills: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId, userId } = guard

  let body: CreateBillBody = {}
  try { body = (await request.json()) as CreateBillBody } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.vendor_id) return NextResponse.json({ error: 'vendor_id required' }, { status: 400 })
  const lines = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) {
    return NextResponse.json({ error: 'At least one line item is required' }, { status: 400 })
  }
  for (const l of lines) {
    if (!l.account_id) {
      return NextResponse.json({ error: 'Every line must include account_id' }, { status: 400 })
    }
  }

  // MB-7: validate vendor_id belongs to caller's org. (Line account_ids
  // are validated downstream by postBill via assertAccountInOrg, so we
  // don't re-check here — but bills.vendor_id has no such guard.)
  {
    const { data: vendorRow, error: vendorErr } = await supabase
      .from('vendors')
      .select('id')
      .eq('id', body.vendor_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (vendorErr) {
      return NextResponse.json(
        { error: `Failed to validate vendor_id: ${vendorErr.message}` },
        { status: 500 }
      )
    }
    if (!vendorRow) {
      return NextResponse.json(
        { error: 'vendor_id does not belong to this organization' },
        { status: 400 }
      )
    }
  }

  // Compute monetary totals.
  let subtotalCents = 0
  let taxCents = 0
  const linesPayload = lines.map((l, idx) => {
    const qty = typeof l.quantity === 'number' ? l.quantity : 1
    const unit = typeof l.unit_price_cents === 'number'
      ? l.unit_price_cents
      : dollarsToCents(l.unit_price as string | number | undefined)
    const lineSubtotal = Math.round(qty * unit)
    const discountPct = typeof l.discount_pct === 'number' ? l.discount_pct : 0
    const discountAmt = Math.round((lineSubtotal * discountPct) / 100)
    const lineNet = lineSubtotal - discountAmt
    const lineTax = typeof l.tax_amount_cents === 'number' ? l.tax_amount_cents : 0
    subtotalCents += lineNet
    taxCents += lineTax
    return {
      item_id: l.item_id ?? null,
      account_id: l.account_id,
      tax_rate_id: l.tax_rate_id ?? null,
      description: l.description ?? null,
      quantity: qty,
      unit_price_cents: unit,
      discount_pct: discountPct,
      discount_amount_cents: discountAmt,
      tax_amount_cents: lineTax,
      total_cents: lineNet + lineTax,
      is_taxable: !!l.is_taxable,
      line_number: idx + 1,
    }
  })
  const totalCents = subtotalCents + taxCents

  // Claim internal_number.
  const { data: nextNum, error: seqErr } = await supabase.rpc('next_books_sequence', {
    p_org_id: organizationId,
    p_kind: 'bill',
  })
  if (seqErr) {
    return NextResponse.json({ error: `sequence: ${seqErr.message}` }, { status: 500 })
  }
  const internalNumber = typeof nextNum === 'string' ? nextNum : String(nextNum)

  const status = body.status === 'open' ? 'open' : 'draft'

  const { data: bill, error: billErr } = await supabase
    .from('bills')
    .insert({
      organization_id: organizationId,
      vendor_id: body.vendor_id,
      bill_number: body.bill_number ?? null,
      internal_number: internalNumber,
      reference: body.reference ?? null,
      bill_date: body.bill_date ?? todayIso(),
      due_date: body.due_date ?? null,
      subtotal_cents: subtotalCents,
      tax_amount_cents: taxCents,
      total_cents: totalCents,
      status,
      notes: body.notes ?? null,
      created_by: userId,
    })
    .select('*')
    .single()

  if (billErr || !bill) {
    return NextResponse.json({ error: billErr?.message ?? 'Failed to create bill' }, { status: 500 })
  }

  const payload = linesPayload.map((l) => ({ ...l, bill_id: (bill as { id: string }).id }))
  const { error: linesErr } = await supabase.from('bill_line_items').insert(payload)
  if (linesErr) {
    return NextResponse.json({ error: `lines: ${linesErr.message}` }, { status: 500 })
  }

  // Post journal entry when not draft.
  let journal: { entry_number: string; reused: boolean } | null = null
  if (status === 'open' && totalCents > 0) {
    try {
      const result = await postBill(supabase, (bill as { id: string }).id)
      journal = { entry_number: result.entry_number, reused: result.reused }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'posting failed'
      const code = err instanceof PeriodLockedError ? 409
        : err instanceof PostingError ? 422
        : 500
      return NextResponse.json({ error: msg, bill, posted: false }, { status: code })
    }
  }

  return NextResponse.json({ bill, journal }, { status: 201 })
}
