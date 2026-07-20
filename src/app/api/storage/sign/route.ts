/**
 * POST /api/storage/sign  (audit S1)
 *
 * Mints short-lived signed URLs for objects in the PRIVATE photo buckets.
 *
 * Why this exists
 * ---------------
 * `job-photos` and `equipment-photos` used to be public buckets: anyone
 * holding an object URL could fetch a photo taken inside a customer's
 * property, forever, with no auth. They are now private, so every read goes
 * through here and gets a URL that expires.
 *
 * Authorization model
 * -------------------
 * 1. Every path must sit under the caller's own organisation prefix
 *    (`<orgId>/…`), which is how uploads are laid out. super_admin excepted.
 * 2. For a portal client (`role='client'`) we additionally require that they
 *    can actually SEE the owning job — and we answer that by querying `jobs`
 *    with THEIR OWN session, so the existing RLS policies are the single
 *    source of truth. That means this endpoint can never drift from the
 *    client-visibility rules in migrations 025/027.
 * 3. Clients are refused `equipment-photos` outright: those paths carry no
 *    owning-record id, the module is staff-only, and migration 028 already
 *    blocks the role at the storage layer.
 *
 * Body:  { refs: string[] }   — stored values (legacy public URLs or paths)
 * Reply: { urls: Record<string, string | null> }  — input ref → signed URL
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { parseStorageRef, orgIdFromPath, jobIdFromPath } from '@/lib/storage-paths'

export const dynamic = 'force-dynamic'

/** Long enough to view a gallery and generate a PDF; short enough to matter. */
const SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

/** Guard against a caller asking us to sign an unbounded list. */
const MAX_REFS = 100

export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!(await enforceRateLimit(`storage-sign:${auth.userId}`, { limit: 120, windowMs: 60_000 }))) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = (await request.json().catch(() => ({}))) as { refs?: unknown }
    const refs = Array.isArray(body.refs) ? body.refs.filter((r): r is string => typeof r === 'string') : []

    if (refs.length === 0) {
      return NextResponse.json({ urls: {} })
    }
    if (refs.length > MAX_REFS) {
      return NextResponse.json({ error: `At most ${MAX_REFS} items per request` }, { status: 400 })
    }

    const isSuperAdmin = auth.role === 'super_admin'
    const isClient = auth.role === 'client'

    // Resolve + authorize each ref before signing anything.
    interface Pending {
      ref: string
      bucket: string
      path: string
    }
    const pending: Pending[] = []
    const urls: Record<string, string | null> = {}

    // Job ids we need to confirm the client may see.
    const jobIdsToCheck = new Set<string>()

    for (const ref of refs) {
      const parsed = parseStorageRef(ref)
      if (!parsed) {
        // Not a private-bucket reference (e.g. the still-public org logo, or
        // junk). Hand it back untouched rather than failing the whole batch.
        urls[ref] = null
        continue
      }

      const pathOrg = orgIdFromPath(parsed.path)
      if (!isSuperAdmin && pathOrg !== auth.organizationId) {
        urls[ref] = null
        continue
      }

      if (isClient) {
        if (parsed.bucket !== 'job-photos') {
          urls[ref] = null
          continue
        }
        const jobId = jobIdFromPath(parsed.path)
        if (!jobId) {
          urls[ref] = null
          continue
        }
        jobIdsToCheck.add(jobId)
      }

      pending.push({ ref, bucket: parsed.bucket, path: parsed.path })
    }

    // For clients: ask RLS which of those jobs they may actually see.
    let visibleJobIds: Set<string> | null = null
    if (isClient && jobIdsToCheck.size > 0) {
      const rlsClient = await createClient()
      const { data: visible } = await rlsClient
        .from('jobs')
        .select('id')
        .in('id', Array.from(jobIdsToCheck))
      visibleJobIds = new Set(((visible as { id: string }[] | null) ?? []).map((j) => j.id))
    } else if (isClient) {
      visibleJobIds = new Set()
    }

    const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceUrl || !serviceKey) {
      console.error('Storage signing unavailable — SUPABASE_SERVICE_ROLE_KEY not configured')
      return NextResponse.json({ error: 'Storage is not configured' }, { status: 503 })
    }
    const admin = createServiceClient(serviceUrl, serviceKey)

    // Group by bucket so we can use the batch signing API.
    const byBucket = new Map<string, Pending[]>()
    for (const item of pending) {
      if (isClient) {
        const jobId = jobIdFromPath(item.path)
        if (!jobId || !visibleJobIds?.has(jobId)) {
          urls[item.ref] = null
          continue
        }
      }
      const list = byBucket.get(item.bucket) ?? []
      list.push(item)
      byBucket.set(item.bucket, list)
    }

    for (const [bucket, items] of byBucket.entries()) {
      const { data, error } = await admin.storage
        .from(bucket)
        .createSignedUrls(
          items.map((i) => i.path),
          SIGNED_URL_TTL_SECONDS
        )

      if (error || !data) {
        console.error(`Signing failed for bucket ${bucket}:`, error?.message)
        for (const i of items) urls[i.ref] = null
        continue
      }

      // createSignedUrls preserves input order and reports per-item errors.
      data.forEach((entry, idx) => {
        const item = items[idx]
        if (!item) return
        urls[item.ref] = entry.error ? null : entry.signedUrl ?? null
      })
    }

    return NextResponse.json({ urls, expiresIn: SIGNED_URL_TTL_SECONDS })
  } catch (err) {
    console.error('Storage sign error:', err)
    return NextResponse.json({ error: 'Could not prepare photos' }, { status: 500 })
  }
}
