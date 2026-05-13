/**
 * Format a duration in hours into a human-friendly string.
 *
 * Magnitude rules:
 *   < 1 hour      → "47 min"
 *   < 24 hours    → "2.3 hrs"
 *   >= 24 hours   → "1.2 days"
 *
 * Returns "—" when the input is not a finite, non-negative number.
 */
export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '—'

  if (hours < 1) {
    const minutes = Math.round(hours * 60)
    return `${minutes} min`
  }

  if (hours < 24) {
    return `${hours.toFixed(1)} hrs`
  }

  const days = hours / 24
  return `${days.toFixed(1)} days`
}
