/**
 * POST /api/proposals/[id]/submit-for-approval
 *
 * Transition: draft → pending_admin_approval. Tech submits their estimate
 * to the office manager for review.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'proposals:create')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const supabase = getServiceClient()
    const { data: existing } = await supabase
      .from('proposals')
      .select('id, organization_id, status, created_by')
      .eq('id', id)
      .single()
    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (existing.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: `Cannot submit a proposal in '${existing.status}' status` },
        { status: 400 }
      )
    }
    const { data: updated, error } = await supabase
      .from('proposals')
      .update({
        status: 'pending_admin_approval',
        submitted_for_approval_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, proposal: updated })
  } catch (err) {
    console.error('submit-for-approval failed:', err)
    return NextResponse.json({ error: 'Failed to submit for approval' }, { status: 500 })
  }
}
