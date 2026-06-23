/**
 * Tiny client-safe utility helpers for the books setup wizard and a few
 * other small UI cases. Kept separate so the wizard page doesn't pull
 * in the heavier `format-helpers` Date math when it only needs labels.
 */

export function monthsList(): string[] {
  return Array.from({ length: 12 }).map((_, i) =>
    new Date(2000, i, 1).toLocaleString('en-US', { month: 'long' })
  )
}
