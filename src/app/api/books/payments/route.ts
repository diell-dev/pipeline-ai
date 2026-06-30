/**
 * /api/books/payments — list / create payments (manual entry).
 *
 * Side-effects of create:
 *   1. Bumps the matching source row's amount_paid_cents.
 *   2. Updates the source's status (paid / partially_paid).
 *   3. Calls postPayment so the cash + AR/AP journal entries land.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { postPayment, PostingError, PeriodLockedError } from '@/lib/books/posting'
import { dollarsToCents } from '@/lib/books/format'
import { todayIso } from '@/lib/books/format-helpers'

const PAYMENT_METHODS = ['cash', 'check', 'ach', 'wire', 'credit_card', 'debit_card', 'stripe', 'other'] as const
const PAYMENT_TYPES = ['invoice_payment', 'bill_payment', 'refund', 'transfer'] as const
const SOURCE_TYPES = ['invoice', 'bill', 'manual', 'stripe', 'bank', 'backfill'] as const

export async function GET(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
  const offset = Math.max(Number(searchParams.get('offset') ?? '0'), 0)

  const { data, error, count } = await supabase
    .from('payments')
    .select('*', { count: 'exact' })
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('payment_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ payments: data ?? [], total: count ?? 0 })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId, userId } = guard

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type = (body.type as string) || 'invoice_payment'
  if (!PAYMENT_TYPES.includes(type as never)) {
    return NextResponse.json({ error: 'invalid payment type' }, { status: 400 })
  }
  const sourceType = (body.source_type as string) || 'manual'
  if (!SOURCE_TYPES.includes(sourceType as never)) {
    return NextResponse.json({ error: 'invalid source_type' }, { status: 400 })
  }
  const method = (body.payment_method as string) || 'other'
  if (!PAYMENT_METHODS.includes(method as never)) {
    return NextResponse.json({ error: 'invalid payment_method' }, { status: 400 })
  }

  const amountCents = typeof body.amount_cents === 'number'
    ? body.amount_cents
    : dollarsToCents(body.amount as string | number | undefined)
  if (amountCents <= 0) {
    return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
  }

  const sourceId = (body.source_id as string) || null

  // Overpayment guard. The DB RPC `books_apply_payment_delta` clamps
  // negative balance_due to 0, but doing that silently means the user
  // can record a $5,000 payment against a $500 invoice and get no
  // feedback. Block invoice / bill payments that exceed the open
  // balance — refund and transfer payment types are intentionally
  // exempt (refunds can exceed an invoice, transfers don't have a
  // source balance).
  if (
    sourceId &&
    ((sourceType === 'invoice' && type === 'invoice_payment') ||
      (sourceType === 'bill' && type === 'bill_payment'))
  ) {
    const table = sourceType === 'invoice' ? 'invoices' : 'bills'
    const { data: src, error: srcErr } = await supabase
      .from(table)
      .select('balance_due_cents')
      .eq('id', sourceId)
      .eq('organization_id', organizationId)
      .is('deleted_at', null)
      .maybeSingle()
    if (srcErr) {
      return NextResponse.json({ error: srcErr.message }, { status: 500 })
    }
    if (!src) {
      return NextResponse.json(
        { error: `${sourceType} not found` },
        { status: 404 }
      )
    }
    const balanceCents = Number((src as { balance_due_cents: number }).balance_due_cents) || 0
    if (amountCents > balanceCents) {
      const fmt = (cents: number) =>
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
        }).format(cents / 100)
      return NextResponse.json(
        {
          error: `Payment amount ${fmt(amountCents)} exceeds balance due ${fmt(balanceCents)}. Reduce the amount or split into two payments.`,
        },
        { status: 400 }
      )
    }
  }

  const { data: nextNum, error: seqErr } = await supabase.rpc('next_books_sequence', {
    p_org_id: organizationId,
    p_kind: 'payment',
  })
  if (seqErr) return NextResponse.json({ error: seqErr.message }, { status: 500 })
  const paymentNumber = typeof nextNum === 'string' ? nextNum : String(nextNum)

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      organization_id: organizationId,
      payment_date: (body.payment_date as string) || todayIso(),
      payment_number: paymentNumber,
      reference: body.reference ?? null,
      type,
      source_type: sourceType,
      source_id: sourceId,
      amount_cents: amountCents,
      payment_method: method,
      payment_method_details: body.payment_method_details ?? {},
      deposit_to_account_id: body.deposit_to_account_id ?? null,
      notes: body.notes ?? null,
      created_by: userId,
    })
    .select('*')
    .single()

  if (error || !payment) {
    return NextResponse.json({ error: error?.message ?? 'Failed' }, { status: 500 })
  }

  // Bump the source row's amount_paid_cents via an atomic RPC. The
  // earlier read-modify-write block raced when two payments hit the
  // same invoice/bill concurrently (both reads saw the old value, both
  // writes overwrote each other). The DB function does it in a single
  // UPDATE so concurrent calls serialize on the row lock.
  if (
    sourceId &&
    ((sourceType === 'invoice' && type === 'invoice_payment') ||
      (sourceType === 'bill' && type === 'bill_payment'))
  ) {
    const { error: deltaErr } = await supabase.rpc('books_apply_payment_delta', {
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_amount_delta_cents: amountCents,
    })
    if (deltaErr) {
      // Don't fail the request — the payment row exists; surface the
      // problem so it can be reconciled.
      console.error(
        `Payment ${paymentNumber}: books_apply_payment_delta failed for ${sourceType} ${sourceId}: ${deltaErr.message}`
      )
    }
  }

  // Post journal entry.
  let journal: { entry_number: string; reused: boolean } | null = null
  try {
    const result = await postPayment(supabase, (payment as { id: string }).id)
    journal = { entry_number: result.entry_number, reused: result.reused }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'posting failed'
    const code = err instanceof PeriodLockedError ? 409
      : err instanceof PostingError ? 422 : 500
    return NextResponse.json({ payment, error: msg, posted: false }, { status: code })
  }

  return NextResponse.json({ payment, journal }, { status: 201 })
}
