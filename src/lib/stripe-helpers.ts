/**
 * Stripe Helper Functions
 *
 * Reusable Stripe operations called from both API routes (e.g.
 * /api/stripe/checkout/create) and other server-side flows
 * (e.g. /api/jobs/[id]/send) so we don't have to do self-fetches.
 *
 * All functions take a Supabase service-role client (so the caller
 * controls auth/permissions before invoking).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getStripeClient } from '@/lib/stripe'

interface OrgStripeInfo {
  id: string
  stripe_account_id: string | null
  stripe_charges_enabled: boolean | null
}

interface InvoiceForCheckout {
  id: string
  organization_id: string
  invoice_number: string
  total_amount: number
  stripe_checkout_session_id: string | null
  stripe_payment_link_url: string | null
}

export interface CheckoutCreateResult {
  url: string
  session_id: string
  reused: boolean
}

/**
 * Create (or return the existing) Stripe Checkout Session for an invoice.
 *
 * The session is created on the organization's connected Stripe account.
 * Idempotent-ish: if the invoice already has a session URL we return it.
 */
export async function createInvoiceCheckoutSession(
  supabase: SupabaseClient,
  invoice: InvoiceForCheckout,
  org: OrgStripeInfo,
  appUrl: string
): Promise<CheckoutCreateResult> {
  if (!org.stripe_account_id) {
    throw new Error('Organization has not connected a Stripe account')
  }
  if (!org.stripe_charges_enabled) {
    throw new Error('Organization Stripe account is not yet enabled for charges')
  }

  // Reuse an existing session URL if one was already created for this invoice.
  if (invoice.stripe_checkout_session_id && invoice.stripe_payment_link_url) {
    return {
      url: invoice.stripe_payment_link_url,
      session_id: invoice.stripe_checkout_session_id,
      reused: true,
    }
  }

  const stripe = getStripeClient()
  const unitAmount = Math.round(Number(invoice.total_amount) * 100)

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: unitAmount,
            product_data: {
              name: `Invoice ${invoice.invoice_number}`,
            },
          },
        },
      ],
      payment_intent_data: {
        // No platform fee for v1
        application_fee_amount: 0,
      },
      success_url: `${appUrl}/invoices/${invoice.id}?paid=true`,
      cancel_url: `${appUrl}/invoices/${invoice.id}`,
      metadata: {
        invoice_id: invoice.id,
        organization_id: invoice.organization_id,
      },
    },
    {
      stripeAccount: org.stripe_account_id,
    }
  )

  if (!session.url) {
    throw new Error('Stripe did not return a Checkout URL')
  }

  // Persist on the invoice so the email and any retries can reuse it.
  await supabase
    .from('invoices')
    .update({
      stripe_checkout_session_id: session.id,
      stripe_payment_link_url: session.url,
    })
    .eq('id', invoice.id)

  return {
    url: session.url,
    session_id: session.id,
    reused: false,
  }
}
