/**
 * POST /api/invoices/[id]/mark-paid
 *
 * Marks an invoice as paid (or partially paid). Requires the
 * `invoices:mark_paid` permission (super_admin, owner, office_manager).
 *
 * Body:
 *   {
 *     paid_date: string (YYYY-MM-DD),
 *     paid_amount: number,
 *     payment_method: 'check' | 'ach' | 'wire' | 'credit_card' | 'cash' | 'other',
 *     reference_number?: string,
 *     notes?: string,
 *   }
 *
 * Behavior:
 *   - If paid_amount >= total_amount → status = 'paid'
 *   - If 0 < paid_amount < total_amount → status = 'partially_paid'
 *   - Updates paid_date, paid_amount, payment_method
 *   - Appends a note like "[Marked paid 2026-04-30 by check #4521]"
 *   - Inserts an activity_log row
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'
import { hasPermission } from '@/lib/permissions'
import type { PaymentMethod } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const ALLOWED_METHODS: PaymentMethod[] = [
  'check',
  'ach',
  'wire',
  'credit_card',
  'cash',
  'other',
]

const METHOD_LABELS: Record<PaymentMethod, string> = {
  check: 'check',
  ach: 'ACH',
  wire: 'wire',
  credit_card: 'credit card',
  cash: 'cash',
  other: 'other',
}

interface MarkPaidBody {
  paid_date?: unknown
  paid_amount?: unknown
  payment_method?: unknown
  reference_number?: unknown
  notes?: unknown
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params

  try {
    // ── Auth ──
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!hasPermission(auth.role, 'invoices:mark_paid')) {
      return NextResponse.json(
        { error: 'You do not have permission to mark invoices paid' },
        { status: 403 }
      )
    }

    // ── Parse + validate body ──
    let body: MarkPaidBody
    try {
      body = (await request.json()) as MarkPaidBody
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const paidDate = typeof body.paid_date === 'string' ? body.paid_date : ''
    const paidAmountRaw = body.paid_amount
    const paymentMethod = body.payment_method as PaymentMethod
    const referenceNumber =
      typeof body.reference_number === 'string' ? body.reference_number.trim() : ''
    const userNotes = typeof body.notes === 'string' ? body.notes.trim() : ''

    // paid_date — required, must be YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) {
      return NextResponse.json(
        { error: 'paid_date is required in YYYY-MM-DD format' },
        { status: 400 }
      )
    }

    // paid_amount — required, must be a positive number
    const paidAmount =
      typeof paidAmountRaw === 'number'
        ? paidAmountRaw
        : Number(paidAmountRaw)
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      return NextResponse.json(
        { error: 'paid_amount must be a positive number' },
        { status: 400 }
      )
    }

    // payment_method — required, must be one of the allowed values
    if (!ALLOWED_METHODS.includes(paymentMethod)) {
      return NextResponse.json(
        {
          error: `payment_method must be one of: ${ALLOWED_METHODS.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // ── Fetch invoice + verify ownership ──
    const supabase = getServiceClient()

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select(
        'id, organization_id, status, total_amount, notes, invoice_number'
      )
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (invError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (invoice.status === 'void') {
      return NextResponse.json(
        { error: 'Cannot mark a voided invoice as paid' },
        { status: 400 }
      )
    }

    // ── Compute new status ──
    const totalAmount = Number(invoice.total_amount) || 0
    const newStatus: 'paid' | 'partially_paid' =
      paidAmount >= totalAmount ? 'paid' : 'partially_paid'

    // ── Build the appended notes line ──
    // Example: "[Marked paid 2026-04-30 by check #4521]"
    //          "[Marked paid 2026-04-30 by wire ref ABC123]"
    //          "[Marked paid 2026-04-30 by ACH]"
    const methodLabel = METHOD_LABELS[paymentMethod]
    let methodPart = `by ${methodLabel}`
    if (referenceNumber) {
      if (paymentMethod === 'check') {
        methodPart = `by check #${referenceNumber}`
      } else if (paymentMethod === 'wire') {
        methodPart = `by wire ref ${referenceNumber}`
      } else {
        methodPart = `by ${methodLabel} (ref ${referenceNumber})`
      }
    }
    const appendedLine = `[Marked paid ${paidDate} ${methodPart}]`
    const userNotesPart = userNotes ? `\n${userNotes}` : ''
    const existingNotes = (invoice.notes as string | null) || ''
    const combinedNotes = existingNotes
      ? `${existingNotes}\n${appendedLine}${userNotesPart}`
      : `${appendedLine}${userNotesPart}`

    // ── Update invoice ──
    const { data: updated, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: newStatus,
        paid_date: paidDate,
        paid_amount: paidAmount,
        payment_method: paymentMethod,
        notes: combinedNotes,
      })
      .eq('id', invoiceId)
      .select('*, clients(company_name)')
      .single()

    if (updateError || !updated) {
      console.error('Failed to update invoice:', updateError?.message)
      return NextResponse.json(
        {
          error: 'Failed to mark invoice paid',
          ...(process.env.NODE_ENV === 'development' && {
            detail: updateError?.message,
          }),
        },
        { status: 500 }
      )
    }

    // ── Activity log ──
    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'invoice_marked_paid',
      entity_type: 'invoice',
      entity_id: invoiceId,
      metadata: {
        amount: paidAmount,
        method: paymentMethod,
        reference_number: referenceNumber || null,
        invoice_number: invoice.invoice_number,
        new_status: newStatus,
      },
    })

    return NextResponse.json({ success: true, invoice: updated })
  } catch (err) {
    console.error('Mark invoice paid failed:', err)
    const errMsg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      {
        error: 'Failed to mark invoice paid',
        ...(process.env.NODE_ENV === 'development' && { detail: errMsg }),
      },
      { status: 500 }
    )
  }
}
