/**
 * GET /api/public/equipment/qr/[code]
 *
 * Tenant-facing scan endpoint. NO AUTH. Uses the service-role Supabase client
 * to bypass RLS — we explicitly filter the returned columns so we only expose
 * tenant-safe public information.
 *
 * NEVER return: organization_id, ai_metadata, internal notes, manufacture/
 * service dates, financials, serial numbers (those are an asset-tracking
 * primitive for the building owner, not the tenant).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const safeCode = (code || '').trim()
  if (!safeCode || safeCode.length > 64) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  const ip = getClientIp(request)
  if (!checkRateLimit(`pub-qr-get:${ip}`, { limit: 60, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const supabase = getServiceClient()

  const { data: qrRow, error: qrErr } = await supabase
    .from('equipment_qr_codes')
    .select('code, claimed_at, equipment_id, organization_id')
    .eq('code', safeCode)
    .maybeSingle()

  if (qrErr) return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  // For the public surface, treat unknown + unclaimed identically — never
  // confirm to a tenant that a sticker exists but is unclaimed (information
  // leak about admin operations).
  if (!qrRow || !qrRow.claimed_at || !qrRow.equipment_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Load minimal info — only the fields we are willing to expose publicly.
  const [
    { data: equipment },
    { data: org },
  ] = await Promise.all([
    supabase
      .from('equipment')
      .select(`
        unit_number, common_area_name, make,
        category:category_id ( name ),
        site:site_id ( name, address )
      `)
      .eq('id', qrRow.equipment_id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('organizations')
      .select('name, company_phone, company_email, logo_url, primary_color')
      .eq('id', qrRow.organization_id)
      .maybeSingle(),
  ])

  if (!equipment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Audit the public scan (best-effort)
  const auditIp = ip === 'unknown' ? null : ip
  const ua = request.headers.get('user-agent')?.slice(0, 500) || null
  void supabase
    .from('equipment_scans')
    .insert({
      equipment_id: qrRow.equipment_id,
      qr_code: safeCode,
      scanned_by: null, // tenant scan
      action: 'view',
      ip_address: auditIp,
      user_agent: ua,
    })
    .then(({ error }) => {
      if (error) console.warn('public scan insert failed:', error.message)
    })

  const category = equipment.category as { name?: string } | null
  const site = equipment.site as { name?: string; address?: string } | null

  // "makeOrCategory" picks a friendly identifier — branded make is more
  // informative if present, otherwise fall back to the category name.
  const makeOrCategory = equipment.make || category?.name || 'Equipment'

  return NextResponse.json({
    siteName: site?.name || null,
    siteAddress: site?.address || null,
    unitNumber: equipment.unit_number || null,
    commonAreaName: equipment.common_area_name || null,
    categoryName: category?.name || null,
    organizationName: org?.name || null,
    organizationPhone: org?.company_phone || null,
    organizationEmail: org?.company_email || null,
    // Public branding surface — tenants see the contractor's logo and color
    // when they scan a sticker. Both are nullable (a tenant with no brand
    // configured still gets a clean default).
    organizationLogoUrl: org?.logo_url || null,
    organizationPrimaryColor: org?.primary_color || null,
    makeOrCategory,
  })
}
