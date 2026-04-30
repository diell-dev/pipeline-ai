/**
 * /api/crews
 *
 * GET — list crews for the current organization (with members)
 * POST — create a new crew (managers+) — inserts crew + crew_members in sequence,
 *        rolls back the crew if member insert fails.
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

// ── GET /api/crews ────────────────────────────────────────────
export async function GET() {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const supabase = getServiceClient()

    const { data: crews, error: crewsError } = await supabase
      .from('crews')
      .select(`
        *,
        lead_tech:lead_tech_id ( id, full_name, email, avatar_url ),
        crew_members (
          id,
          user_id,
          joined_at,
          users:user_id ( id, full_name, email, avatar_url, role )
        )
      `)
      .eq('organization_id', auth.organizationId)
      .order('name')

    if (crewsError) {
      return NextResponse.json({ error: crewsError.message }, { status: 500 })
    }

    return NextResponse.json({ crews: crews || [] })
  } catch (err) {
    console.error('GET /api/crews failed:', err)
    return NextResponse.json({ error: 'Failed to load crews' }, { status: 500 })
  }
}

// ── POST /api/crews ────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!apiHasPermission(auth.role, 'crews:manage')) {
      return NextResponse.json(
        { error: 'You do not have permission to create crews' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { name, color, lead_tech_id, member_user_ids } = body as {
      name?: string
      color?: string
      lead_tech_id?: string | null
      member_user_ids?: string[]
    }

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Crew name is required' }, { status: 400 })
    }

    const supabase = getServiceClient()

    // 1. Insert the crew
    const { data: crew, error: crewError } = await supabase
      .from('crews')
      .insert({
        organization_id: auth.organizationId,
        name: name.trim(),
        color: color || '#3B82F6',
        lead_tech_id: lead_tech_id || null,
        is_active: true,
      })
      .select()
      .single()

    if (crewError || !crew) {
      return NextResponse.json(
        { error: crewError?.message || 'Failed to create crew' },
        { status: 500 }
      )
    }

    // 2. Insert members (if any) — include lead tech if not already in list
    const memberSet = new Set<string>(member_user_ids || [])
    if (lead_tech_id) memberSet.add(lead_tech_id)

    if (memberSet.size > 0) {
      const memberRows = Array.from(memberSet).map((user_id) => ({
        crew_id: crew.id,
        user_id,
      }))

      const { error: membersError } = await supabase
        .from('crew_members')
        .insert(memberRows)

      if (membersError) {
        // Rollback: delete the crew we just made
        await supabase.from('crews').delete().eq('id', crew.id)
        return NextResponse.json(
          { error: `Failed to add members: ${membersError.message}` },
          { status: 500 }
        )
      }
    }

    // 3. Activity log
    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'crew_created',
      entity_type: 'user',
      entity_id: crew.id,
      metadata: { crew_name: crew.name, member_count: memberSet.size },
    })

    return NextResponse.json({ crew }, { status: 201 })
  } catch (err) {
    console.error('POST /api/crews failed:', err)
    return NextResponse.json({ error: 'Failed to create crew' }, { status: 500 })
  }
}
