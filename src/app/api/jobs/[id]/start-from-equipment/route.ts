/**
 * POST /api/jobs/[id]/start-from-equipment
 *
 * NOTE: the `[id]` URL parameter is unused — this route is conceptually a
 * "create" endpoint living under /jobs for routing consistency. The new job
 * id is returned in the response.
 *
 * Body: {
 *   equipment_id: uuid,
 *   scheduled_time?: ISO string,
 *   scheduled_end_time?: ISO string,
 *   estimated_duration_minutes?: number,
 *   assigned_to?: string | null,
 *   crew_id?: string | null,
 *   priority?: 'low' | 'normal' | 'high' | 'urgent',
 *   tech_notes?: string,
 * }
 *
 * Creates a job pre-filled from the equipment's site (and the client derived
 * from that site). All three writes (jobs, equipment_jobs, activity_log) are
 * wrapped in a single Postgres transaction via the `create_job_from_equipment`
 * RPC (migration 010) so we can't leave an orphan job behind.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])
const PAST_TOLERANCE_MS = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'jobs:create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    equipment_id?: unknown
    scheduled_time?: unknown
    scheduled_end_time?: unknown
    estimated_duration_minutes?: unknown
    assigned_to?: unknown
    crew_id?: unknown
    priority?: unknown
    tech_notes?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : ''
  if (!equipmentId || !UUID_RE.test(equipmentId)) {
    return NextResponse.json({ error: 'Valid equipment_id is required' }, { status: 400 })
  }

  // Optional UUID fields
  const assignedTo =
    typeof body.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null
  if (assignedTo && !UUID_RE.test(assignedTo)) {
    return NextResponse.json({ error: 'assigned_to must be a valid UUID' }, { status: 400 })
  }
  const crewId = typeof body.crew_id === 'string' && body.crew_id ? body.crew_id : null
  if (crewId && !UUID_RE.test(crewId)) {
    return NextResponse.json({ error: 'crew_id must be a valid UUID' }, { status: 400 })
  }
  if (assignedTo && crewId) {
    return NextResponse.json(
      { error: 'Provide only one of assigned_to or crew_id, not both' },
      { status: 400 }
    )
  }

  // Priority
  let priority = 'normal'
  if (body.priority !== undefined && body.priority !== null) {
    if (typeof body.priority !== 'string' || !VALID_PRIORITIES.has(body.priority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    priority = body.priority
  }

  // tech_notes
  let techNotes: string | null = null
  if (body.tech_notes !== undefined && body.tech_notes !== null) {
    if (typeof body.tech_notes !== 'string') {
      return NextResponse.json({ error: 'tech_notes must be a string' }, { status: 400 })
    }
    const trimmed = body.tech_notes.trim()
    techNotes = trimmed ? trimmed.slice(0, 5000) : null
  }

  // Duration
  let durationMinutes: number | null = null
  if (body.estimated_duration_minutes !== undefined && body.estimated_duration_minutes !== null) {
    const raw = body.estimated_duration_minutes
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > 24 * 60) {
      return NextResponse.json(
        { error: 'estimated_duration_minutes must be a positive number ≤ 1440' },
        { status: 400 }
      )
    }
    durationMinutes = Math.round(raw)
  }

  // Time validation
  let scheduledTime: string | null = null
  let scheduledEnd: string | null = null
  if (body.scheduled_time !== undefined && body.scheduled_time !== null) {
    if (typeof body.scheduled_time !== 'string') {
      return NextResponse.json({ error: 'scheduled_time must be an ISO string' }, { status: 400 })
    }
    const startMs = Date.parse(body.scheduled_time)
    if (isNaN(startMs)) {
      return NextResponse.json({ error: 'scheduled_time is not a valid date' }, { status: 400 })
    }
    if (startMs < Date.now() - PAST_TOLERANCE_MS) {
      return NextResponse.json(
        { error: 'scheduled_time may not be more than 5 minutes in the past' },
        { status: 400 }
      )
    }
    scheduledTime = new Date(startMs).toISOString()
  }

  if (body.scheduled_end_time !== undefined && body.scheduled_end_time !== null) {
    if (typeof body.scheduled_end_time !== 'string') {
      return NextResponse.json(
        { error: 'scheduled_end_time must be an ISO string' },
        { status: 400 }
      )
    }
    if (!scheduledTime) {
      return NextResponse.json(
        { error: 'scheduled_end_time requires scheduled_time' },
        { status: 400 }
      )
    }
    const endMs = Date.parse(body.scheduled_end_time)
    if (isNaN(endMs)) {
      return NextResponse.json({ error: 'scheduled_end_time is not a valid date' }, { status: 400 })
    }
    if (endMs <= Date.parse(scheduledTime)) {
      return NextResponse.json(
        { error: 'scheduled_end_time must be after scheduled_time' },
        { status: 400 }
      )
    }
    scheduledEnd = new Date(endMs).toISOString()
  }

  // Derive end from duration if absent
  let effectiveEnd: string | null = scheduledEnd
  if (!effectiveEnd && scheduledTime && durationMinutes) {
    const startMs = Date.parse(scheduledTime)
    effectiveEnd = new Date(startMs + durationMinutes * 60_000).toISOString()
  }

  const supabase = await createClient()

  const { data: equipment, error: eqErr } = await supabase
    .from('equipment')
    .select(`
      id, organization_id, site_id,
      site:site_id ( id, client_id )
    `)
    .eq('id', equipmentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (eqErr) return NextResponse.json({ error: eqErr.message }, { status: 500 })
  if (!equipment) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!canAccessOrg(auth, equipment.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const clientId = (equipment.site as { client_id?: string } | null)?.client_id
  if (!clientId) {
    return NextResponse.json({ error: 'Equipment site has no client' }, { status: 400 })
  }

  // Service date is the date portion of scheduled_time when present, else today.
  const serviceDate = scheduledTime
    ? scheduledTime.slice(0, 10)
    : new Date().toISOString().slice(0, 10)

  const { data: newJobId, error: rpcErr } = await supabase.rpc('create_job_from_equipment', {
    p_organization_id: equipment.organization_id,
    p_client_id: clientId,
    p_site_id: equipment.site_id,
    p_submitted_by: auth.userId,
    p_status: 'scheduled',
    p_priority: priority,
    p_service_date: serviceDate,
    p_scheduled_time: scheduledTime,
    p_scheduled_end_time: effectiveEnd,
    p_estimated_duration_minutes: durationMinutes,
    p_scheduled_by: scheduledTime ? auth.userId : null,
    p_assigned_to: assignedTo,
    p_crew_id: crewId,
    p_tech_notes: techNotes,
    p_equipment_id: equipmentId,
    p_log_action: scheduledTime ? 'job_scheduled' : 'job_created',
  })

  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 })

  return NextResponse.json({ job_id: newJobId }, { status: 201 })
}
