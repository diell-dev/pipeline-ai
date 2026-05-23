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
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

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
