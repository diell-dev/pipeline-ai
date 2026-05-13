/**
 * Simple in-memory token-bucket rate limiter.
 *
 * Per-instance only — no Redis, no cross-instance coordination. This is
 * acceptable on Vercel because cold starts naturally give attackers a fresh
 * bucket only when they hit a brand-new lambda; sustained abuse from a single
 * IP still gets throttled within the lifetime of the warm instance.
 *
 * Use it like:
 *   const ip = getClientIp(request)
 *   if (!checkRateLimit(`public-proposal:${token}:${ip}`, { limit: 30, windowMs: 60_000 })) {
 *     return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 *   }
 */
import { NextRequest } from 'next/server'

interface BucketEntry {
  count: number
  resetAt: number
}

const buckets = new Map<string, BucketEntry>()

// Periodic cleanup so the Map doesn't grow unbounded across many distinct
// keys. Runs once a minute. Module-level interval — only registered in
// long-running runtimes (Node), not edge.
let cleanupTimer: ReturnType<typeof setInterval> | null = null
function ensureCleanup() {
  if (cleanupTimer) return
  if (typeof setInterval !== 'function') return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets.entries()) {
      if (v.resetAt <= now) buckets.delete(k)
    }
  }, 60_000)
  // Don't keep the process alive just for this cleanup task.
  if (cleanupTimer && typeof (cleanupTimer as { unref?: () => void }).unref === 'function') {
    ;(cleanupTimer as unknown as { unref: () => void }).unref()
  }
}

export interface RateLimitOptions {
  limit: number
  windowMs: number
}

/**
 * Returns true if the request is within the rate limit, false if it should
 * be rejected. Increments the bucket on every call.
 */
export function checkRateLimit(key: string, opts: RateLimitOptions): boolean {
  ensureCleanup()
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
    return true
  }
  if (existing.count >= opts.limit) {
    return false
  }
  existing.count += 1
  return true
}

/**
 * Best-effort IP extraction from a Next.js request. Returns 'unknown' if no
 * forwarded header is present (development / direct hits). Bucket key callers
 * should still scope by token so a single 'unknown' bucket can't take down
 * legitimate dev traffic.
 */
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const real = request.headers.get('x-real-ip')
  if (real) return real.trim()
  return 'unknown'
}
