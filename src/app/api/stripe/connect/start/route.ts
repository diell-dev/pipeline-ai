/**
 * POST /api/stripe/connect/start
 *
 * Owner-only. Begins (or resumes) Stripe Connect Express onboarding.
 *  - Creates a Stripe Express account if one doesn't already exist.
 *  - Generates an Account Link (one-time onboarding URL).
 *  - Returns { url } for the client to redirect to.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'
import { getStripeClient } from '@/lib/stripe'

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
        { error: 'Only owners can connect Stripe' },
        { status: 403 }
      )
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    if (!appUrl) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_APP_URL is not configured' },
        { status: 500 }
      )
    }

    const stripe = getStripeClient()
    const supabase = getServiceClient()

    // Fetch the org
    const { data: org, error: orgErr } = await supabase
      .from('organizations')
      .select('id, name, company_email, stripe_account_id, stripe_account_status')
      .eq('id', auth.organizationId)
      .single()

    if (orgErr || !org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Create the Express account if needed
    let accountId = org.stripe_account_id as string | null

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: (org.company_email as string | null) ?? undefined,
        business_profile: {
          name: org.name as string,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      })

      accountId = account.id

      const { error: updateErr } = await supabase
        .from('organizations')
        .update({
          stripe_account_id: accountId,
          stripe_account_status: 'pending',
          stripe_charges_enabled: false,
          stripe_payouts_enabled: false,
        })
        .eq('id', org.id)

      if (updateErr) {
        return NextResponse.json(
          { error: 'Failed to save Stripe account id' },
          { status: 500 }
        )
      }
    }

    // Build onboarding link
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${appUrl}/settings/payments?refresh=1`,
      return_url: `${appUrl}/settings/payments?return=1`,
      type: 'account_onboarding',
    })

    return NextResponse.json({ url: link.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Stripe Connect start failed'
    console.error('Stripe Connect start error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
