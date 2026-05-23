/**
 * POST /api/equipment/[id]/link-job
 *
 * Body: { job_id }
 * Idempotent insert into equipment_jobs. Both rows must belong to the
 * caller's org (RLS + explicit checks).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: equipmentId } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  // Either permission allows it — techs assigning their own equipment to a
  // job they're working on, or admins managing relationships.
  if (
    !hasPermission(auth.role, 'jobs:edit_all') &&
    !hasPermission(auth.role, 'equipment:edit')
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { job_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const jobId = typeof body.job_id === 'string' ? body.job_id : ''
  if (!jobId || !UUID_RE.test(jobId)) {
    return NextResponse.json({ error: 'Valid job_id is required' }, { status: 400 })
  }

  const supabase = await createClient()

  const [{ data: equipment }, { data: job }] = await Promise.all([
    supabase
      .from('equipment')
      .select('id, organization_id')
      .eq('id', equipmentId)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('jobs')
      .select('id, organization_id')
      .eq('id', jobId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (!equipment) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (!canAccessOrg(auth, equipment.organization_id) || !canAccessOrg(auth, job.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (equipment.organization_id !== job.organization_id) {
    return NextResponse.json({ error: 'Cross-org link not allowed' }, { status: 403 })
  }

  // Idempotent upsert — composite primary key (equipment_id, job_id)
  const { error: insertErr } = await supabase
    .from('equipment_jobs')
    .upsert(
      { equipment_id: equipmentId, job_id: jobId },
      { onConflict: 'equipment_id,job_id', ignoreDuplicates: true }
    )

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
