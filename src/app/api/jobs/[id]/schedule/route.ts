/**
 * POST /api/jobs/[id]/schedule
 *
 * Schedules an existing job — sets scheduled_time, scheduled_end_time, duration,
 * and either assigned_to (individual tech) OR crew_id.
 * Sets status to 'scheduled'. Logs activity.
 *
 * Body: {
 *   scheduled_time: ISO string,
 *   scheduled_end_time?: ISO string,
 *   estimated_duration_minutes?: number,
 *   assigned_to?: string | null,
 *   crew_id?: string | null
 * }
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params

  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'jobs:schedule')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const {
      scheduled_time,
      scheduled_end_time,
      estimated_duration_minutes,
      assigned_to,
      crew_id,
    } = body as {
      scheduled_time?: string
      scheduled_end_time?: string
      estimated_duration_minutes?: number
      assigned_to?: string | null
      crew_id?: string | null
    }

    if (!scheduled_time) {
      return NextResponse.json({ error: 'scheduled_time is required' }, { status: 400 })
    }

    const supabase = getServiceClient()

    // Verify job belongs to org
    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, organization_id, status')
      .eq('id', jobId)
      .is('deleted_at', null)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Compute end time if not provided but duration is
    let endTime = scheduled_end_time
    if (!endTime && estimated_duration_minutes) {
      const start = new Date(scheduled_time)
      const end = new Date(start.getTime() + estimated_duration_minutes * 60_000)
      endTime = end.toISOString()
    }

    const updates: Record<string, unknown> = {
      scheduled_time,
      scheduled_end_time: endTime || null,
      estimated_duration_minutes: estimated_duration_minutes || null,
      scheduled_by: auth.userId,
      status: 'scheduled',
    }

    // Either-or: assigned_to OR crew_id (not both)
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null
    if (crew_id !== undefined) updates.crew_id = crew_id || null
    // Service date should match the scheduled day
    updates.service_date = new Date(scheduled_time).toISOString().slice(0, 10)

    const { data: updated, error: updateError } = await supabase
      .from('jobs')
      .update(updates)
      .eq('id', jobId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'job_scheduled',
      entity_type: 'job',
      entity_id: jobId,
      metadata: {
        scheduled_time,
        scheduled_end_time: endTime,
        assigned_to: updates.assigned_to ?? null,
        crew_id: updates.crew_id ?? null,
      },
    })

    return NextResponse.json({ job: updated })
  } catch (err) {
    console.error('POST /api/jobs/[id]/schedule failed:', err)
    return NextResponse.json({ error: 'Failed to schedule job' }, { status: 500 })
  }
}
