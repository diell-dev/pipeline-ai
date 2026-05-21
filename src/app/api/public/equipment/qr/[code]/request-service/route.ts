/**
 * POST /api/public/equipment/qr/[code]/request-service
 *
 * Tenant submits a service request from the public scan page. Body:
 *   { requester_name, requester_email?, requester_phone?, description, urgency }
 *
 * Rate-limited to 5 req/min per IP per code to prevent abuse. The endpoint
 * is anonymous so this is the only protection on it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import type { ServiceRequestUrgency } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = SupabaseClient<any, 'public', any>

function getServiceClient(): ServiceClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, serviceKey)
}

const VALID_URGENCY: ReadonlySet<ServiceRequestUrgency> = new Set([
  'low',
  'normal',
  'high',
  'emergency',
])

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/[\x00-\x1f\x7f]/g, '')
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const safeCode = (code || '').trim()
  if (!safeCode || safeCode.length > 64) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  const ip = getClientIp(request)
  if (!checkRateLimit(`equipment-service-req:${safeCode}:${ip}`, { limit: 5, windowMs: 60_000 })) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const requesterName = cleanString(body.requester_name, 120)
  const description = cleanString(body.description, 2000)
  const urgencyRaw = typeof body.urgency === 'string' ? body.urgency : 'normal'

  if (!requesterName) {
    return NextResponse.json({ error: 'requester_name is required' }, { status: 400 })
  }
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (!VALID_URGENCY.has(urgencyRaw as ServiceRequestUrgency)) {
    return NextResponse.json({ error: 'Invalid urgency' }, { status: 400 })
  }

  const requesterEmailRaw = cleanString(body.requester_email, 200)
  if (requesterEmailRaw && !EMAIL_RE.test(requesterEmailRaw)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  const requesterPhone = cleanString(body.requester_phone, 40)

  const supabase = getServiceClient()

  const { data: qrRow } = await supabase
    .from('equipment_qr_codes')
    .select('claimed_at, equipment_id')
    .eq('code', safeCode)
    .maybeSingle()

  if (!qrRow || !qrRow.claimed_at || !qrRow.equipment_id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const ua = request.headers.get('user-agent')?.slice(0, 500) || null

  const { data: created, error: insErr } = await supabase
    .from('equipment_service_requests')
    .insert({
      equipment_id: qrRow.equipment_id,
      requester_name: requesterName,
      requester_email: requesterEmailRaw,
      requester_phone: requesterPhone,
      description,
      urgency: urgencyRaw as ServiceRequestUrgency,
      status: 'new',
      ip_address: ip,
      user_agent: ua,
    })
    .select('id, created_at')
    .single()

  if (insErr) {
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }

  // Best-effort scan audit + activity log (uses equipment.organization_id)
  void supabase
    .from('equipment')
    .select('organization_id')
    .eq('id', qrRow.equipment_id)
    .maybeSingle()
    .then(({ data: eqRow }) => {
      if (!eqRow) return
      void supabase.from('equipment_scans').insert({
        equipment_id: qrRow.equipment_id,
        qr_code: safeCode,
        scanned_by: null,
        action: 'service_request',
        ip_address: ip,
        user_agent: ua,
      })
      void supabase.from('activity_log').insert({
        organization_id: eqRow.organization_id,
        user_id: null,
        action: 'equipment_service_requested',
        entity_type: 'equipment',
        entity_id: qrRow.equipment_id,
        metadata: { service_request_id: created.id, urgency: urgencyRaw },
      })
    })

  return NextResponse.json({ success: true, request_id: created.id })
}
