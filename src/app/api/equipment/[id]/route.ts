/**
 * Equipment detail endpoints:
 *
 *   GET    /api/equipment/[id]  — full record + hoisted relations + history
 *   PATCH  /api/equipment/[id]  — edit a subset of fields
 *   DELETE /api/equipment/[id]  — soft delete + release the QR
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_PARENT_CHAIN_HOPS = 20

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
  'category_id',
  'status',
])

const VALID_STATUSES = new Set(['active', 'inactive', 'replaced', 'removed'])

// Supabase's relational selects always widen to T[] even for one-to-one
// foreign-key joins. Normalize back to the single object (or null).
function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

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

  // Plain row fetch — no nested joins; we resolve relations explicitly
  // below so we can hoist them and reuse the same query for
  // organization-scope checks.
  const { data: equipment, error: eqErr } = await supabase
    .from('equipment')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (eqErr) return NextResponse.json({ error: eqErr.message }, { status: 500 })
  // Collapse "exists but not yours" into the same shape as "doesn't exist"
  // so we don't leak existence across tenants.
  if (!equipment || !canAccessOrg(auth, equipment.organization_id)) {
    return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  }

  // Parallel fetch the supporting collections. Keep payloads small for mobile.
  const [
    categoryRes,
    siteRes,
    parentRes,
    scansRes,
    eqJobsRes,
    childrenRes,
    inspectionsRes,
  ] = await Promise.all([
    equipment.category_id
      ? supabase
          .from('equipment_categories')
          .select('id, code, name, icon, default_service_interval_months, inspection_checklist')
          .eq('id', equipment.category_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    equipment.site_id
      ? supabase
          .from('sites')
          .select('id, name, address, borough, client_id')
          .eq('id', equipment.site_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    equipment.parent_equipment_id
      ? supabase
          .from('equipment')
          .select('id, unit_number, common_area_name, make, model, category_id')
          .eq('id', equipment.parent_equipment_id)
          .is('deleted_at', null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
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
        job:job_id ( id, service_date, status, priority, assigned_to )
      `)
      .eq('equipment_id', id)
      .order('added_at', { ascending: false })
      .limit(20),
    supabase
      .from('equipment')
      .select('id, unit_number, common_area_name, make, model, status, category_id')
      .eq('parent_equipment_id', id)
      .is('deleted_at', null)
      .limit(50),
    supabase
      .from('equipment_inspections')
      .select('id, job_id, checklist_item_label, result, notes, recorded_at, recorded_by')
      .eq('equipment_id', id)
      .order('recorded_at', { ascending: false })
      .limit(200),
  ])

  // Flatten the equipment_jobs nested join (widens to T[]).
  type EqJobRaw = {
    job_id: string
    added_at: string
    job: {
      id: string
      service_date: string
      status: string
      priority: string
      assigned_to: string | null
    } | Array<{
      id: string
      service_date: string
      status: string
      priority: string
      assigned_to: string | null
    }> | null
  }
  const eqJobsRaw = (eqJobsRes.data as EqJobRaw[] | null) || []
  const flattenedJobs = eqJobsRaw
    .map((row) => {
      const job = unwrapOne(row.job)
      if (!job) return null
      return {
        id: job.id,
        service_date: job.service_date,
        status: job.status,
        priority: job.priority,
        assigned_to: job.assigned_to,
      }
    })
    .filter((j): j is NonNullable<typeof j> => j !== null)

  // Collect the user-ids we need to resolve names for.
  const userIdSet = new Set<string>()
  for (const s of scansRes.data || []) {
    if (s.scanned_by) userIdSet.add(s.scanned_by as string)
  }
  for (const j of flattenedJobs) {
    if (j.assigned_to) userIdSet.add(j.assigned_to)
  }
  for (const ins of inspectionsRes.data || []) {
    if (ins.recorded_by) userIdSet.add(ins.recorded_by as string)
  }

  // Collect the category-ids we need to resolve names for (children + parent).
  const categoryIdSet = new Set<string>()
  for (const c of childrenRes.data || []) {
    if (c.category_id) categoryIdSet.add(c.category_id as string)
  }
  const parentRow = parentRes.data as
    | { id: string; unit_number: string | null; common_area_name: string | null; make: string | null; model: string | null; category_id: string | null }
    | null
  if (parentRow?.category_id) categoryIdSet.add(parentRow.category_id)

  const [usersRes, categoriesRes] = await Promise.all([
    userIdSet.size > 0
      ? supabase.from('users').select('id, full_name').in('id', Array.from(userIdSet))
      : Promise.resolve({ data: [], error: null }),
    categoryIdSet.size > 0
      ? supabase
          .from('equipment_categories')
          .select('id, name')
          .in('id', Array.from(categoryIdSet))
      : Promise.resolve({ data: [], error: null }),
  ])

  const userNameById = new Map<string, string>()
  for (const u of (usersRes.data || []) as Array<{ id: string; full_name: string | null }>) {
    userNameById.set(u.id, u.full_name || '')
  }
  const categoryNameById = new Map<string, string>()
  for (const c of (categoriesRes.data || []) as Array<{ id: string; name: string }>) {
    categoryNameById.set(c.id, c.name)
  }

  // Decorate scans with scanned_by_name.
  const scans = (scansRes.data || []).map((s) => ({
    id: s.id as string,
    qr_code: s.qr_code as string,
    action: s.action as string,
    scanned_at: s.scanned_at as string,
    scanned_by_name: s.scanned_by ? userNameById.get(s.scanned_by as string) || null : null,
  }))

  // Decorate jobs with tech_name (from assigned_to).
  const jobs = flattenedJobs.map((j) => ({
    id: j.id,
    service_date: j.service_date,
    status: j.status,
    priority: j.priority,
    tech_name: j.assigned_to ? userNameById.get(j.assigned_to) || null : null,
  }))

  // Decorate children with category_name.
  const children = (childrenRes.data || []).map((c) => ({
    id: c.id as string,
    unit_number: c.unit_number as string | null,
    common_area_name: c.common_area_name as string | null,
    make: c.make as string | null,
    model: c.model as string | null,
    status: c.status as string,
    category_name: c.category_id ? categoryNameById.get(c.category_id as string) || null : null,
  }))

  // Resolve parent (with category_name).
  const parent = parentRow
    ? {
        id: parentRow.id,
        unit_number: parentRow.unit_number,
        common_area_name: parentRow.common_area_name,
        make: parentRow.make,
        model: parentRow.model,
        category_name: parentRow.category_id
          ? categoryNameById.get(parentRow.category_id) || null
          : null,
      }
    : null

  // Group inspections by (job_id, recorded_at-rounded-to-5s) so rows
  // inserted a few ms apart from the same checklist session group as
  // one inspection.
  type InspRow = {
    id: string
    job_id: string | null
    checklist_item_label: string
    result: string
    notes: string | null
    recorded_at: string
    recorded_by: string | null
  }
  const inspectionGroups = new Map<
    string,
    {
      id: string
      job_id: string | null
      inspected_at: string
      inspected_by_name: string | null
      items: Array<{ label: string; result: string; notes: string | null }>
    }
  >()
  for (const row of (inspectionsRes.data || []) as InspRow[]) {
    const bucket = Math.floor(new Date(row.recorded_at).getTime() / 5000)
    const key = `${row.job_id ?? 'null'}|${bucket}`
    let group = inspectionGroups.get(key)
    if (!group) {
      group = {
        id: row.id,
        job_id: row.job_id,
        inspected_at: row.recorded_at,
        inspected_by_name: row.recorded_by
          ? userNameById.get(row.recorded_by) || null
          : null,
        items: [],
      }
      inspectionGroups.set(key, group)
    }
    group.items.push({
      label: row.checklist_item_label,
      result: row.result,
      notes: row.notes,
    })
  }
  const inspections = Array.from(inspectionGroups.values()).sort((a, b) =>
    a.inspected_at < b.inspected_at ? 1 : -1
  )

  // Strip the relation FKs we've already hoisted from the raw equipment
  // row so the client never sees stale embedded versions.
  const category = categoryRes.data || null
  const site = siteRes.data || null

  return NextResponse.json({
    equipment,
    category,
    site,
    parent,
    scans,
    jobs,
    children,
    inspections,
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
  // this gives a cleaner error message). Collapse "exists but wrong org"
  // into 404 so we don't leak existence cross-tenant.
  const { data: existing, error: exErr } = await supabase
    .from('equipment')
    .select('id, organization_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 })
  if (!existing || !canAccessOrg(auth, existing.organization_id)) {
    return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
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
      case 'category_id': {
        if (typeof value !== 'string' || !UUID_RE.test(value)) {
          return NextResponse.json({ error: 'category_id must be a UUID' }, { status: 400 })
        }
        // Confirm the category actually exists so the FK error doesn't
        // surface as an ugly 500.
        const { data: cat } = await supabase
          .from('equipment_categories')
          .select('id')
          .eq('id', value)
          .maybeSingle()
        if (!cat) {
          return NextResponse.json({ error: 'category_id not found' }, { status: 400 })
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

  // If the caller is moving this equipment under a new parent, validate
  // the proposed parent: it must exist, not be soft-deleted, be in the
  // same organization, and not create a cycle.
  if (typeof update.parent_equipment_id === 'string') {
    const proposedParentId = update.parent_equipment_id as string

    const { data: proposedParent, error: ppErr } = await supabase
      .from('equipment')
      .select('id, organization_id, parent_equipment_id, deleted_at')
      .eq('id', proposedParentId)
      .maybeSingle()

    if (ppErr) return NextResponse.json({ error: ppErr.message }, { status: 500 })
    if (
      !proposedParent ||
      proposedParent.deleted_at !== null ||
      proposedParent.organization_id !== existing.organization_id
    ) {
      return NextResponse.json({ error: 'Invalid parent_equipment_id' }, { status: 400 })
    }

    // Walk the chain up to MAX_PARENT_CHAIN_HOPS. If we ever land on the
    // edited equipment's id, that would create a cycle.
    let cursor: string | null = proposedParent.parent_equipment_id as string | null
    let hops = 0
    while (cursor && hops < MAX_PARENT_CHAIN_HOPS) {
      if (cursor === id) {
        return NextResponse.json({ error: 'Would create a cycle' }, { status: 400 })
      }
      const { data: next, error: nextErr } = await supabase
        .from('equipment')
        .select('parent_equipment_id')
        .eq('id', cursor)
        .maybeSingle()
      if (nextErr) return NextResponse.json({ error: nextErr.message }, { status: 500 })
      cursor = (next?.parent_equipment_id as string | null) ?? null
      hops++
    }
    if (cursor && hops >= MAX_PARENT_CHAIN_HOPS) {
      return NextResponse.json({ error: 'Hierarchy too deep' }, { status: 400 })
    }
  }

  const { data: updated, error: updErr } = await supabase
    .from('equipment')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // Fire-and-forget activity log entry.
  void supabase.from('activity_log').insert({
    organization_id: existing.organization_id,
    user_id: auth.userId,
    action: 'equipment_updated',
    entity_type: 'equipment',
    entity_id: id,
    metadata: { fields_changed: Object.keys(update) },
  })

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
  if (!existing || !canAccessOrg(auth, existing.organization_id)) {
    return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
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

  // Fire-and-forget activity log entry.
  void supabase.from('activity_log').insert({
    organization_id: existing.organization_id,
    user_id: auth.userId,
    action: 'equipment_deleted',
    entity_type: 'equipment',
    entity_id: id,
    metadata: { qr_code: existing.qr_code },
  })

  return NextResponse.json({ success: true })
}
