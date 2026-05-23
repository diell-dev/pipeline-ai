/**
 * Supabase typings widen FK-joined results to T[] even for true 1-to-1 joins.
 * This unwraps the first row (or null) without losing type narrowing.
 */
export function unwrapJoin<T>(x: unknown): T | null {
  if (x == null) return null
  if (Array.isArray(x)) return (x[0] as T) ?? null
  return x as T
}
