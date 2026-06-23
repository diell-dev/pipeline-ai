/**
 * Pipeline AI — Date / range helpers used by the books module.
 *
 * Kept separate from `format.ts` (which B4 owns and uses for monetary
 * formatting) so the two modules don't fight over the same file.
 */

/** First and last day of the current calendar month as YYYY-MM-DD. */
export function currentMonthRange(): { start: string; end: string } {
  const d = new Date()
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { start: fmt(start), end: fmt(end) }
}

/** First and last day of the month containing `date` (YYYY-MM-DD in). */
export function monthRangeFor(date: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return currentMonthRange()
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const start = new Date(y, mo, 1)
  const end = new Date(y, mo + 1, 0)
  return { start: fmt(start), end: fmt(end) }
}

/** YYYY-MM-DD for `daysFromNow` days from today (negative = past). */
export function isoOffset(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return fmt(d)
}

/** Today as YYYY-MM-DD (local TZ). */
export function todayIso(): string {
  return fmt(new Date())
}

/** Format a Date as local YYYY-MM-DD. */
export function fmt(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`
}
