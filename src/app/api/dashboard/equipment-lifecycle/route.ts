/**
 * GET /api/dashboard/equipment-lifecycle
 *
 * Returns equipment-lifecycle metrics for the owner dashboard.
 *
 *   dueSoon         = next_service_due_date within next 90 days
 *   overdue         = next_service_due_date < today
 *   beyondLifespan  = manufacture_date + category.typical_lifespan_years < today
 *   byCategory[]    = per-category count and estimated replacement cost
 *
 * Costs are derived from category.estimated_replacement_cost — a rough
 * planning figure, not a quote.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'

const DUE_SOON_DAYS = 90
const QUERY_LIMIT = 10000

export async function GET() {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const supabase = await createClient()

  const { data: equipment, error } = await supabase
    .from('equipment')
    .select(`
      id, manufacture_date, next_service_due_date,
      category:category_id ( id, name, typical_lifespan_years, estimated_replacement_cost )
    `)
    .eq('organization_id', auth.organizationId)
    .is('deleted_at', null)
    .neq('status', 'removed')
    .limit(QUERY_LIMIT)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const today = new Date()
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const dueSoonCutoffMs = todayMs + DUE_SOON_DAYS * 24 * 60 * 60 * 1000

  let dueSoon = 0
  let dueSoonCost = 0
  let overdue = 0
  let overdueCost = 0
  let beyondLifespan = 0
  let beyondLifespanCost = 0

  // Per-category accumulator
  const byCategoryMap = new Map<
    string,
    { category_name: string; count: number; est_replacement_cost: number }
  >()

  for (const row of equipment || []) {
    // PostgREST may return joined rows as either an object or an array
    // depending on the relation; normalize defensively.
    const rawCat = row.category as unknown
    const cat = (Array.isArray(rawCat) ? rawCat[0] : rawCat) as
      | {
          id: string
          name: string
          typical_lifespan_years: number
          estimated_replacement_cost: number | string
        }
      | null

    const cost = cat ? Number(cat.estimated_replacement_cost) || 0 : 0

    if (cat) {
      const bucket = byCategoryMap.get(cat.id) || {
        category_name: cat.name,
        count: 0,
        est_replacement_cost: 0,
      }
      bucket.count += 1
      bucket.est_replacement_cost += cost
      byCategoryMap.set(cat.id, bucket)
    }

    // Due-date analysis
    if (row.next_service_due_date) {
      const dueMs = Date.parse(row.next_service_due_date + 'T00:00:00Z')
      if (Number.isFinite(dueMs)) {
        if (dueMs < todayMs) {
          overdue += 1
          overdueCost += cost
        } else if (dueMs <= dueSoonCutoffMs) {
          dueSoon += 1
          dueSoonCost += cost
        }
      }
    }

    // Lifespan analysis
    if (row.manufacture_date && cat?.typical_lifespan_years) {
      const mfgMs = Date.parse(row.manufacture_date + 'T00:00:00Z')
      if (Number.isFinite(mfgMs)) {
        const endMs = mfgMs + cat.typical_lifespan_years * 365.25 * 24 * 60 * 60 * 1000
        if (endMs < todayMs) {
          beyondLifespan += 1
          beyondLifespanCost += cost
        }
      }
    }
  }

  const byCategory = Array.from(byCategoryMap.values()).sort((a, b) => b.count - a.count)

  return NextResponse.json({
    dueSoon,
    dueSoonCost: Math.round(dueSoonCost * 100) / 100,
    overdue,
    overdueCost: Math.round(overdueCost * 100) / 100,
    beyondLifespan,
    beyondLifespanCost: Math.round(beyondLifespanCost * 100) / 100,
    byCategory,
  })
}
