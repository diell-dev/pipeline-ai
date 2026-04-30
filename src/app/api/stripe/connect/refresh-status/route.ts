/**
 * POST /api/stripe/connect/refresh-status
 *
 * Owner-only. Pulls the current Stripe account state and syncs it
 * to the organizations row. Called after the user returns from
 * Stripe-hosted onboarding and from the "Refresh status" button.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'
import { getStripeClient, deriveAccountStatus } from '@/lib/stripe'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST() {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (auth.role !== 'owner' && auth.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Only owners can manage Stripe' },
        { status: 403 }
      )
    }

    const supabase = getServiceClient()

    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, stripe_account_id')
      .eq('id', auth.organizationId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (!org.stripe_account_id) {
      return NextResponse.json(
        { error: 'No Stripe account connected' },
        { status: 400 }
      )
    }

    const stripe = getStripeClient()
    const account = await stripe.accounts.retrieve(org.stripe_account_id as string)

    const status = deriveAccountStatus({
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
    })

    const { data: updated, error: updateErr } = await supabase
      .from('organizations')
      .update({
        stripe_account_status: status,
        stripe_charges_enabled: !!account.charges_enabled,
        stripe_payouts_enabled: !!account.payouts_enabled,
      })
      .eq('id', org.id)
      .select(
        'id, stripe_account_id, stripe_account_status, stripe_charges_enabled, stripe_payouts_enabled'
      )
      .single()

    if (updateErr) {
      return NextResponse.json({ error: 'Failed to sync status' }, { status: 500 })
    }

    return NextResponse.json({ organization: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed'
    console.error('Stripe refresh-status error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
