/**
 * DELETE /api/crew-members/[id] — remove a crew_members row by its id
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'crews:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getServiceClient()

    // Verify the crew_member row exists and belongs to a crew in our org
    const { data: member } = await supabase
      .from('crew_members')
      .select('id, crew_id, crews:crew_id ( organization_id )')
      .eq('id', id)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const orgId = (member.crews as { organization_id?: string } | null)?.organization_id
    if (orgId !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await supabase.from('crew_members').delete().eq('id', id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/crew-members/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
