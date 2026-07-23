/**
 * POST /api/proposals/[id]/decline
 *
 * Staff-recorded decline: the client told us (by phone, on site, however) that
 * they don't want the work, and someone in the office records it here with a
 * reason. This is the counterpart to the CLIENT rejecting online via
 * /api/proposals/public/[token]/reject — same end state, different trigger.
 *
 * Reuses the existing 'client_rejected' status + client_rejection_reason
 * field (Diell's call, 2026-07-21), so a staff decline lands in the same
 * "Rejected" bucket as an online rejection and, because it's no longer
 * 'sent_to_client', the follow-up reminder cron stops chasing it automatically.
 *
 * Body: { reason: string }
 * Permission: proposals:approve (owner / office_manager).
 * Allowed from: admin_approved or sent_to_client (i.e. it's live with the
 * client but not yet signed/converted). Not from draft/signed/converted.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const DECLINABLE_STATUSES = ['admin_approved', 'sent_to_client'] as const
const MAX_REASON_LENGTH = 2000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'proposals:approve')) {
      return NextResponse.json(
        { error: 'You do not have permission to change proposals' },
        { status: 403 }
      )
    }

    const body = (await request.json().catch(() => ({}))) as { reason?: unknown }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 })
    }
    if (reason.length > MAX_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Reason is too long (max ${MAX_REASON_LENGTH} characters)` },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('proposals')
      .select('id, organization_id, status')
      .eq('id', id)
      .is('deleted_at', null)
      .single()
    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (!canAccessOrg(auth, existing.organization_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!(DECLINABLE_STATUSES as readonly string[]).includes(existing.status)) {
      return NextResponse.json(
        {
          error: `A proposal in '${existing.status}' status can't be marked declined.`,
        },
        { status: 400 }
      )
    }

    // Conditional update so two people acting at once can't race a signed /
    // converted proposal back into rejected.
    const { data: updated, error } = await supabase
      .from('proposals')
      .update({
        status: 'client_rejected',
        client_rejected_at: new Date().toISOString(),
        client_rejection_reason: reason,
      })
      .eq('id', id)
      .in('status', DECLINABLE_STATUSES as unknown as string[])
      .is('deleted_at', null)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'The proposal changed status — please refresh and try again.' },
        { status: 409 }
      )
    }

    return NextResponse.json({ success: true, proposal: updated })
  } catch (err) {
    console.error('proposal decline failed:', err)
    return NextResponse.json({ error: 'Failed to record the decline' }, { status: 500 })
  }
}
