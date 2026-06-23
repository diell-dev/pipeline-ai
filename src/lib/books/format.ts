/**
 * Pipeline AI — Bookkeeping number formatting helpers.
 *
 * Single source of truth for money / percent / date formatting on the
 * books pages. Everything in the books module stores amounts as BIGINT
 * cents; the helpers here convert at the display layer. Keep them pure
 * and synchronous so they can run on both server (SSR / route handlers)
 * and client (page components).
 */

/**
 * Format a cents amount as a USD currency string.
 *
 *   formatCurrency(123456)   → "$1,234.56"
 *   formatCurrency(-50)      → "-$0.50"
 *   formatCurrency(null)     → "$0.00"
 *   formatCurrency(0, { showZeroAsDash: true }) → "—"
 */
export function formatCurrency(
  cents: number | null | undefined,
  opts: { showZeroAsDash?: boolean; currency?: string } = {}
): string {
  const { showZeroAsDash = false, currency = 'USD' } = opts
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  if (value === 0 && showZeroAsDash) return '—'
  const dollars = value / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars)
}

/**
 * Plain-number cents → dollars (numeric). Used by CSV export so the
 * downstream spreadsheet keeps the value as a number rather than a
 * currency-formatted string.
 */
export function centsToDollars(cents: number | null | undefined): number {
  const value = typeof cents === 'number' && Number.isFinite(cents) ? cents : 0
  return Math.round(value) / 100
}

/**
 * Convert a "dollars" text input back to integer cents. Strips currency
 * symbols, commas, and whitespace so the value rounds cleanly. Used by
 * every monetary form input in the books module so what hits the API is
 * always cents.
 *
 *   dollarsToCents("1,234.56") → 123456
 *   dollarsToCents("$50")       → 5000
 *   dollarsToCents(50)          → 5000
 *   dollarsToCents("")          → 0
 */
export function dollarsToCents(input: string | number | null | undefined): number {
  if (input == null) return 0
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0
    return Math.round(input * 100)
  }
  const clean = input.toString().replace(/[^0-9.\-]/g, '').trim()
  if (!clean || clean === '-' || clean === '.') return 0
  const n = Number.parseFloat(clean)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/**
 * Format a percentage value (where 12.5 means 12.5%, not 0.125).
 *   formatPercent(12.5)  → "12.5%"
 *   formatPercent(null)  → "—"
 */
export function formatPercent(
  pct: number | null | undefined,
  opts: { digits?: number } = {}
): string {
  const { digits = 1 } = opts
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '—'
  return `${pct.toFixed(digits)}%`
}

/**
 * Format a YYYY-MM-DD date string for display.
 *   formatDate('2026-03-15') → "Mar 15, 2026"
 */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  // Avoid TZ drift by parsing the YYYY-MM-DD components manually.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return date
  const [, yyyy, mm, dd] = m
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
  return d.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Today as YYYY-MM-DD (local time).
 */
export function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Start of current month as YYYY-MM-DD (local time).
 */
export function startOfMonthIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}-01`
}

/**
 * Start of current year as YYYY-MM-DD.
 */
export function startOfYearIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-01-01`
}

/**
 * Difference in days between two YYYY-MM-DD strings.
 *   daysBetween('2026-03-10', '2026-03-01') → 9
 * Negative if `to` is before `from`. Returns 0 for malformed input.
 */
export function daysBetween(from: string, to: string): number {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  if (!a || !b) return 0
  const MS_PER_DAY = 86_400_000
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY)
}

function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const [, yyyy, mm, dd] = m
  return new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
}
