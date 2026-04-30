/**
 * POST /api/stripe/checkout/create
 *
 * Body: { invoice_id }
 *
 * Auth: any logged-in user from the same org as the invoice. Creates
 * a Stripe Checkout Session on the org's connected Stripe account.
 *
 * If the invoice already has a session URL we return that one
 * (avoids creating duplicate sessions when the email is re-sent).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'
import { createInvoiceCheckoutSession } from '@/lib/stripe-helpers'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const body = (await request.json().catch(() => ({}))) as { invoice_id?: string }
    const invoiceId = body.invoice_id
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 })
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_APP_URL is not configured' },
        { status: 500 }
      )
    }

    const supabase = getServiceClient()

    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select(
        'id, organization_id, invoice_number, total_amount, stripe_checkout_session_id, stripe_payment_link_url'
      )
      .eq('id', invoiceId)
      .single()

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (invoice.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, stripe_account_id, stripe_charges_enabled')
      .eq('id', invoice.organization_id)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (!org.stripe_account_id) {
      return NextResponse.json(
        { error: 'Organization has not connected a Stripe account' },
        { status: 400 }
      )
    }
    if (!org.stripe_charges_enabled) {
      return NextResponse.json(
        { error: 'Stripe account is not yet enabled for charges' },
        { status: 400 }
      )
    }

    const result = await createInvoiceCheckoutSession(
      supabase,
      invoice,
      org,
      appUrl
    )

    return NextResponse.json({
      url: result.url,
      session_id: result.session_id,
      reused: result.reused,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout create failed'
    console.error('Stripe checkout create error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
