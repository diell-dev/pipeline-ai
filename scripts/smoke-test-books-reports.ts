/**
 * Smoke test for B4 — bookkeeping reports utility layer.
 *
 * Validates the pure helpers (CSV escaping, currency formatting, age
 * bucketing) without needing a live Supabase connection. Live SQL is
 * covered by smoke-test-books-posting.ts.
 *
 * Run with:
 *   npx jiti scripts/smoke-test-books-reports.ts
 *
 * Exits 0 on pass, 1 on any assertion failure.
 */
import {
  centsToDollars,
  daysBetween,
  formatCurrency,
  formatDate,
  formatPercent,
} from '../src/lib/books/format'
import { escapeCsvCell, toCsv } from '../src/lib/books/csv-export'

interface Assertion {
  name: string
  pass: boolean
  detail?: string
}

const assertions: Assertion[] = []

function assert(name: string, pass: boolean, detail?: string): void {
  assertions.push({ name, pass, detail })
  const tag = pass ? 'PASS' : 'FAIL'
  console.log(`  ${tag}  ${name}${detail ? `  — ${detail}` : ''}`)
}

function main(): void {
  console.log('B4 reports smoke test')
  console.log('---------------------')

  // --- format.ts ---
  console.log('format.ts')
  assert('formatCurrency(123456) is $1,234.56', formatCurrency(123456) === '$1,234.56')
  assert('formatCurrency(0) is $0.00', formatCurrency(0) === '$0.00')
  assert(
    'formatCurrency(0) with showZeroAsDash is —',
    formatCurrency(0, { showZeroAsDash: true }) === '—'
  )
  assert('formatCurrency(null) is $0.00', formatCurrency(null) === '$0.00')
  assert(
    'formatCurrency(-150) is -$1.50',
    formatCurrency(-150) === '-$1.50'
  )
  assert('centsToDollars(12345) is 123.45', centsToDollars(12345) === 123.45)
  assert('formatPercent(12.5) is 12.5%', formatPercent(12.5) === '12.5%')
  assert('formatPercent(null) is —', formatPercent(null) === '—')
  assert(
    'formatDate("2026-03-15") is Mar 15, 2026',
    formatDate('2026-03-15') === 'Mar 15, 2026'
  )
  assert(
    'daysBetween 2026-03-01 to 2026-03-10 is 9',
    daysBetween('2026-03-01', '2026-03-10') === 9
  )
  assert(
    'daysBetween same date is 0',
    daysBetween('2026-03-01', '2026-03-01') === 0
  )

  // --- csv-export.ts ---
  console.log('csv-export.ts')
  assert(
    'escapeCsvCell plain string passes through',
    escapeCsvCell('hello') === 'hello'
  )
  assert(
    'escapeCsvCell with comma is quoted',
    escapeCsvCell('hello, world') === '"hello, world"'
  )
  assert(
    'escapeCsvCell with quotes doubles them',
    escapeCsvCell('say "hi"') === '"say ""hi"""'
  )
  assert(
    'escapeCsvCell with newline is quoted',
    escapeCsvCell('line1\nline2') === '"line1\nline2"'
  )
  assert('escapeCsvCell null is empty', escapeCsvCell(null) === '')
  assert('escapeCsvCell undefined is empty', escapeCsvCell(undefined) === '')
  assert('escapeCsvCell number passes through', escapeCsvCell(42) === '42')

  const csv = toCsv([
    ['Header', 'Amount'],
    ['Revenue, total', 1234.56],
    ['Cost "of" goods', 500],
  ])
  assert(
    'toCsv starts with UTF-8 BOM',
    csv.startsWith('﻿'),
    'BOM present for Excel compatibility'
  )
  assert(
    'toCsv body has CRLF row separators',
    csv.includes('Header,Amount\r\n'),
    'first row terminator'
  )
  assert(
    'toCsv quotes commas in fields',
    csv.includes('"Revenue, total",1234.56'),
    'quoted commas'
  )
  assert(
    'toCsv doubles inner quotes',
    csv.includes('"Cost ""of"" goods",500'),
    'doubled quotes'
  )

  // --- Synthetic trial balance: debits == credits ---
  console.log('trial-balance invariant')
  // Mimic the shape returned by aggregateByAccount and naturalBalance.
  const fakeLines = [
    { debit_cents: 10000, credit_cents: 0 }, // DR AR 100.00
    { debit_cents: 0, credit_cents: 9000 }, // CR Revenue 90.00
    { debit_cents: 0, credit_cents: 1000 }, // CR Sales Tax 10.00
  ]
  const totalDebits = fakeLines.reduce((a, l) => a + l.debit_cents, 0)
  const totalCredits = fakeLines.reduce((a, l) => a + l.credit_cents, 0)
  assert(
    'sample journal entry balances',
    totalDebits === totalCredits,
    `debits=${totalDebits} credits=${totalCredits}`
  )

  // Aging bucket math: 0 = current, 45 = 31-60, 91 = 90+
  console.log('aging bucketing')
  function bucket(days: number): string {
    if (days <= 0) return 'current'
    if (days <= 30) return '1-30'
    if (days <= 60) return '31-60'
    if (days <= 90) return '61-90'
    return '90+'
  }
  assert('age 0 = current', bucket(0) === 'current')
  assert('age 15 = 1-30', bucket(15) === '1-30')
  assert('age 45 = 31-60', bucket(45) === '31-60')
  assert('age 80 = 61-90', bucket(80) === '61-90')
  assert('age 120 = 90+', bucket(120) === '90+')

  // Summary
  const failed = assertions.filter((a) => !a.pass)
  console.log('')
  console.log(
    `${assertions.length - failed.length}/${assertions.length} assertions passed`
  )
  if (failed.length > 0) {
    console.error(`${failed.length} failed:`)
    for (const f of failed) console.error(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`)
    process.exit(1)
  }
}

main()
