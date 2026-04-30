/**
 * POST /api/jobs/[id]/reschedule
 *
 * Reschedules an already-scheduled job. Saves the original time
 * and reschedule reason on the job record. Logs activity.
 *
 * Body: { new_scheduled_time, new_end_time?, reason? }
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
    const { new_scheduled_time, new_end_time, reason } = body as {
      new_scheduled_time?: string
      new_end_time?: string
      reason?: string
    }

    if (!new_scheduled_time) {
      return NextResponse.json({ error: 'new_scheduled_time is required' }, { status: 400 })
    }

    const supabase = getServiceClient()

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, organization_id, scheduled_time, original_scheduled_time, estimated_duration_minutes')
      .eq('id', jobId)
      .is('deleted_at', null)
      .single()

    if (jobError || !job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.organization_id !== auth.organizationId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Compute end time if not provided
    let endTime = new_end_time
    if (!endTime && job.estimated_duration_minutes) {
      const start = new Date(new_scheduled_time)
      const end = new Date(start.getTime() + job.estimated_duration_minutes * 60_000)
      endTime = end.toISOString()
    }

    const updates: Record<string, unknown> = {
      scheduled_time: new_scheduled_time,
      scheduled_end_time: endTime || null,
      reschedule_reason: reason || null,
      service_date: new Date(new_scheduled_time).toISOString().slice(0, 10),
    }
    // Only set original_scheduled_time the first time the job is rescheduled
    if (!job.original_scheduled_time && job.scheduled_time) {
      updates.original_scheduled_time = job.scheduled_time
    }

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
      action: 'job_rescheduled',
      entity_type: 'job',
      entity_id: jobId,
      metadata: {
        from: job.scheduled_time,
        to: new_scheduled_time,
        reason: reason || null,
      },
    })

    return NextResponse.json({ job: updated })
  } catch (err) {
    console.error('POST /api/jobs/[id]/reschedule failed:', err)
    return NextResponse.json({ error: 'Failed to reschedule job' }, { status: 500 })
  }
}
