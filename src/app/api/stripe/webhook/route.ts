/**
 * POST /api/stripe/webhook
 *
 * Public route. Verifies Stripe signature, then dispatches on event type.
 *
 * Handled:
 *   checkout.session.completed  → mark invoice as paid via credit_card.
 *   account.updated             → sync connected account state to org.
 *
 * Other event types are acknowledged with 200 (so Stripe stops retrying).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type Stripe from 'stripe'
import { getStripeClient, deriveAccountStatus } from '@/lib/stripe'

// Force the runtime to read raw body — Next.js App Router gives us
// the raw text from request.text() directly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET not set')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 500 }
    )
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  // IMPORTANT: use the raw text body. Do NOT use request.json().
  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    const stripe = getStripeClient()
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature'
    console.error('Stripe webhook signature failed:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const supabase = getServiceClient()

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        await handleCheckoutCompleted(supabase, session)
        break
      }
      case 'account.updated': {
        const account = event.data.object as Stripe.Account
        await handleAccountUpdated(supabase, account)
        break
      }
      default:
        // Acknowledge but ignore other event types.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error(`Webhook handler error (${event.type}):`, err)
    // Return 500 so Stripe retries — but only when handling fails AFTER
    // signature verification. Signature errors above stay 400.
    return NextResponse.json({ error: 'Handler failed' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof getServiceClient>,
  session: Stripe.Checkout.Session
) {
  const invoiceId = session.metadata?.invoice_id
  const organizationId = session.metadata?.organization_id

  if (!invoiceId) {
    console.warn('checkout.session.completed without invoice_id metadata', session.id)
    return
  }

  // Fetch the invoice (we need total_amount + organization_id)
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('id, organization_id, total_amount, status')
    .eq('id', invoiceId)
    .single()

  if (invErr || !invoice) {
    console.warn('Invoice not found for completed checkout', invoiceId)
    return
  }

  // Skip double-application if already paid
  if (invoice.status === 'paid') return

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  const today = new Date().toISOString().slice(0, 10)

  const { error: updateErr } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_amount: invoice.total_amount,
      paid_date: today,
      payment_method: 'credit_card',
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq('id', invoiceId)

  if (updateErr) {
    throw new Error(`Failed to mark invoice paid: ${updateErr.message}`)
  }

  // Activity log (best-effort — don't fail the webhook if this errors).
  // We don't have a real user_id here so we use the organization's
  // first user; if none found, we skip the log.
  const orgId = organizationId || invoice.organization_id
  const { data: anyUser } = await supabase
    .from('users')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (anyUser?.id) {
    await supabase.from('activity_log').insert({
      organization_id: orgId,
      user_id: anyUser.id,
      action: 'invoice_paid_via_stripe',
      entity_type: 'invoice',
      entity_id: invoiceId,
      metadata: {
        stripe_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        amount: invoice.total_amount,
      },
    })
  }
}

async function handleAccountUpdated(
  supabase: ReturnType<typeof getServiceClient>,
  account: Stripe.Account
) {
  const status = deriveAccountStatus({
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
  })

  const { error } = await supabase
    .from('organizations')
    .update({
      stripe_account_status: status,
      stripe_charges_enabled: !!account.charges_enabled,
      stripe_payouts_enabled: !!account.payouts_enabled,
    })
    .eq('stripe_account_id', account.id)

  if (error) {
    throw new Error(`Failed to sync account state: ${error.message}`)
  }
}
