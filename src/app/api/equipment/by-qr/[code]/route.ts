/**
 * POST /api/equipment/by-qr/[code]
 *
 * Authenticated lookup for a sticker code. Returns one of three states:
 *
 *   - 404                          : code unknown OR not in caller's org
 *   - { claimed: false, qrCode }   : sticker exists but no equipment yet
 *                                    (UI should render the registration form)
 *   - { claimed: true, equipment } : sticker linked to an equipment record
 *                                    (UI should render the equipment detail)
 *
 * Also writes an equipment_scans row for audit/analytics. The optional
 * `{ action }` body lets the caller distinguish a passive view from an
 * intentional registration scan.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, canAccessOrg } from '@/lib/api-auth'
import type { EquipmentScanAction } from '@/types/database'

const VALID_ACTIONS: ReadonlySet<EquipmentScanAction> = new Set([
  'view',
  'register',
  'service_request',
  'inspection',
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const safeCode = (code || '').trim()
  if (!safeCode || safeCode.length > 64) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Best-effort body parse — action is optional
  let action: EquipmentScanAction = 'view'
  try {
    const body = await request.json()
    if (typeof body?.action === 'string' && VALID_ACTIONS.has(body.action as EquipmentScanAction)) {
      action = body.action as EquipmentScanAction
    }
  } catch {
    // empty body is fine
  }

  const supabase = await createClient()

  const { data: qrRow, error: qrErr } = await supabase
    .from('equipment_qr_codes')
    .select('id, code, organization_id, claimed_at, equipment_id')
    .eq('code', safeCode)
    .maybeSingle()

  if (qrErr) {
    return NextResponse.json({ error: qrErr.message }, { status: 500 })
  }
  if (!qrRow) {
    return NextResponse.json({ error: 'Unknown QR code' }, { status: 404 })
  }
  if (!canAccessOrg(auth, qrRow.organization_id)) {
    // Don't leak existence to other tenants
    return NextResponse.json({ error: 'Unknown QR code' }, { status: 404 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = request.headers.get('user-agent')?.slice(0, 500) || null

  // Audit scan (fire-and-forget — don't block response on failure)
  void supabase
    .from('equipment_scans')
    .insert({
      equipment_id: qrRow.equipment_id,
      qr_code: safeCode,
      scanned_by: auth.userId,
      action,
      ip_address: ip,
      user_agent: ua,
    })
    .then(({ error }) => {
      if (error) console.warn('scan insert failed:', error.message)
    })

  if (!qrRow.claimed_at || !qrRow.equipment_id) {
    return NextResponse.json({ claimed: false, qrCode: safeCode })
  }

  // Load equipment + category + site
  const { data: equipment, error: eqErr } = await supabase
    .from('equipment')
    .select(`
      *,
      category:category_id ( id, code, name, icon, inspection_checklist, typical_lifespan_years, default_service_interval_months, estimated_replacement_cost ),
      site:site_id ( id, name, address, borough )
    `)
    .eq('id', qrRow.equipment_id)
    .is('deleted_at', null)
    .maybeSingle()

  if (eqErr) {
    return NextResponse.json({ error: eqErr.message }, { status: 500 })
  }
  if (!equipment) {
    // Edge case: QR is claimed but the equipment was soft-deleted
    return NextResponse.json({ claimed: false, qrCode: safeCode })
  }

  return NextResponse.json({ claimed: true, equipment })
}
