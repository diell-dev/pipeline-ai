/**
 * POST /api/crew-members — add a user to a crew
 * Body: { crew_id, user_id }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!hasPermission(auth.role, 'crews:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { crew_id, user_id } = body as { crew_id?: string; user_id?: string }

    if (!crew_id || !user_id) {
      return NextResponse.json({ error: 'crew_id and user_id are required' }, { status: 400 })
    }

    const supabase = await createClient()

    // Verify crew belongs to org
    const { data: crew } = await supabase
      .from('crews')
      .select('id, organization_id')
      .eq('id', crew_id)
      .single()

    if (!crew || !canAccessOrg(auth, crew.organization_id)) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }

    // Verify user belongs to same org
    const { data: targetUser } = await supabase
      .from('users')
      .select('id, organization_id, role')
      .eq('id', user_id)
      .single()

    if (!targetUser || !canAccessOrg(auth, targetUser.organization_id)) {
      return NextResponse.json({ error: 'User not in your organization' }, { status: 403 })
    }

    // Clients are external — never crew members.
    if (targetUser.role === 'client') {
      return NextResponse.json(
        { error: 'Clients cannot be crew members' },
        { status: 400 }
      )
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
