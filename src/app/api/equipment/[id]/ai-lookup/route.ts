/**
 * POST /api/equipment/[id]/ai-lookup
 *
 * Synchronously runs the manufacturer lookup against Claude (text model) and
 * writes the results back to the equipment row. Used both when the
 * fire-and-forget call from registration failed AND when the user manually
 * taps "Refresh AI data" on the equipment detail screen.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, canAccessOrg, hasPermission } from '@/lib/api-auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { lookupManufacturerInfo, computeNextServiceDueDate } from '@/lib/equipment-ai'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: equipmentId } = await params

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // H15: throttle the paid Claude call per user.
  if (!(await enforceRateLimit(`equip-ai-lookup:${auth.userId}`, { limit: 20, windowMs: 60_000 }))) {
    return NextResponse.json({ error: 'Too many requests — slow down.' }, { status: 429 })
  }

  const supabase = await createClient()

  const { data: equipment, error: eqErr } = await supabase
    .from('equipment')
    .select(`
      *,
      category:category_id ( default_service_interval_months )
    `)
    .eq('id', equipmentId)
    .is('deleted_at', null)
    .maybeSingle()

  if (eqErr) return NextResponse.json({ error: eqErr.message }, { status: 500 })
  if (!equipment) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })
  if (!canAccessOrg(auth, equipment.organization_id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!equipment.make || !equipment.model) {
    return NextResponse.json(
      { error: 'Equipment must have make and model before AI lookup' },
      { status: 400 }
    )
  }

  const info = await lookupManufacturerInfo(
    equipment.make,
    equipment.model,
    equipment.serial_number
  )
  if (!info) {
    return NextResponse.json(
      { error: 'AI lookup unavailable. Try again later.' },
      { status: 503 }
    )
  }

  const categoryDefault =
    (equipment.category as { default_service_interval_months?: number } | null)
      ?.default_service_interval_months || 12

  const intervalMonths = info.recommended_service_interval_months || categoryDefault

  const nextDue = computeNextServiceDueDate({
    manufactureDate: info.manufacture_date || equipment.manufacture_date,
    installedDate: equipment.installed_date,
    lastServicedDate: equipment.last_serviced_date,
    serviceIntervalMonths: intervalMonths,
    categoryDefaultIntervalMonths: categoryDefault,
  })

  const { data: updated, error: updErr } = await supabase
    .from('equipment')
    .update({
      manufacture_date: info.manufacture_date || equipment.manufacture_date,
      service_interval_months: intervalMonths,
      next_service_due_date: nextDue,
      ai_metadata: {
        ...((equipment.ai_metadata as Record<string, unknown>) || {}),
        manufacture_date: info.manufacture_date,
        recommended_service_interval_months: info.recommended_service_interval_months,
        common_failure_modes: info.common_failure_modes,
        replacement_part_skus: info.replacement_part_skus,
        is_discontinued: info.is_discontinued,
        recall_notice: info.recall_notice,
        useful_life_years_estimate: info.useful_life_years_estimate,
        generated_at: new Date().toISOString(),
        model_version: 'claude-sonnet-4-6',
      },
    })
    .eq('id', equipmentId)
    .select('*')
    .single()

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ equipment: updated, ai_lookup: info })
}
