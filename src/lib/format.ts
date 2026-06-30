/**
 * Pipeline AI — App-wide formatting helpers.
 *
 * Single source of truth for currency / date formatting across every
 * dashboard module. The books module already had its own canonical
 * helpers (`src/lib/books/format.ts`) because amounts are stored as
 * BIGINT cents there. The rest of the app stores money as legacy
 * decimal dollars, so we re-export the books helpers AND add a
 * `formatDollars` wrapper that takes dollars directly.
 *
 * Always import currency / date formatting from THIS module (or from
 * `src/lib/books/format.ts` inside the books module). Never reach for
 * `.toFixed(2)` or `new Date(x).toLocaleDateString()` in components —
 * inconsistent formatting was the #1 demo-visible UX leak.
 */

export { formatCurrency, formatDate, dollarsToCents } from './books/format'

/**
 * Format a legacy "dollars" value (number or numeric string) as a USD
 * currency string with grouping separators and 2 decimal places.
 *
 *   formatDollars(1234.5)    → "$1,234.50"
 *   formatDollars("1234.56") → "$1,234.56"
 *   formatDollars(null)      → "$0.00"
 *   formatDollars(undefined) → "$0.00"
 *
 * Use this on Jobs / Proposals / Finances / Invoices list / Equipment /
 * Dashboard / Clients where the source value is a plain dollar number.
 * Inside the books module, prefer `formatCurrency(cents)` directly.
 */
export function formatDollars(
  dollars: number | string | null | undefined
): string {
  if (dollars === null || dollars === undefined) return '$0.00'
  const n = typeof dollars === 'string' ? parseFloat(dollars) : dollars
  if (!Number.isFinite(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n as number)
}
