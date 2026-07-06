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
  total_cents?: number | null
  amount_paid_cents?: number | null
  balance_due_cents?: number | null
  status?: string | null
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

  // Never create a payment link for an invoice that isn't collectable.
  if (invoice.status && ['paid', 'void', 'cancelled'].includes(invoice.status)) {
    throw new Error(`Invoice is '${invoice.status}' — no payment link needed`)
  }

  // Charge the OUTSTANDING balance in cents (source of truth), not the
  // full legacy decimal total. Falls back gracefully for older rows.
  const amountPaidCents = invoice.amount_paid_cents ?? 0
  const balanceCents =
    typeof invoice.balance_due_cents === 'number' && invoice.balance_due_cents > 0
      ? invoice.balance_due_cents
      : typeof invoice.total_cents === 'number' && invoice.total_cents > 0
        ? invoice.total_cents - amountPaidCents
        : Math.round(Number(invoice.total_amount) * 100)

  if (balanceCents <= 0) {
    throw new Error('Invoice has no outstanding balance to charge')
  }

  const stripe = getStripeClient()

  // Reuse an existing session only if it is still open AND its amount
  // still matches the current balance. Otherwise expire it and mint a
  // fresh one so the emailed total and the charged total can't diverge.
  if (invoice.stripe_checkout_session_id && invoice.stripe_payment_link_url) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        invoice.stripe_checkout_session_id,
        { stripeAccount: org.stripe_account_id }
      )
      if (existing.status === 'open' && existing.amount_total === balanceCents) {
        return {
          url: invoice.stripe_payment_link_url,
          session_id: invoice.stripe_checkout_session_id,
          reused: true,
        }
      }
      if (existing.status === 'open') {
        try {
          await stripe.checkout.sessions.expire(existing.id, {
            stripeAccount: org.stripe_account_id,
          })
        } catch {
          // best-effort; a stale open session left behind is harmless
        }
      }
    } catch {
      // Couldn't retrieve it — fall through and create a new session.
    }
  }

  const unitAmount = balanceCents

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
      success_url: `${appUrl}/pay/${invoice.id}?status=paid`,
      cancel_url: `${appUrl}/pay/${invoice.id}?status=cancelled`,
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
