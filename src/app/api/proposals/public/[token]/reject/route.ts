/**
 * POST /api/proposals/public/[token]/reject
 *
 * Body: { reason: string }
 * Sets the proposal to client_rejected with the provided reason.
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

interface RejectBody {
  reason: string
}

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
  if (!checkRateLimit(`pub-prop-reject:${token}:${ip}`, { limit: 30, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const body = (await request.json()) as RejectBody
    if (!body.reason || !body.reason.trim()) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 })
    }
    const supabase = getServiceClient()

    const { data: proposal } = await supabase
      .from('proposals')
      .select('id, organization_id, status, valid_until')
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
    // Mirror the sign route's expiration check.
    if (proposal.valid_until && new Date(proposal.valid_until).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This estimate has expired' }, { status: 410 })
    }
    const { error } = await supabase
      .from('proposals')
      .update({
        status: 'client_rejected',
        client_rejected_at: new Date().toISOString(),
        client_rejection_reason: body.reason.trim(),
      })
      .eq('id', proposal.id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Public proposal reject failed:', err)
    return NextResponse.json({ error: 'Failed to reject proposal' }, { status: 500 })
  }
}
