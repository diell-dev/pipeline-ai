/**
 * POST /api/proposals/public/[token]/sign
 *
 * Body: { signed_by_name, signed_by_email, signed_by_title?, signature_data, signature_type }
 *
 * Records the e-signature, updates the proposal to status='client_approved'.
 * Uses the service-role client (the public token IS the auth).
 *
 * Per-IP rate limited (30 req/min per IP per token).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

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

// Cap signature payload at ~150KB. Drawn PNGs at our canvas size land well
// under this; typed signatures are tiny. Anything bigger is either a misuse
// or an attempt at storage abuse.
const MAX_SIGNATURE_LENGTH = 200_000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!token) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  // ── Rate limit: 30 req/min per IP per token ──
  const ip = getClientIp(request)
  if (!checkRateLimit(`pub-prop-sign:${token}:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
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

    // Size cap on signature payload (covers drawn-canvas dataURL abuse)
    if (body.signature_data.length > MAX_SIGNATURE_LENGTH) {
      return NextResponse.json({ error: 'Signature too large' }, { status: 413 })
    }

    // Strip data URL prefix if present (smaller stored payload + normalizes
    // the input — the renderer can re-add the prefix when needed).
    let signaturePayload = body.signature_data
    const dataUrlMatch = signaturePayload.match(/^data:image\/[a-z+]+;base64,/)
    if (dataUrlMatch) {
      signaturePayload = signaturePayload.slice(dataUrlMatch[0].length)
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
    // Status-oracle prevention: if already signed/rejected/converted, return
    // 404 — same response an attacker would get for a token that never existed.
    if (!['sent_to_client', 'admin_approved'].includes(proposal.status)) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (proposal.valid_until && new Date(proposal.valid_until).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This estimate has expired' }, { status: 410 })
    }

    // Capture IP + user agent
    const userAgent = request.headers.get('user-agent') || null

    // Atomic claim FIRST — flip to client_approved only if the proposal is
    // still open. Prevents a sign+reject race and double-signing: if the
    // conditional update matches no row, someone already actioned it. (H16)
    const { data: claimed, error: claimErr } = await supabase
      .from('proposals')
      .update({
        status: 'client_approved',
        client_approved_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
      .in('status', ['sent_to_client', 'admin_approved'])
      .is('deleted_at', null)
      .select('id')
      .maybeSingle()
    if (claimErr) {
      console.error('Failed to claim proposal for signing:', claimErr.message)
      return NextResponse.json({ error: 'Could not record signature' }, { status: 500 })
    }
    if (!claimed) {
      return NextResponse.json(
        { error: 'This estimate is no longer open for signing.' },
        { status: 409 }
      )
    }

    // Insert signature AFTER the claim, so a rejected/converted proposal can
    // never accumulate a signature row.
    const { error: sigError } = await supabase.from('proposal_signatures').insert({
      proposal_id: proposal.id,
      signed_by_name: body.signed_by_name,
      signed_by_email: body.signed_by_email,
      signed_by_title: body.signed_by_title || null,
      signature_data: signaturePayload,
      signature_type: body.signature_type,
      ip_address: ip === 'unknown' ? null : ip,
      user_agent: userAgent,
    })
    if (sigError) {
      console.error('Failed to insert signature:', sigError.message)
      return NextResponse.json({ error: 'Could not record signature' }, { status: 500 })
    }

    // Activity log (best-effort)
    await supabase.from('activity_log').insert({
      organization_id: proposal.organization_id,
      user_id: null,
      action: 'job_approved',
      entity_type: 'proposal',
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
