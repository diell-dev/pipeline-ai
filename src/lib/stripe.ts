/**
 * Stripe SDK Wrapper
 *
 * Centralised access to a Stripe client configured with the platform's
 * secret key. Returns a fresh client per call (Stripe's SDK is lightweight
 * and stateless). All Connect-related calls should pass `stripeAccount`
 * in the request options to act on behalf of a connected account.
 *
 * Env:
 *   STRIPE_SECRET_KEY        - Required. Platform secret key.
 *   STRIPE_WEBHOOK_SECRET    - Required for webhook signature verification.
 */
import Stripe from 'stripe'

// Pin the API version explicitly — never let Stripe silently upgrade.
export const STRIPE_API_VERSION = '2024-12-18.acacia' as const

let cached: Stripe | null = null

export function getStripeClient(): Stripe {
  if (cached) return cached

  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Add it to your environment to enable Stripe.'
    )
  }

  cached = new Stripe(secret, {
    apiVersion: STRIPE_API_VERSION as unknown as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: {
      name: 'Pipeline AI',
      version: '0.1.0',
    },
  })

  return cached
}

/**
 * Map Stripe account state into our normalized status enum.
 * - active     : charges + payouts both enabled
 * - restricted : details_submitted but Stripe blocked charges/payouts
 * - pending    : onboarding not yet completed
 */
export function deriveAccountStatus(account: {
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
}): 'pending' | 'active' | 'restricted' {
  if (account.charges_enabled && account.payouts_enabled) return 'active'
  if (account.details_submitted) return 'restricted'
  return 'pending'
}
