/**
 * POST /api/jobs/[id]/start-from-equipment
 *
 * NOTE: the `[id]` URL parameter is unused — this route is conceptually a
 * "create" endpoint living under /jobs for routing consistency. The new job
 * id is returned in the response.
 *
 * Body: { equipment_id }
 *
 * Creates a fresh job pre-filled from the equipment's site (and the client
 * derived from that site), then links the equipment to the new job via
 * equipment_jobs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'jobs:create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { equipment_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : ''
  if (!equipmentId || !UUID_RE.test(equipmentId)) {
    return NextResponse.json({ error: 'Valid equipment_id is required' }, { status: 400 })
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

  const today = new Date().toISOString().slice(0, 10)

  const { data: newJob, error: insertErr } = await supabase
    .from('jobs')
    .insert({
      organization_id: equipment.organization_id,
      client_id: clientId,
      site_id: equipment.site_id,
      submitted_by: auth.userId,
      status: 'scheduled',
      priority: 'normal',
      service_date: today,
    })
    .select('id')
    .single()

  if (insertErr || !newJob) {
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to create job' },
      { status: 500 }
    )
  }

  // Link the equipment
  await supabase
    .from('equipment_jobs')
    .insert({ equipment_id: equipmentId, job_id: newJob.id })

  // Activity log
  await supabase.from('activity_log').insert({
    organization_id: equipment.organization_id,
    user_id: auth.userId,
    action: 'job_created',
    entity_type: 'job',
    entity_id: newJob.id,
    metadata: { from_equipment_id: equipmentId },
  })

  return NextResponse.json({ job_id: newJob.id }, { status: 201 })
}
