/**
 * Rate limiting — distributed when configured, in-memory otherwise.
 *
 * Audit S10 (2026-07-20)
 * ----------------------
 * The original implementation was a per-instance in-memory token bucket. On
 * Vercel every concurrent lambda holds its own Map, so an attacker spread
 * across instances effectively multiplies every limit by the number of warm
 * instances. That was documented and accepted at low traffic; this module now
 * upgrades to a shared counter in Upstash Redis when the environment provides
 * one, and transparently degrades to the old in-memory behaviour when it
 * doesn't (local dev, previews, or before Upstash is provisioned).
 *
 * Configuration (optional):
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 * Both come from the Upstash console. With neither set, behaviour is
 * identical to before — no crash, no config ceremony.
 *
 * Deliberate design choices:
 *   - Fixed window, not sliding. Simpler, one round-trip, and precise enough
 *     for abuse control (the edge case is a 2x burst across a window
 *     boundary, which none of these limits care about).
 *   - FAIL OPEN on Redis errors, but fall back to the in-memory limiter in the
 *     same call so there is always *some* ceiling. A Redis outage must never
 *     take down invoicing.
 *   - The in-memory path stays synchronous so nothing regresses if Upstash is
 *     unavailable mid-request.
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
 * Synchronous, per-instance limiter. Still exported because it is the
 * fallback path and is useful in non-async contexts.
 *
 * Returns true when the request is within the limit.
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

// ─────────────────────────────────────────────────────────────────
// Distributed backend (Upstash Redis REST)
// ─────────────────────────────────────────────────────────────────

function getUpstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url: url.replace(/\/$/, ''), token }
}

/** True when a shared limiter is configured. Useful for health output. */
export function isDistributedRateLimitEnabled(): boolean {
  return getUpstashConfig() !== null
}

/**
 * One round-trip: INCR the counter and, when it's the first hit of a window,
 * attach the expiry. Upstash's REST pipeline endpoint runs both atomically
 * enough for our purposes (INCR is atomic; a lost PEXPIRE would only mean the
 * key lingers, which the next INCR==1 branch repairs).
 */
async function incrementRedis(
  key: string,
  windowMs: number,
  cfg: { url: string; token: string }
): Promise<number | null> {
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['PEXPIRE', key, String(windowMs), 'NX'],
      ]),
      // Never let the limiter itself become the latency problem.
      signal: AbortSignal.timeout(1_000),
      cache: 'no-store',
    })

    if (!res.ok) return null

    const body = (await res.json()) as Array<{ result?: unknown; error?: string }>
    const first = Array.isArray(body) ? body[0] : null
    const count = first && typeof first.result === 'number' ? first.result : null
    return count
  } catch {
    // Timeout, DNS failure, Upstash outage — caller falls back.
    return null
  }
}

/**
 * Distributed rate limit check. Use this in API route handlers.
 *
 * Returns true when the request is within the limit, false when it should be
 * rejected with a 429.
 */
export async function enforceRateLimit(
  key: string,
  opts: RateLimitOptions
): Promise<boolean> {
  const cfg = getUpstashConfig()
  if (!cfg) {
    return checkRateLimit(key, opts)
  }

  // Namespaced so a shared Upstash database can host more than this app.
  const redisKey = `rl:${key}:${Math.floor(Date.now() / opts.windowMs)}`
  const count = await incrementRedis(redisKey, opts.windowMs, cfg)

  if (count === null) {
    // Redis unreachable — degrade to the per-instance limiter rather than
    // letting the request through unchecked.
    return checkRateLimit(key, opts)
  }

  return count <= opts.limit
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
