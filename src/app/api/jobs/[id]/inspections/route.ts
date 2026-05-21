/**
 * Inspection checklist endpoints for a single job.
 *
 *   POST /api/jobs/[id]/inspections — bulk-insert checklist results
 *   GET  /api/jobs/[id]/inspections — list inspections grouped by equipment
 *
 * Body of POST:
 *   {
 *     equipment_id: uuid,
 *     items: [{ checklist_item_code, checklist_item_label, result: 'pass'|'fail'|'na', notes? }]
 *   }
 *
 * Auth:
 *   - jobs:edit_all  (managers+)  always allowed
 *   - jobs:edit_own  (tech)       allowed only if the tech submitted the job
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import type { InspectionResult } from '@/types/database'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_RESULTS: ReadonlySet<InspectionResult> = new Set(['pass', 'fail', 'na'])
const MAX_ITEMS = 100

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: { equipment_id?: unknown; items?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id : ''
  if (!equipmentId || !UUID_RE.test(equipmentId)) {
    return NextResponse.json({ error: 'Valid equipment_id is required' }, { status: 400 })
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 })
  }
  if (body.items.length > MAX_ITEMS) {
    return NextResponse.json({ error: `Too many items (max ${MAX_ITEMS})` }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify the job and the permission scope
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('id, organization_id, submitted_by, assigned_to')
    .eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle()

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (!canAccessOrg(auth, job.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const canEditAll = hasPermission(auth.role, 'jobs:edit_all')
  const canEditOwn = hasPermission(auth.role, 'jobs:edit_own')
  const isOwner = job.submitted_by === auth.userId || job.assigned_to === auth.userId
  if (!canEditAll && !(canEditOwn && isOwner)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify equipment belongs to same org
  const { data: equipment } = await supabase
    .from('equipment')
    .select('id, organization_id')
    .eq('id', equipmentId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!equipment) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (equipment.organization_id !== job.organization_id) {
    return NextResponse.json({ error: 'Cross-org inspection not allowed' }, { status: 403 })
  }

  // Build the insert rows
  const rows: Array<{
    job_id: string
    equipment_id: string
    checklist_item_code: string
    checklist_item_label: string
    result: InspectionResult
    notes: string | null
    recorded_by: string
  }> = []

  for (const raw of body.items as Array<Record<string, unknown>>) {
    const code = cleanString(raw.checklist_item_code, 60)
    const label = cleanString(raw.checklist_item_label, 200)
    const result = typeof raw.result === 'string' ? raw.result : ''
    if (!code || !label || !VALID_RESULTS.has(result as InspectionResult)) {
      return NextResponse.json(
        { error: 'Each item needs checklist_item_code, checklist_item_label, and result' },
        { status: 400 }
      )
    }
    rows.push({
      job_id: jobId,
      equipment_id: equipmentId,
      checklist_item_code: code,
      checklist_item_label: label,
      result: result as InspectionResult,
      notes: cleanString(raw.notes, 1000),
      recorded_by: auth.userId,
    })
  }

  const { data: inserted, error: insErr } = await supabase
    .from('equipment_inspections')
    .insert(rows)
    .select('*')

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Update last_serviced_date on equipment so the next-due calculation moves.
  await supabase
    .from('equipment')
    .update({ last_serviced_date: new Date().toISOString().slice(0, 10) })
    .eq('id', equipmentId)

  await supabase.from('activity_log').insert({
    organization_id: job.organization_id,
    user_id: auth.userId,
    action: 'equipment_inspected',
    entity_type: 'equipment',
    entity_id: equipmentId,
    metadata: { job_id: jobId, item_count: rows.length },
  })

  return NextResponse.json({ inspections: inserted || [] }, { status: 201 })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: jobId } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()

  // Verify the job is visible to the caller (RLS will filter, but check
  // existence so we can return a clean 404).
  const { data: job } = await supabase
    .from('jobs')
    .select('id, organization_id')
    .eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (!canAccessOrg(auth, job.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase
    .from('equipment_inspections')
    .select('*')
    .eq('job_id', jobId)
    .order('recorded_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Group by equipment_id for easier UI consumption
  const grouped: Record<string, typeof data> = {}
  for (const row of data || []) {
    const key = row.equipment_id as string
    if (!grouped[key]) grouped[key] = [] as typeof data
    ;(grouped[key] as NonNullable<typeof data>).push(row)
  }

  return NextResponse.json({ by_equipment: grouped })
}
