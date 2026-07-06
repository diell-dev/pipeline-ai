/**
 * Pipeline AI — Generic CSV export helper for accounting reports.
 *
 * Renders a 2D `string[][]` (header row + body rows) as a properly
 * escaped CSV blob and triggers a download in the browser. Escaping
 * handles:
 *   - embedded commas
 *   - embedded double quotes (doubled per RFC 4180)
 *   - embedded newlines (CR / LF)
 *   - BOM for Excel to detect UTF-8
 *
 * The functions are framework-agnostic: `toCsv(rows)` returns the raw
 * string; `downloadCsv(rows, filename)` wraps it in a Blob and clicks an
 * anchor. Use the latter from report pages so users get a "Save As"
 * dialog.
 */

const QUOTE = '"'
const COMMA = ','
const CRLF = '\r\n'
const UTF8_BOM = '﻿'

/**
 * Escape a single cell value for CSV. Numbers and nulls become bare
 * strings; everything else is quoted when it needs to be (per RFC 4180).
 */
export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = typeof value === 'string' ? value : String(value)
  // Neutralize spreadsheet formula injection: a text cell beginning with
  // =, +, -, @ (or tab/CR) is executed as a formula by Excel/Sheets. Prefix
  // such cells with a single quote so they're treated as text. Numeric-
  // looking cells (currency, negatives, parenthesized) are left alone.
  const looksNumeric = /^[-+]?[\d.,$%()\s]+$/.test(s)
  if (!looksNumeric && /^[=+\-@\t\r]/.test(s)) {
    s = "'" + s
  }
  // Quote if the cell contains any of: comma, quote, CR, LF, leading/trailing whitespace.
  const needsQuoting =
    s.includes(COMMA) ||
    s.includes(QUOTE) ||
    s.includes('\n') ||
    s.includes('\r') ||
    s !== s.trim()
  if (!needsQuoting) return s
  // Per RFC 4180, embedded quotes are doubled.
  return QUOTE + s.replace(/"/g, '""') + QUOTE
}

/**
 * Build a CSV string from a 2D array of values. The first row is the
 * header; remaining rows are the body. Cells can be any primitive — the
 * helper stringifies them safely.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return UTF8_BOM + rows.map((row) => row.map(escapeCsvCell).join(COMMA)).join(CRLF)
}

/**
 * Trigger a browser download of `rows` as a CSV file. Filename should
 * NOT include the .csv extension — the helper appends it.
 *
 * No-op on the server (no `document`). Safe to call from event handlers.
 */
export function downloadCsv(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  filename: string
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const csv = toCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeFilename(filename)}.csv`
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Revoke async so the click handler has time to grab the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Strip path-unsafe characters from a filename. Leaves the result
 * readable but safe to drop into a Save-As dialog on any OS.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'report'
}
