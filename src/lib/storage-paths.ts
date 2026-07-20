/**
 * Storage reference parsing (audit S1).
 *
 * Historically the app stored the **public URL** of every uploaded photo
 * directly in the database (jobs.photos[], equipment.unit_photo_url, …)
 * because the buckets were public. Now that `job-photos` and
 * `equipment-photos` are private, those stored values have to be converted
 * back into a bucket + object path so a short-lived signed URL can be minted.
 *
 * This module is deliberately dependency-free and pure so it can be unit
 * tested — getting the parsing wrong means either broken images (annoying) or
 * signing an object the caller shouldn't see (a security bug).
 */

/** Buckets that are private and therefore require a signed URL to read. */
export const PRIVATE_BUCKETS = ['job-photos', 'equipment-photos'] as const
export type PrivateBucket = (typeof PRIVATE_BUCKETS)[number]

export function isPrivateBucket(value: string): value is PrivateBucket {
  return (PRIVATE_BUCKETS as readonly string[]).includes(value)
}

export interface StorageRef {
  bucket: PrivateBucket
  /** Object path within the bucket, e.g. "<orgId>/jobs/<jobId>/123-abc.jpg" */
  path: string
}

/**
 * Parse a stored value into { bucket, path }.
 *
 * Accepts either shape:
 *   - a full Supabase public URL:
 *     https://<ref>.supabase.co/storage/v1/object/public/job-photos/<path>
 *   - an already-signed URL (…/object/sign/job-photos/<path>?token=…)
 *   - a bare "<bucket>/<path>" string
 *
 * Returns null when the value doesn't reference a private bucket — callers
 * should pass such values through untouched (e.g. the still-public org logo).
 */
export function parseStorageRef(value: string | null | undefined): StorageRef | null {
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  let candidate = trimmed

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL
    try {
      url = new URL(trimmed)
    } catch {
      return null
    }
    // /storage/v1/object/public/<bucket>/<path>
    // /storage/v1/object/sign/<bucket>/<path>
    const marker = url.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/(.+)$/)
    if (!marker) return null
    candidate = marker[1]
  }

  // Strip any leading slash and a query string on a bare path.
  candidate = candidate.replace(/^\/+/, '').split('?')[0]

  const slash = candidate.indexOf('/')
  if (slash <= 0) return null

  const bucket = candidate.slice(0, slash)
  const path = decodeURIComponent(candidate.slice(slash + 1))

  if (!isPrivateBucket(bucket)) return null
  if (!path || path.includes('..')) return null

  return { bucket, path }
}

/**
 * The organisation id every object path is prefixed with. Uploads write to
 * `${organizationId}/…`, so this is the first tenant-isolation check before
 * anything gets signed.
 */
export function orgIdFromPath(path: string): string | null {
  const first = path.split('/')[0]
  return first || null
}

/**
 * For job photos the path carries the job id: `<orgId>/jobs/<jobId>/<file>`.
 * Returns null for any other shape (including equipment photos, whose paths
 * intentionally contain no owning-record id).
 */
export function jobIdFromPath(path: string): string | null {
  const parts = path.split('/')
  if (parts.length < 4) return null
  if (parts[1] !== 'jobs') return null
  return parts[2] || null
}
