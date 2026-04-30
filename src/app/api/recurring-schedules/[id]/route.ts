/**
 * /api/recurring-schedules/[id]
 *
 * PATCH — update / pause (set paused_until) / resume (clear paused_until)
 * DELETE — end pattern (set is_active = false)
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

const ALLOWED_FIELDS = new Set([
  'assigned_to',
  'crew_id',
  'frequency',
  'day_of_week',
  'day_of_month',
  'scheduled_time',
  'estimated_duration_minutes',
  'service_ids',
  'advance_creation_days',
  'next_occurrence_date',
  'is_active',
  'paused_until',
  'notes',
])

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
    if (!apiHasPermission(auth.role, 'recurring:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getServiceClient()

    // Verify org match
    const { data: existing } = await supabase
      .from('recurring_job_schedules')
      .select('id, organization_id')
      .eq('id', id)
      .single()

    if (!existing || existing.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const body = await request.json()
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) updates[key] = value
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data: updated, error } = await supabase
      .from('recurring_job_schedules')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ schedule: updated })
  } catch (err) {
    console.error('PATCH /api/recurring-schedules/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to update schedule' }, { status: 500 })
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
    if (!apiHasPermission(auth.role, 'recurring:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getServiceClient()

    const { data: existing } = await supabase
      .from('recurring_job_schedules')
      .select('id, organization_id')
      .eq('id', id)
      .single()

    if (!existing || existing.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    const { error } = await supabase
      .from('recurring_job_schedules')
      .update({ is_active: false })
      .eq('id', id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/recurring-schedules/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to end schedule' }, { status: 500 })
  }
}
