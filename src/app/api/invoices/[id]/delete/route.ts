/**
 * POST /api/invoices/[id]/delete
 *
 * Voids an invoice (soft-delete). Owner only.
 * The invoice number is preserved and marked as 'void'.
 * Invoice numbers are NEVER reused — voided numbers stay in the sequence.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params

  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!['owner', 'super_admin'].includes(auth.role)) {
      return NextResponse.json({ error: 'Only the owner can delete invoices' }, { status: 403 })
    }

    const supabase = getServiceClient()

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .select('id, organization_id, status, invoice_number')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single()

    if (invError || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Already voided
    if (invoice.status === 'void') {
      return NextResponse.json({ error: 'Invoice is already voided' }, { status: 400 })
    }

    // Cannot void a paid invoice
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Cannot delete a paid invoice. Refund first.' }, { status: 400 })
    }

    const now = new Date().toISOString()

    // Void the invoice — soft delete, preserve number
    await supabase
      .from('invoices')
      .update({ status: 'void', deleted_at: now })
      .eq('id', invoiceId)

    // Log
    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'invoice_voided',
      entity_type: 'invoice',
      entity_id: invoiceId,
      metadata: {
        invoice_number: invoice.invoice_number,
        previous_status: invoice.status,
        voided_by: auth.userId,
      },
    })

    return NextResponse.json({ success: true, invoice_number: invoice.invoice_number })
  } catch (err) {
    console.error('Void invoice failed:', err)
    return NextResponse.json({ error: 'Failed to void invoice' }, { status: 500 })
  }
}
