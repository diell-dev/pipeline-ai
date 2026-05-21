/**
 * Equipment detail endpoints:
 *
 *   GET    /api/equipment/[id]  — full record + joins + history
 *   PATCH  /api/equipment/[id]  — edit a subset of fields
 *   DELETE /api/equipment/[id]  — soft delete + release the QR
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Whitelist of editable fields — never trust the client about the rest.
const EDITABLE_FIELDS = new Set([
  'unit_number',
  'common_area_name',
  'make',
  'model',
  'serial_number',
  'manufacture_date',
  'installed_date',
  'next_service_due_date',
  'service_interval_months',
  'notes',
  'parent_equipment_id',
  'status',
])

const VALID_STATUSES = new Set(['active', 'inactive', 'replaced', 'removed'])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: equipment, error: eqErr } = await supabase
    .from('equipment')
    .select(`
      *,
      category:category_id (*),
      site:site_id ( id, name, address, borough, client_id )
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (eqErr) return NextResponse.json({ error: eqErr.message }, { status: 500 })
  if (!equipment) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!canAccessOrg(auth, equipment.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Parallel fetch the supporting collections (last 10 scans, last 10 jobs,
  // children, inspections). Keep payloads small for mobile.
  const [
    scansRes,
    eqJobsRes,
    childrenRes,
    inspectionsRes,
  ] = await Promise.all([
    supabase
      .from('equipment_scans')
      .select('id, qr_code, action, scanned_at, scanned_by')
      .eq('equipment_id', id)
      .order('scanned_at', { ascending: false })
      .limit(10),
    supabase
      .from('equipment_jobs')
      .select(`
        job_id,
        added_at,
        job:job_id ( id, service_date, status, priority )
      `)
      .eq('equipment_id', id)
      .order('added_at', { ascending: false })
      .limit(10),
    supabase
      .from('equipment')
      .select('id, unit_number, common_area_name, make, model, status, category_id')
      .eq('parent_equipment_id', id)
      .is('deleted_at', null)
      .limit(50),
    supabase
      .from('equipment_inspections')
      .select('*')
      .eq('equipment_id', id)
      .order('recorded_at', { ascending: false })
      .limit(50),
  ])

  return NextResponse.json({
    equipment,
    scans: scansRes.data || [],
    jobs: eqJobsRes.data || [],
    children: childrenRes.data || [],
    inspections: inspectionsRes.data || [],
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify the row exists + caller can access it (RLS already enforces but
  // this gives a cleaner error message).
  const { data: existing, error: exErr } = await supabase
    .from('equipment')
    .select('id, organization_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!canAccessOrg(auth, existing.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Build the update payload from whitelisted fields with validation.
  const update: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_FIELDS.has(key)) continue

    if (value === null) {
      update[key] = null
      continue
    }

    switch (key) {
      case 'manufacture_date':
      case 'installed_date':
      case 'next_service_due_date': {
        if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) {
          return NextResponse.json({ error: `${key} must be YYYY-MM-DD` }, { status: 400 })
        }
        update[key] = value
        break
      }
      case 'service_interval_months': {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > 240) {
          return NextResponse.json({ error: 'service_interval_months out of range' }, { status: 400 })
        }
        update[key] = n
        break
      }
      case 'parent_equipment_id': {
        if (typeof value !== 'string' || !UUID_RE.test(value)) {
          return NextResponse.json({ error: 'parent_equipment_id must be a UUID' }, { status: 400 })
        }
        if (value === id) {
          return NextResponse.json({ error: 'parent_equipment_id cannot equal id' }, { status: 400 })
        }
        update[key] = value
        break
      }
      case 'status': {
        if (typeof value !== 'string' || !VALID_STATUSES.has(value)) {
          return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
        }
        update[key] = value
        break
      }
      default: {
        // String fields — trim + cap
        if (typeof value !== 'string') {
          return NextResponse.json({ error: `${key} must be a string` }, { status: 400 })
        }
        update[key] = value.slice(0, key === 'notes' ? 4000 : 200)
      }
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  update.updated_at = new Date().toISOString()

  const { data: updated, error: updErr } = await supabase
    .from('equipment')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ equipment: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:delete')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()

  const { data: existing, error: exErr } = await supabase
    .from('equipment')
    .select('id, organization_id, qr_code')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!canAccessOrg(auth, existing.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now = new Date().toISOString()

  // Soft delete
  const { error: delErr } = await supabase
    .from('equipment')
    .update({ deleted_at: now, status: 'removed' })
    .eq('id', id)

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

  // Release the QR code so the sticker can be reused
  if (existing.qr_code) {
    await supabase
      .from('equipment_qr_codes')
      .update({ claimed_at: null, equipment_id: null })
      .eq('code', existing.qr_code)
  }

  return NextResponse.json({ success: true })
}
