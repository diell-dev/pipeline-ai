/**
 * POST /api/stripe/connect/disconnect
 *
 * Owner-only. Detaches the Stripe account from this organization
 * locally. The remote Stripe Express account is intentionally left
 * intact so the user can reconnect to it later.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'

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

    const { error } = await supabase
      .from('organizations')
      .update({
        stripe_account_id: null,
        stripe_account_status: 'disconnected',
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      })
      .eq('id', auth.organizationId)

    if (error) {
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Disconnect failed'
    console.error('Stripe disconnect error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
