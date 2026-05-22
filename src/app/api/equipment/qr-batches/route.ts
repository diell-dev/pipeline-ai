/**
 * QR Batch endpoints — pre-printed sticker management.
 *
 *   POST /api/equipment/qr-batches  — generate a new batch
 *   GET  /api/equipment/qr-batches  — list batches with claimed/unclaimed counts
 *
 * Auth: equipment:manage_qr_batches (owner / super_admin).
 *
 * Code-generation strategy:
 *  - Insert codes one-at-a-time with retry on 23505 (unique_violation).
 *    A small fixed retry budget protects against pathological collision
 *    storms while keeping the happy path simple.
 *  - batch_number is per-org and computed via SELECT MAX(batch_number)+1
 *    with a retry on duplicate insertion (two admins clicking at once).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser, hasPermission } from '@/lib/api-auth'
import { generateQrCode } from '@/lib/qr'

const MAX_BATCH_SIZE = 500
const MIN_BATCH_SIZE = 1
const CODE_RETRY_LIMIT = 10
const BATCH_NUM_RETRY_LIMIT = 5

export async function POST(request: NextRequest) {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:manage_qr_batches')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { count?: unknown; prefix?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const count = Number(body.count)
  if (!Number.isInteger(count) || count < MIN_BATCH_SIZE || count > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `count must be an integer between ${MIN_BATCH_SIZE} and ${MAX_BATCH_SIZE}` },
      { status: 400 }
    )
  }

  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 500) : null
  const rawPrefix = typeof body.prefix === 'string' ? body.prefix : ''
  const supabase = await createClient()

  // Resolve the default prefix from the org name if none provided
  let prefix = rawPrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  if (!prefix) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', auth.organizationId)
      .single()
    const orgName = (org?.name || 'EQUIP').toString()
    prefix = orgName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'EQUIP'
  }

  // ── Pick the next batch_number for this org with optimistic retry ──
  let batchId: string | null = null
  let batchNumber = 0
  for (let attempt = 0; attempt < BATCH_NUM_RETRY_LIMIT; attempt++) {
    const { data: lastBatch } = await supabase
      .from('equipment_qr_batches')
      .select('batch_number')
      .eq('organization_id', auth.organizationId)
      .order('batch_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    batchNumber = (lastBatch?.batch_number || 0) + 1

    const { data: inserted, error: insertErr } = await supabase
      .from('equipment_qr_batches')
      .insert({
        organization_id: auth.organizationId,
        batch_number: batchNumber,
        prefix,
        total_codes: count,
        notes,
        created_by: auth.userId,
      })
      .select('id')
      .single()

    if (!insertErr && inserted) {
      batchId = inserted.id
      break
    }

    // 23505 = unique violation (another admin grabbed our number) — retry
    const code = (insertErr as { code?: string } | null)?.code
    if (code !== '23505') {
      return NextResponse.json(
        { error: insertErr?.message || 'Failed to create batch' },
        { status: 500 }
      )
    }
  }

  if (!batchId) {
    return NextResponse.json(
      { error: 'Could not allocate a unique batch number after retries' },
      { status: 503 }
    )
  }

  // ── Insert codes one by one with collision retry ──
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    let inserted = false
    for (let attempt = 0; attempt < CODE_RETRY_LIMIT && !inserted; attempt++) {
      const code = generateQrCode(prefix)
      const { error: codeErr } = await supabase.from('equipment_qr_codes').insert({
        code,
        organization_id: auth.organizationId,
        batch_id: batchId,
      })
      if (!codeErr) {
        codes.push(code)
        inserted = true
        break
      }
      const c = (codeErr as { code?: string }).code
      if (c !== '23505') {
        // Unexpected error — roll the batch back and bail.
        await supabase.from('equipment_qr_batches').delete().eq('id', batchId)
        return NextResponse.json(
          { error: `Failed to insert code: ${codeErr.message}` },
          { status: 500 }
        )
      }
    }
    if (!inserted) {
      await supabase.from('equipment_qr_batches').delete().eq('id', batchId)
      return NextResponse.json(
        { error: 'Exceeded collision retry limit while generating codes' },
        { status: 503 }
      )
    }
  }

  // Activity log — useful for audit + admin dashboard
  await supabase.from('activity_log').insert({
    organization_id: auth.organizationId,
    user_id: auth.userId,
    action: 'equipment_qr_batch_generated',
    entity_type: 'equipment',
    entity_id: batchId,
    metadata: { batch_number: batchNumber, prefix, count },
  })

  return NextResponse.json({
    batch_id: batchId,
    batch_number: batchNumber,
    prefix,
    codes,
  })
}

export async function GET() {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  if (!hasPermission(auth.role, 'equipment:manage_qr_batches')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  const isSuperAdmin = auth.role === 'super_admin'
  let batchesQ = supabase
    .from('equipment_qr_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (!isSuperAdmin) batchesQ = batchesQ.eq('organization_id', auth.organizationId)
  const { data: batches, error } = await batchesQ

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // For each batch fetch claimed/unclaimed counts. Two HEAD count queries
  // per batch — cheap, and batches grow slowly (admins rarely > a few/year).
  const enriched = await Promise.all(
    (batches || []).map(async (b) => {
      const [{ count: claimed }, { count: unclaimed }] = await Promise.all([
        supabase
          .from('equipment_qr_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', b.id)
          .not('claimed_at', 'is', null),
        supabase
          .from('equipment_qr_codes')
          .select('*', { count: 'exact', head: true })
          .eq('batch_id', b.id)
          .is('claimed_at', null),
      ])
      return {
        ...b,
        claimed_count: claimed || 0,
        unclaimed_count: unclaimed || 0,
      }
    })
  )

  return NextResponse.json({ batches: enriched })
}
