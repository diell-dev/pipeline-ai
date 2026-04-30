/**
 * POST /api/proposals/public/[token]/sign
 *
 * Body: { signed_by_name, signed_by_email, signed_by_title?, signature_data, signature_type }
 *
 * Records the e-signature, updates the proposal to status='client_approved'.
 * Uses the service-role client (the public token IS the auth).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

interface SignBody {
  signed_by_name: string
  signed_by_email: string
  signed_by_title?: string | null
  signature_data: string
  signature_type: 'drawn' | 'typed'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 404 })
  }
  try {
    const body = (await request.json()) as SignBody

    // Validate input
    if (!body.signed_by_name || !body.signed_by_email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
    }
    if (!body.signature_data) {
      return NextResponse.json({ error: 'Signature is required' }, { status: 400 })
    }
    if (body.signature_type !== 'drawn' && body.signature_type !== 'typed') {
      return NextResponse.json({ error: 'Invalid signature_type' }, { status: 400 })
    }

    const supabase = getServiceClient()

    // Look up proposal
    const { data: proposal } = await supabase
      .from('proposals')
      .select('id, organization_id, status, valid_until, public_token')
      .eq('public_token', token)
      .is('deleted_at', null)
      .maybeSingle()

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (!['sent_to_client', 'admin_approved'].includes(proposal.status)) {
      return NextResponse.json(
        { error: `Cannot sign a proposal in '${proposal.status}' status` },
        { status: 400 }
      )
    }
    if (proposal.valid_until && new Date(proposal.valid_until).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This estimate has expired' }, { status: 400 })
    }

    // Capture IP + user agent
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      request.headers.get('x-real-ip') ||
      null
    const userAgent = request.headers.get('user-agent') || null

    // Insert signature
    const { error: sigError } = await supabase.from('proposal_signatures').insert({
      proposal_id: proposal.id,
      signed_by_name: body.signed_by_name,
      signed_by_email: body.signed_by_email,
      signed_by_title: body.signed_by_title || null,
      signature_data: body.signature_data,
      signature_type: body.signature_type,
      ip_address: ip,
      user_agent: userAgent,
    })
    if (sigError) {
      console.error('Failed to insert signature:', sigError.message)
      return NextResponse.json({ error: sigError.message }, { status: 500 })
    }

    // Update proposal status
    const { error: updateError } = await supabase
      .from('proposals')
      .update({
        status: 'client_approved',
        client_approved_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
    if (updateError) {
      console.error('Failed to update proposal status:', updateError.message)
    }

    // Activity log (best-effort)
    await supabase.from('activity_log').insert({
      organization_id: proposal.organization_id,
      user_id: null,
      action: 'job_approved',
      entity_type: 'job',
      entity_id: proposal.id,
      metadata: {
        proposal_signed: true,
        signed_by_name: body.signed_by_name,
        signed_by_email: body.signed_by_email,
      },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Public proposal sign failed:', err)
    return NextResponse.json({ error: 'Failed to sign proposal' }, { status: 500 })
  }
}
