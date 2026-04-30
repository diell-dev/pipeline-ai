/**
 * POST /api/crew-members — add a user to a crew
 * Body: { crew_id, user_id }
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

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'crews:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { crew_id, user_id } = body as { crew_id?: string; user_id?: string }

    if (!crew_id || !user_id) {
      return NextResponse.json({ error: 'crew_id and user_id are required' }, { status: 400 })
    }

    const supabase = getServiceClient()

    // Verify crew belongs to org
    const { data: crew } = await supabase
      .from('crews')
      .select('id, organization_id')
      .eq('id', crew_id)
      .single()

    if (!crew || crew.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }

    // Verify user belongs to same org
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, organization_id')
      .eq('id', user_id)
      .single()

    if (!targetUser || targetUser.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 403 })
    }

    const { data: member, error } = await supabase
      .from('crew_members')
      .insert({ crew_id, user_id })
      .select()
      .single()

    if (error) {
      // Unique violation (already a member)
      if (error.code === '23505') {
        return NextResponse.json({ error: 'User is already in this crew' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ member }, { status: 201 })
  } catch (err) {
    console.error('POST /api/crew-members failed:', err)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
