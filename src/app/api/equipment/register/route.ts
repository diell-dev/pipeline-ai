/**
 * POST /api/equipment/register
 *
 * First-scan claim flow: a tech scans a fresh sticker, fills out the form,
 * and POSTs here. We insert an equipment row and atomically mark the QR
 * code claimed.
 *
 * If make + model are present we kick off an AI manufacturer lookup
 * fire-and-forget so the user isn't blocked on a slow Claude call.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission, canAccessOrg } from '@/lib/api-auth'
import { lookupManufacturerInfo, computeNextServiceDueDate } from '@/lib/equipment-ai'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cleanString(value: unknown, max = 200): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
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

  const qrCode = cleanString(body.qr_code, 64)
  const categoryId = cleanString(body.category_id, 64)
  const siteId = cleanString(body.site_id, 64)
  if (!qrCode || !categoryId || !siteId) {
    return NextResponse.json(
      { error: 'qr_code, category_id and site_id are required' },
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

  // 1. Verify QR exists, is in caller's org, and unclaimed
  const { data: qrRow, error: qrErr } = await supabase
    .from('equipment_qr_codes')
    .select('id, code, organization_id, claimed_at, equipment_id')
    .eq('code', qrCode)
    .maybeSingle()

  if (qrErr) return NextResponse.json({ error: qrErr.message }, { status: 500 })
  if (!qrRow) return NextResponse.json({ error: 'Unknown QR code' }, { status: 404 })
  if (!canAccessOrg(auth, qrRow.organization_id)) {
    return NextResponse.json({ error: 'Unknown QR code' }, { status: 404 })
  }
  if (qrRow.claimed_at || qrRow.equipment_id) {
    return NextResponse.json({ error: 'QR code already claimed' }, { status: 409 })
  }

  // 2. Verify the category + site belong to the org (defence in depth; RLS catches too)
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

  // 3. Insert equipment row
  const make = cleanString(body.make, 80)
  const model = cleanString(body.model, 80)
  const serial = cleanString(body.serial_number, 80)

  const insertPayload = {
    organization_id: auth.organizationId,
    site_id: siteId,
    unit_number: cleanString(body.unit_number, 40),
    common_area_name: cleanString(body.common_area_name, 80),
    category_id: categoryId,
    qr_code: qrCode,
    parent_equipment_id: parentEquipmentId,
    make,
    model,
    serial_number: serial,
    data_plate_photo_url: cleanString(body.data_plate_photo_url, 500),
    unit_photo_url: cleanString(body.unit_photo_url, 500),
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

  // 4. Mark QR claimed and link to equipment. If this fails, soft-rollback
  //    the equipment row so the QR isn't orphaned.
  const { error: claimErr } = await supabase
    .from('equipment_qr_codes')
    .update({
      claimed_at: new Date().toISOString(),
      equipment_id: equipment.id,
    })
    .eq('id', qrRow.id)
    .is('claimed_at', null) // race-condition guard: only claim if still unclaimed

  if (claimErr) {
    await supabase.from('equipment').delete().eq('id', equipment.id)
    return NextResponse.json(
      { error: `Failed to claim QR code: ${claimErr.message}` },
      { status: 500 }
    )
  }

  // 5. Activity log
  await supabase.from('activity_log').insert({
    organization_id: auth.organizationId,
    user_id: auth.userId,
    action: 'equipment_registered',
    entity_type: 'equipment',
    entity_id: equipment.id,
    metadata: { qr_code: qrCode, category_id: categoryId, site_id: siteId },
  })

  // 6. Fire-and-forget AI lookup if we have enough metadata
  if (make && model) {
    void (async () => {
      try {
        const info = await lookupManufacturerInfo(make, model, serial)
        if (!info) return
        const nextDue = computeNextServiceDueDate({
          manufactureDate: info.manufacture_date,
          installedDate: equipment.installed_date,
          lastServicedDate: equipment.last_serviced_date,
          serviceIntervalMonths:
            info.recommended_service_interval_months ||
            category.default_service_interval_months,
          categoryDefaultIntervalMonths: category.default_service_interval_months,
        })
        await supabase
          .from('equipment')
          .update({
            manufacture_date: info.manufacture_date,
            service_interval_months:
              info.recommended_service_interval_months ||
              category.default_service_interval_months,
            next_service_due_date: nextDue,
            ai_metadata: {
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
          .eq('id', equipment.id)
      } catch (err) {
        console.error('background AI lookup failed:', err)
      }
    })()
  }

  return NextResponse.json({ equipment }, { status: 201 })
}
