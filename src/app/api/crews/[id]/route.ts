/**
 * /api/crews/[id]
 *
 * PATCH — update crew (name, color, lead_tech_id, is_active)
 * DELETE — soft-delete (set is_active = false)
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

async function loadCrew(id: string, orgId: string) {
  const supabase = getServiceClient()
  const { data: crew, error } = await supabase
    .from('crews')
    .select('id, organization_id')
    .eq('id', id)
    .single()
  if (error || !crew) return null
  if (crew.organization_id !== orgId) return null
  return crew
}

export async function PATCH(
  request: NextRequest,
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

    const crew = await loadCrew(id, auth.organizationId)
    if (!crew) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })

    const body = await request.json()
    const updates: Record<string, unknown> = {}
    if (typeof body.name === 'string') updates.name = body.name.trim()
    if (typeof body.color === 'string') updates.color = body.color
    if ('lead_tech_id' in body) updates.lead_tech_id = body.lead_tech_id || null
    if (typeof body.is_active === 'boolean') updates.is_active = body.is_active

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const supabase = getServiceClient()
    const { data: updated, error } = await supabase
      .from('crews')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'crew_updated',
      entity_type: 'user',
      entity_id: id,
      metadata: { updates },
    })

    return NextResponse.json({ crew: updated })
  } catch (err) {
    console.error('PATCH /api/crews/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to update crew' }, { status: 500 })
  }
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

    const crew = await loadCrew(id, auth.organizationId)
    if (!crew) return NextResponse.json({ error: 'Crew not found' }, { status: 404 })

    const supabase = getServiceClient()
    const { error } = await supabase
      .from('crews')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/crews/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to delete crew' }, { status: 500 })
  }
}
