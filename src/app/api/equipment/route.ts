/**
 * GET /api/equipment
 *
 * Filtered list of equipment. RLS scopes by org; this just layers filters
 * and pagination.
 *
 * Query params:
 *   site_id          uuid — filter by site
 *   category_id      uuid — filter by category
 *   due_within_days  int  — next_service_due_date within N days from today
 *   search           text — matches make / model / serial / unit_number / qr_code
 *   limit            int  — 1..200 (default 50)
 *   offset           int  — pagination offset (default 0)
 *
 * POST /api/equipment
 *
 * Register a piece of equipment that does NOT have its own QR sticker.
 * Used for sub-units of a parent system (e.g. a compressor inside a chiller).
 * Sticker-claim flow lives at POST /api/equipment/register.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

function cleanString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export async function GET(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const siteId = searchParams.get('site_id')
  const categoryId = searchParams.get('category_id')
  const dueWithinDays = searchParams.get('due_within_days')
  const search = (searchParams.get('search') || '').trim().slice(0, 80)
  const limitRaw = Number(searchParams.get('limit') || DEFAULT_LIMIT)
  const offsetRaw = Number(searchParams.get('offset') || 0)

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT))
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0)

  const supabase = await createClient()

  let q = supabase
    .from('equipment')
    .select(`
      *,
      category:category_id ( id, code, name, icon ),
      site:site_id ( id, name, address, borough ),
      parent:parent_equipment_id ( id, unit_number, make, model )
    `, { count: 'exact' })
    .is('deleted_at', null)

  if (siteId) {
    if (!UUID_RE.test(siteId)) return NextResponse.json({ error: 'Invalid site_id' }, { status: 400 })
    q = q.eq('site_id', siteId)
  }
  if (categoryId) {
    if (!UUID_RE.test(categoryId)) return NextResponse.json({ error: 'Invalid category_id' }, { status: 400 })
    q = q.eq('category_id', categoryId)
  }
  if (dueWithinDays) {
    const days = Number(dueWithinDays)
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      return NextResponse.json({ error: 'Invalid due_within_days' }, { status: 400 })
    }
    const dueBefore = new Date()
    dueBefore.setUTCDate(dueBefore.getUTCDate() + Math.floor(days))
    q = q.lte('next_service_due_date', dueBefore.toISOString().slice(0, 10))
  }
  if (search) {
    // Escape PostgREST `or` filter values — commas and parens have meaning.
    const safe = search.replace(/[(),%*]/g, ' ').slice(0, 80)
    q = q.or(
      `make.ilike.%${safe}%,model.ilike.%${safe}%,serial_number.ilike.%${safe}%,unit_number.ilike.%${safe}%,qr_code.ilike.%${safe}%`
    )
  }

  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    equipment: data || [],
    total: count ?? null,
    limit,
    offset,
  })
}

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:register')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const categoryId = cleanString(body.category_id, 64)
  const siteId = cleanString(body.site_id, 64)
  if (!categoryId || !siteId) {
    return NextResponse.json(
      { error: 'category_id and site_id are required' },
      { status: 400 }
    )
  }
  if (!UUID_RE.test(categoryId) || !UUID_RE.test(siteId)) {
    return NextResponse.json({ error: 'category_id and site_id must be UUIDs' }, { status: 400 })
  }

  const parentEquipmentId = cleanString(body.parent_equipment_id, 64)
  if (parentEquipmentId && !UUID_RE.test(parentEquipmentId)) {
    return NextResponse.json({ error: 'parent_equipment_id must be a UUID' }, { status: 400 })
  }

  const supabase = await createClient()

  // Verify category + site belong to org (defense-in-depth on top of RLS).
  const [{ data: category }, { data: site }] = await Promise.all([
    supabase
      .from('equipment_categories')
      .select('id, default_service_interval_months')
      .eq('id', categoryId)
      .eq('is_active', true)
      .maybeSingle(),
    supabase
      .from('sites')
      .select('id, organization_id')
      .eq('id', siteId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])

  if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  if (!canAccessOrg(auth, site.organization_id)) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 })
  }

  // Verify parent exists, is same-org, same-site, not deleted. We don't need
  // to walk the chain for cycles here — a brand-new row has no descendants.
  if (parentEquipmentId) {
    const { data: parent, error: parentErr } = await supabase
      .from('equipment')
      .select('id, organization_id, site_id, deleted_at')
      .eq('id', parentEquipmentId)
      .maybeSingle()

    if (parentErr) return NextResponse.json({ error: parentErr.message }, { status: 500 })
    if (
      !parent ||
      parent.deleted_at !== null ||
      !canAccessOrg(auth, parent.organization_id) ||
      parent.site_id !== siteId
    ) {
      return NextResponse.json({ error: 'Invalid parent_equipment_id' }, { status: 400 })
    }
  }

  const insertPayload = {
    organization_id: auth.organizationId,
    site_id: siteId,
    unit_number: cleanString(body.unit_number, 40),
    common_area_name: cleanString(body.common_area_name, 80),
    category_id: categoryId,
    qr_code: null as string | null,
    parent_equipment_id: parentEquipmentId,
    make: cleanString(body.make, 80),
    model: cleanString(body.model, 80),
    serial_number: cleanString(body.serial_number, 80),
    notes: cleanString(body.notes, 2000),
    service_interval_months: category.default_service_interval_months,
    created_by: auth.userId,
    status: 'active',
  }

  const { data: equipment, error: insertErr } = await supabase
    .from('equipment')
    .insert(insertPayload)
    .select('*')
    .single()

  if (insertErr || !equipment) {
    return NextResponse.json(
      { error: insertErr?.message || 'Failed to create equipment' },
      { status: 500 }
    )
  }

  await supabase.from('activity_log').insert({
    organization_id: auth.organizationId,
    user_id: auth.userId,
    action: 'equipment_registered',
    entity_type: 'equipment',
    entity_id: equipment.id,
    metadata: {
      category_id: categoryId,
      site_id: siteId,
      parent_equipment_id: parentEquipmentId,
      no_qr: true,
    },
  })

  return NextResponse.json({ equipment }, { status: 201 })
}
