/**
 * POST /api/proposals/[id]/admin-approve
 *
 * Transition: pending_admin_approval → admin_approved.
 * Office manager / owner reviews & approves the tech's estimate before sending to client.
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
    if (!apiHasPermission(auth.role, 'proposals:approve')) {
      return NextResponse.json({ error: 'You do not have permission to approve proposals' }, { status: 403 })
    }
    const supabase = getServiceClient()

    const { data: existing } = await supabase
      .from('proposals')
      .select('id, organization_id, status')
      .eq('id', id)
      .single()
    if (!existing) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }
    if (existing.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (existing.status !== 'pending_admin_approval') {
      return NextResponse.json(
        { error: `Cannot approve a proposal in '${existing.status}' status` },
        { status: 400 }
      )
    }
    const { data: updated, error } = await supabase
      .from('proposals')
      .update({
        status: 'admin_approved',
        admin_approved_at: new Date().toISOString(),
        admin_approved_by: auth.userId,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, proposal: updated })
  } catch (err) {
    console.error('admin-approve failed:', err)
    return NextResponse.json({ error: 'Failed to approve proposal' }, { status: 500 })
  }
}
