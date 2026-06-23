/**
 * Pipeline AI — Bookkeeping Reports (Agent B4)
 *
 * Pure, server-callable functions that compute the standard US GAAP
 * style financial reports straight from the journal_entry_lines that
 * B2's posting engine creates. NO UI in this file.
 *
 * Design notes:
 *   - Every function takes `(supabase, orgId, ...)` so it composes with
 *     either a service-role client (cron/admin) or an end-user RLS
 *     client. RLS is the authority on what the caller can see.
 *   - All amounts in cents (BIGINT in SQL → number in TS). Display layer
 *     calls `formatCurrency` from `./format.ts`.
 *   - Only POSTED entries count toward any report. Drafts (posted_at IS
 *     NULL) and soft-deleted entries (deleted_at NOT NULL) are excluded.
 *   - Reversals stay in the books — they net out naturally because the
 *     reversal entry's debit/credit pair flips the original's. We do NOT
 *     special-case `reversal_of_id` to drop the original pair.
 *   - Date filtering is on `journal_entries.entry_date`, not posted_at,
 *     so back-dated entries land in the correct period.
 *   - Balance sheet is computed as-of: every posted line dated on or
 *     before `asOfDate`. Year-to-date net income rolls into equity.
 *
 * Required reports (per the brief):
 *   1. getProfitAndLoss
 *   2. getBalanceSheet
 *   3. getCashFlow            (indirect method, v1 = operating section only)
 *   4. getARAging
 *   5. getAPAging
 *   6. getTrialBalance
 *   7. getGeneralLedger
 *   8. getSalesTaxSummary
 */
import type { SupabaseClient } from '@supabase/supabase-js'

import { daysBetween, startOfYearIso } from './format'

// ============================================================
// Public types
// ============================================================

export class ReportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportError'
  }
}

export class BalanceSheetUnbalancedError extends Error {
  constructor(
    message: string,
    public readonly assets: number,
    public readonly liabilitiesAndEquity: number
  ) {
    super(message)
    this.name = 'BalanceSheetUnbalancedError'
  }
}

export interface AccountTotal {
  account_id: string
  account_code: string
  account_name: string
  amount_cents: number
}

export interface AccountGroup {
  byAccount: AccountTotal[]
  total_cents: number
}

export interface ProfitAndLossReport {
  startDate: string
  endDate: string
  revenue: AccountGroup
  cogs: AccountGroup
  grossProfit: { amount_cents: number; margin_pct: number }
  operatingExpenses: AccountGroup
  operatingIncome: { amount_cents: number; margin_pct: number }
  otherIncome: AccountGroup
  otherExpenses: AccountGroup
  netIncome: { amount_cents: number }
}

export interface BalanceSheetLine {
  account_id: string
  account_code: string
  account_name: string
  subtype: string
  amount_cents: number
}

export interface BalanceSheetReport {
  asOfDate: string
  assets: {
    current: BalanceSheetLine[]
    nonCurrent: BalanceSheetLine[]
    total_cents: number
  }
  liabilities: {
    current: BalanceSheetLine[]
    longTerm: BalanceSheetLine[]
    total_cents: number
  }
  equity: {
    equity: BalanceSheetLine[]
    retainedEarnings_cents: number
    currentPeriodNetIncome_cents: number
    total_cents: number
  }
  totalLiabilitiesAndEquity_cents: number
  isBalanced: boolean
}

export interface CashFlowReport {
  startDate: string
  endDate: string
  operating: {
    netIncome_cents: number
    adjustments: { label: string; amount_cents: number }[]
    totalAdjustments_cents: number
    operatingCashFlow_cents: number
  }
  investing: { items: { label: string; amount_cents: number }[]; total_cents: number }
  financing: { items: { label: string; amount_cents: number }[]; total_cents: number }
  netChangeInCash_cents: number
}

export interface AgingBucketsCents {
  current_cents: number
  days_1_30_cents: number
  days_31_60_cents: number
  days_61_90_cents: number
  days_90_plus_cents: number
  total_cents: number
}

export interface AgingRow extends AgingBucketsCents {
  party_id: string // client_id for AR, vendor_id for AP
  party_name: string
}

export interface AgingReport {
  asOfDate: string
  buckets: ['current', '1-30', '31-60', '61-90', '90+']
  rows: AgingRow[]
  totals: AgingBucketsCents
}

export interface TrialBalanceRow {
  account_id: string
  account_code: string
  account_name: string
  account_type: string
  debit_total_cents: number
  credit_total_cents: number
  balance_cents: number // signed: + = natural debit, − = natural credit
}

export interface TrialBalanceReport {
  asOfDate: string
  accounts: TrialBalanceRow[]
  totals: {
    debits_cents: number
    credits_cents: number
    isBalanced: boolean
  }
}

export interface GeneralLedgerEntry {
  entry_id: string
  entry_date: string
  entry_number: string
  description: string | null
  account_id: string
  account_code: string
  account_name: string
  debit_cents: number
  credit_cents: number
  running_balance_cents: number
  source_type: string
  source_id: string | null
}

export interface GeneralLedgerReport {
  startDate: string
  endDate: string
  accountId: string | null
  entries: GeneralLedgerEntry[]
  openingBalance_cents: number
  closingBalance_cents: number
  totals: { debits_cents: number; credits_cents: number }
}

export interface SalesTaxBreakdownRow {
  tax_rate_id: string | null
  tax_rate_name: string
  rate_pct: number
  taxable_subtotal_cents: number
  tax_collected_cents: number
  tax_paid_cents: number
  net_tax_owed_cents: number
}

export interface SalesTaxSummaryReport {
  startDate: string
  endDate: string
  rows: SalesTaxBreakdownRow[]
  totals: {
    taxable_subtotal_cents: number
    tax_collected_cents: number
    tax_paid_cents: number
    net_tax_owed_cents: number
  }
}

// ============================================================
// Internal: shared row shapes
// ============================================================

interface AccountRow {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subtype: string
}

interface JournalLineRow {
  account_id: string
  debit_cents: number
  credit_cents: number
  journal_entries: {
    organization_id: string
    entry_date: string
    posted_at: string | null
    deleted_at: string | null
  } | null
}

interface GeneralLedgerRawRow {
  account_id: string
  debit_cents: number
  credit_cents: number
  description: string | null
  line_number: number | null
  journal_entries: {
    id: string
    organization_id: string
    entry_date: string
    entry_number: string
    description: string | null
    source_type: string
    source_id: string | null
    posted_at: string | null
    deleted_at: string | null
  } | null
}

// ============================================================
// Account fetch (cached per-call via local Map)
// ============================================================

/**
 * Pull every active account for the org once and index by id. The
 * reports group by account.type / subtype dozens of times — pre-fetching
 * is faster than embedding the join on every line.
 */
async function loadAccountsById(
  supabase: SupabaseClient,
  orgId: string
): Promise<Map<string, AccountRow>> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, code, name, type, subtype')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .order('code', { ascending: true })

  if (error) {
    throw new ReportError(`Failed to load chart of accounts for org ${orgId}: ${error.message}`)
  }
  const map = new Map<string, AccountRow>()
  for (const row of (data ?? []) as AccountRow[]) {
    map.set(row.id, row)
  }
  return map
}

// ============================================================
// Internal: fetch all posted lines in a date range
// ============================================================

/**
 * Walks `journal_entry_lines` joined to their parent `journal_entries`,
 * keeping only POSTED + NOT DELETED entries inside [startDate, endDate].
 * Pagination is needed because Supabase caps at 1000 rows/request.
 */
async function fetchPostedLines(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string | null,
  endDate: string
): Promise<{ account_id: string; debit_cents: number; credit_cents: number }[]> {
  const PAGE_SIZE = 1000
  const out: { account_id: string; debit_cents: number; credit_cents: number }[] = []
  let page = 0
  while (true) {
    let query = supabase
      .from('journal_entry_lines')
      .select(
        'account_id, debit_cents, credit_cents, journal_entries!inner(organization_id, entry_date, posted_at, deleted_at)'
      )
      .eq('journal_entries.organization_id', orgId)
      .not('journal_entries.posted_at', 'is', null)
      .is('journal_entries.deleted_at', null)
      .lte('journal_entries.entry_date', endDate)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (startDate) {
      query = query.gte('journal_entries.entry_date', startDate)
    }

    const { data, error } = await query

    if (error) {
      throw new ReportError(`Failed to fetch journal entry lines: ${error.message}`)
    }
    const rows = (data ?? []) as unknown as JournalLineRow[]
    for (const r of rows) {
      if (!r.journal_entries) continue
      out.push({
        account_id: r.account_id,
        debit_cents: Number(r.debit_cents) || 0,
        credit_cents: Number(r.credit_cents) || 0,
      })
    }
    if (rows.length < PAGE_SIZE) break
    page++
  }
  return out
}

// ============================================================
// Internal: aggregate per-account totals from a line list
// ============================================================

/**
 * Sum debits/credits per account_id. Returns a Map keyed by account_id.
 */
function aggregateByAccount(
  lines: { account_id: string; debit_cents: number; credit_cents: number }[]
): Map<string, { debit_cents: number; credit_cents: number }> {
  const agg = new Map<string, { debit_cents: number; credit_cents: number }>()
  for (const l of lines) {
    const cur = agg.get(l.account_id) ?? { debit_cents: 0, credit_cents: 0 }
    cur.debit_cents += l.debit_cents
    cur.credit_cents += l.credit_cents
    agg.set(l.account_id, cur)
  }
  return agg
}

/**
 * Natural balance for an account from its raw debit/credit totals.
 *   - asset/expense → debit-normal: balance = debit − credit
 *   - liability/equity/income → credit-normal: balance = credit − debit
 *
 * Returned value is always the natural-positive amount (a healthy
 * revenue account returns a positive number).
 */
function naturalBalance(
  type: AccountRow['type'],
  debit: number,
  credit: number
): number {
  if (type === 'asset' || type === 'expense') return debit - credit
  return credit - debit
}

// ============================================================
// 1. PROFIT & LOSS
// ============================================================

export async function getProfitAndLoss(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<ProfitAndLossReport> {
  if (!startDate || !endDate) {
    throw new ReportError('getProfitAndLoss requires both startDate and endDate.')
  }
  const accounts = await loadAccountsById(supabase, orgId)
  const lines = await fetchPostedLines(supabase, orgId, startDate, endDate)
  const agg = aggregateByAccount(lines)

  const revenue: AccountTotal[] = []
  const cogs: AccountTotal[] = []
  const opex: AccountTotal[] = []
  const otherIncome: AccountTotal[] = []
  const otherExpenses: AccountTotal[] = []

  for (const [accountId, totals] of agg.entries()) {
    const account = accounts.get(accountId)
    if (!account) continue
    const amount = naturalBalance(account.type, totals.debit_cents, totals.credit_cents)
    // Skip true zeros — keeps the report tidy.
    if (amount === 0) continue

    const row: AccountTotal = {
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      amount_cents: amount,
    }

    if (account.type === 'income') {
      if (account.subtype === 'other_income') {
        otherIncome.push(row)
      } else {
        // operating_income, contra_revenue (subtracts naturally — contra
        // accounts have opposite sign at the natural-balance step).
        revenue.push(row)
      }
    } else if (account.type === 'expense') {
      if (account.subtype === 'cogs') {
        cogs.push(row)
      } else if (account.subtype === 'other_expense') {
        otherExpenses.push(row)
      } else {
        opex.push(row)
      }
    }
    // Asset / liability / equity totals don't appear on the P&L.
  }

  const sumOf = (rows: AccountTotal[]) =>
    rows.reduce((acc, r) => acc + r.amount_cents, 0)

  const revenueTotal = sumOf(revenue)
  const cogsTotal = sumOf(cogs)
  const opexTotal = sumOf(opex)
  const otherIncomeTotal = sumOf(otherIncome)
  const otherExpensesTotal = sumOf(otherExpenses)

  const grossProfit_cents = revenueTotal - cogsTotal
  const operatingIncome_cents = grossProfit_cents - opexTotal
  const netIncome_cents =
    operatingIncome_cents + otherIncomeTotal - otherExpensesTotal

  const margin = (n: number) =>
    revenueTotal !== 0 ? Number(((n / revenueTotal) * 100).toFixed(2)) : 0

  const sortByCode = (a: AccountTotal, b: AccountTotal) =>
    a.account_code.localeCompare(b.account_code)

  return {
    startDate,
    endDate,
    revenue: { byAccount: revenue.sort(sortByCode), total_cents: revenueTotal },
    cogs: { byAccount: cogs.sort(sortByCode), total_cents: cogsTotal },
    grossProfit: {
      amount_cents: grossProfit_cents,
      margin_pct: margin(grossProfit_cents),
    },
    operatingExpenses: { byAccount: opex.sort(sortByCode), total_cents: opexTotal },
    operatingIncome: {
      amount_cents: operatingIncome_cents,
      margin_pct: margin(operatingIncome_cents),
    },
    otherIncome: { byAccount: otherIncome.sort(sortByCode), total_cents: otherIncomeTotal },
    otherExpenses: {
      byAccount: otherExpenses.sort(sortByCode),
      total_cents: otherExpensesTotal,
    },
    netIncome: { amount_cents: netIncome_cents },
  }
}

// ============================================================
// 2. BALANCE SHEET
// ============================================================

const CURRENT_ASSET_SUBTYPES = new Set([
  'current_asset',
  'accounts_receivable',
  'bank',
  'cash',
])
const NON_CURRENT_ASSET_SUBTYPES = new Set([
  'non_current_asset',
  'fixed_asset',
  'contra_asset',
])
const LONG_TERM_LIAB_SUBTYPES = new Set(['long_term_liability'])
// `accounts_payable` and `current_liability` both land in the current
// bucket — anything that isn't explicitly long-term defaults to current,
// so the schema's known subtypes don't need their own set.

export async function getBalanceSheet(
  supabase: SupabaseClient,
  orgId: string,
  asOfDate: string
): Promise<BalanceSheetReport> {
  if (!asOfDate) {
    throw new ReportError('getBalanceSheet requires asOfDate.')
  }

  // Pull every posted line up to and including asOfDate.
  const accounts = await loadAccountsById(supabase, orgId)
  const lines = await fetchPostedLines(supabase, orgId, null, asOfDate)
  const agg = aggregateByAccount(lines)

  const assetsCurrent: BalanceSheetLine[] = []
  const assetsNonCurrent: BalanceSheetLine[] = []
  const liabilitiesCurrent: BalanceSheetLine[] = []
  const liabilitiesLongTerm: BalanceSheetLine[] = []
  const equityLines: BalanceSheetLine[] = []
  let retainedEarnings_cents = 0

  for (const [accountId, totals] of agg.entries()) {
    const account = accounts.get(accountId)
    if (!account) continue
    const amount = naturalBalance(account.type, totals.debit_cents, totals.credit_cents)
    if (amount === 0 && account.type !== 'equity') continue

    const row: BalanceSheetLine = {
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      subtype: account.subtype,
      amount_cents: amount,
    }

    if (account.type === 'asset') {
      if (CURRENT_ASSET_SUBTYPES.has(account.subtype)) assetsCurrent.push(row)
      else if (NON_CURRENT_ASSET_SUBTYPES.has(account.subtype)) {
        assetsNonCurrent.push(row)
      } else {
        // Unknown asset subtype — bucket as non-current to stay safe.
        assetsNonCurrent.push(row)
      }
    } else if (account.type === 'liability') {
      if (LONG_TERM_LIAB_SUBTYPES.has(account.subtype)) liabilitiesLongTerm.push(row)
      else liabilitiesCurrent.push(row)
    } else if (account.type === 'equity') {
      if (account.subtype === 'retained_earnings') {
        // Retained earnings carry the accumulated net income from all
        // prior periods. Posted entries against it ARE its balance.
        retainedEarnings_cents += amount
      } else {
        equityLines.push(row)
      }
    }
    // income/expense don't appear on the balance sheet — they roll up
    // into current-period net income below.
  }

  // YTD net income from the start of the year to asOfDate. This is the
  // P&L bottom line; it lives in equity on the BS but isn't yet posted
  // to Retained Earnings until year-end closing.
  const ytdStart = startOfYearFor(asOfDate)
  const pnl = await getProfitAndLoss(supabase, orgId, ytdStart, asOfDate)
  const currentPeriodNetIncome_cents = pnl.netIncome.amount_cents

  const sumOf = (rows: BalanceSheetLine[]) =>
    rows.reduce((acc, r) => acc + r.amount_cents, 0)

  // Subtract YTD income from retained earnings if some of those P&L
  // entries already closed into RE. For v1 we trust the user hasn't
  // run a closing entry yet — RE only has prior-period balances.

  const assetsTotal = sumOf(assetsCurrent) + sumOf(assetsNonCurrent)
  const liabilitiesTotal = sumOf(liabilitiesCurrent) + sumOf(liabilitiesLongTerm)
  const equityTotal =
    sumOf(equityLines) + retainedEarnings_cents + currentPeriodNetIncome_cents
  const totalLiabilitiesAndEquity_cents = liabilitiesTotal + equityTotal

  const sortByCode = (a: BalanceSheetLine, b: BalanceSheetLine) =>
    a.account_code.localeCompare(b.account_code)

  // Allow ±1 cent for cumulative rounding — anything bigger means the
  // GL is genuinely unbalanced.
  const drift = Math.abs(assetsTotal - totalLiabilitiesAndEquity_cents)
  const isBalanced = drift <= 1
  if (!isBalanced) {
    throw new BalanceSheetUnbalancedError(
      `Balance sheet does not balance for org ${orgId} as of ${asOfDate}: ` +
        `assets=${assetsTotal} liabilities+equity=${totalLiabilitiesAndEquity_cents} (drift=${drift}).`,
      assetsTotal,
      totalLiabilitiesAndEquity_cents
    )
  }

  return {
    asOfDate,
    assets: {
      current: assetsCurrent.sort(sortByCode),
      nonCurrent: assetsNonCurrent.sort(sortByCode),
      total_cents: assetsTotal,
    },
    liabilities: {
      current: liabilitiesCurrent.sort(sortByCode),
      longTerm: liabilitiesLongTerm.sort(sortByCode),
      total_cents: liabilitiesTotal,
    },
    equity: {
      equity: equityLines.sort(sortByCode),
      retainedEarnings_cents,
      currentPeriodNetIncome_cents,
      total_cents: equityTotal,
    },
    totalLiabilitiesAndEquity_cents,
    isBalanced,
  }
}

function startOfYearFor(asOfDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(asOfDate)
  if (!m) return startOfYearIso()
  return `${m[1]}-01-01`
}

// ============================================================
// 3. CASH FLOW (indirect method — operating section v1)
// ============================================================

/**
 * Indirect method: start from net income, add back non-cash items
 * (depreciation), then adjust for working-capital changes (AR, AP,
 * inventory). Investing + financing sections are placeholders for now —
 * v2 will derive them from journal entries against fixed-asset and
 * long-term-liability / equity accounts.
 */
export async function getCashFlow(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<CashFlowReport> {
  if (!startDate || !endDate) {
    throw new ReportError('getCashFlow requires both startDate and endDate.')
  }
  const accounts = await loadAccountsById(supabase, orgId)
  const pnl = await getProfitAndLoss(supabase, orgId, startDate, endDate)

  // Working capital deltas: balance at endDate − balance at the day
  // before startDate.
  const dayBeforeStart = previousDayIso(startDate)
  const [opening, closing] = await Promise.all([
    fetchAccountBalances(supabase, orgId, accounts, dayBeforeStart),
    fetchAccountBalances(supabase, orgId, accounts, endDate),
  ])

  const balanceDelta = (subtype: string): number => {
    let openSum = 0
    let closeSum = 0
    for (const a of accounts.values()) {
      if (a.subtype !== subtype) continue
      openSum += opening.get(a.id) ?? 0
      closeSum += closing.get(a.id) ?? 0
    }
    return closeSum - openSum
  }

  // For a working-capital account, an INCREASE means cash flowed in or
  // out the other way:
  //   AR ↑ → revenue booked but cash not yet collected → subtract
  //   Inventory ↑ → cash tied up in stock → subtract
  //   AP ↑ → expense booked but cash not yet paid → add
  const arDelta = balanceDelta('accounts_receivable')
  const inventoryDelta = balanceDelta('current_asset') // covers prepaid + inventory bucket
  const apDelta = balanceDelta('accounts_payable')

  // Depreciation is a non-cash expense charged during the period.
  // Sum debits to depreciation_expense accounts in the window.
  const lines = await fetchPostedLines(supabase, orgId, startDate, endDate)
  let depreciation_cents = 0
  for (const l of lines) {
    const a = accounts.get(l.account_id)
    if (!a) continue
    if (a.subtype === 'depreciation_expense') {
      depreciation_cents += l.debit_cents - l.credit_cents
    }
  }

  const adjustments: { label: string; amount_cents: number }[] = [
    { label: 'Depreciation', amount_cents: depreciation_cents },
    { label: 'Decrease (Increase) in Accounts Receivable', amount_cents: -arDelta },
    { label: 'Decrease (Increase) in Inventory / Prepaid', amount_cents: -inventoryDelta },
    { label: 'Increase (Decrease) in Accounts Payable', amount_cents: apDelta },
  ]
  const totalAdjustments_cents = adjustments.reduce((a, r) => a + r.amount_cents, 0)
  const operatingCashFlow_cents = pnl.netIncome.amount_cents + totalAdjustments_cents

  // Investing / financing: stubs for now. B4 brief says simpler v1.
  const investing = { items: [], total_cents: 0 }
  const financing = { items: [], total_cents: 0 }

  return {
    startDate,
    endDate,
    operating: {
      netIncome_cents: pnl.netIncome.amount_cents,
      adjustments,
      totalAdjustments_cents,
      operatingCashFlow_cents,
    },
    investing,
    financing,
    netChangeInCash_cents:
      operatingCashFlow_cents + investing.total_cents + financing.total_cents,
  }
}

function previousDayIso(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return date
  const [, yyyy, mm, dd] = m
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)))
  d.setUTCDate(d.getUTCDate() - 1)
  const pyyyy = d.getUTCFullYear()
  const pmm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const pdd = String(d.getUTCDate()).padStart(2, '0')
  return `${pyyyy}-${pmm}-${pdd}`
}

/**
 * Compute the natural balance for every account as of `asOfDate`.
 * Returns a Map<account_id, balance_cents>. Accounts with zero balance
 * are still present (value = 0).
 */
async function fetchAccountBalances(
  supabase: SupabaseClient,
  orgId: string,
  accounts: Map<string, AccountRow>,
  asOfDate: string
): Promise<Map<string, number>> {
  const lines = await fetchPostedLines(supabase, orgId, null, asOfDate)
  const agg = aggregateByAccount(lines)
  const out = new Map<string, number>()
  for (const account of accounts.values()) {
    const t = agg.get(account.id) ?? { debit_cents: 0, credit_cents: 0 }
    out.set(account.id, naturalBalance(account.type, t.debit_cents, t.credit_cents))
  }
  return out
}

// ============================================================
// 4. AR AGING
// ============================================================

interface OpenInvoiceRow {
  id: string
  client_id: string
  invoice_number: string
  invoice_date: string
  due_date: string | null
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  clients: { id: string; company_name: string } | null
}

export async function getARAging(
  supabase: SupabaseClient,
  orgId: string,
  asOfDate: string
): Promise<AgingReport> {
  if (!asOfDate) {
    throw new ReportError('getARAging requires asOfDate.')
  }

  const { data, error } = await supabase
    .from('invoices')
    .select(
      'id, client_id, invoice_number, invoice_date, due_date, total_cents, amount_paid_cents, balance_due_cents, clients(id, company_name)'
    )
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gt('balance_due_cents', 0)
    .lte('invoice_date', asOfDate)

  if (error) {
    throw new ReportError(`Failed to fetch AR invoices: ${error.message}`)
  }
  const rows = (data ?? []) as unknown as OpenInvoiceRow[]

  const byClient = new Map<
    string,
    AgingRow & { _client_name: string }
  >()

  for (const inv of rows) {
    const balance = Number(inv.balance_due_cents) || 0
    if (balance <= 0) continue
    const clientId = inv.client_id
    const clientName = inv.clients?.company_name ?? 'Unknown client'
    // Age relative to due_date when present, falling back to invoice_date.
    const referenceDate = inv.due_date ?? inv.invoice_date
    const age = referenceDate ? daysBetween(referenceDate, asOfDate) : 0

    const bucket = ageBucket(age)
    const existing =
      byClient.get(clientId) ??
      ({
        party_id: clientId,
        party_name: clientName,
        current_cents: 0,
        days_1_30_cents: 0,
        days_31_60_cents: 0,
        days_61_90_cents: 0,
        days_90_plus_cents: 0,
        total_cents: 0,
        _client_name: clientName,
      } as AgingRow & { _client_name: string })

    existing[bucket] += balance
    existing.total_cents += balance
    byClient.set(clientId, existing)
  }

  return finalizeAging(asOfDate, Array.from(byClient.values()))
}

// ============================================================
// 5. AP AGING
// ============================================================

interface OpenBillRow {
  id: string
  vendor_id: string
  internal_number: string
  bill_date: string
  due_date: string | null
  total_cents: number
  amount_paid_cents: number
  balance_due_cents: number
  vendors: { id: string; name: string } | null
}

export async function getAPAging(
  supabase: SupabaseClient,
  orgId: string,
  asOfDate: string
): Promise<AgingReport> {
  if (!asOfDate) {
    throw new ReportError('getAPAging requires asOfDate.')
  }

  const { data, error } = await supabase
    .from('bills')
    .select(
      'id, vendor_id, internal_number, bill_date, due_date, total_cents, amount_paid_cents, balance_due_cents, vendors(id, name)'
    )
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gt('balance_due_cents', 0)
    .lte('bill_date', asOfDate)

  if (error) {
    throw new ReportError(`Failed to fetch AP bills: ${error.message}`)
  }
  const rows = (data ?? []) as unknown as OpenBillRow[]

  const byVendor = new Map<string, AgingRow>()
  for (const bill of rows) {
    const balance = Number(bill.balance_due_cents) || 0
    if (balance <= 0) continue
    const vendorId = bill.vendor_id
    const vendorName = bill.vendors?.name ?? 'Unknown vendor'
    const referenceDate = bill.due_date ?? bill.bill_date
    const age = referenceDate ? daysBetween(referenceDate, asOfDate) : 0
    const bucket = ageBucket(age)

    const existing = byVendor.get(vendorId) ?? {
      party_id: vendorId,
      party_name: vendorName,
      current_cents: 0,
      days_1_30_cents: 0,
      days_31_60_cents: 0,
      days_61_90_cents: 0,
      days_90_plus_cents: 0,
      total_cents: 0,
    }
    existing[bucket] += balance
    existing.total_cents += balance
    byVendor.set(vendorId, existing)
  }

  return finalizeAging(asOfDate, Array.from(byVendor.values()))
}

function ageBucket(daysOverdue: number): keyof AgingBucketsCents {
  if (daysOverdue <= 0) return 'current_cents'
  if (daysOverdue <= 30) return 'days_1_30_cents'
  if (daysOverdue <= 60) return 'days_31_60_cents'
  if (daysOverdue <= 90) return 'days_61_90_cents'
  return 'days_90_plus_cents'
}

function finalizeAging(asOfDate: string, rows: AgingRow[]): AgingReport {
  const totals: AgingBucketsCents = {
    current_cents: 0,
    days_1_30_cents: 0,
    days_31_60_cents: 0,
    days_61_90_cents: 0,
    days_90_plus_cents: 0,
    total_cents: 0,
  }
  for (const r of rows) {
    totals.current_cents += r.current_cents
    totals.days_1_30_cents += r.days_1_30_cents
    totals.days_31_60_cents += r.days_31_60_cents
    totals.days_61_90_cents += r.days_61_90_cents
    totals.days_90_plus_cents += r.days_90_plus_cents
    totals.total_cents += r.total_cents
  }
  rows.sort((a, b) => b.total_cents - a.total_cents)
  return {
    asOfDate,
    buckets: ['current', '1-30', '31-60', '61-90', '90+'],
    rows,
    totals,
  }
}

// ============================================================
// 6. TRIAL BALANCE
// ============================================================

export async function getTrialBalance(
  supabase: SupabaseClient,
  orgId: string,
  asOfDate: string
): Promise<TrialBalanceReport> {
  if (!asOfDate) {
    throw new ReportError('getTrialBalance requires asOfDate.')
  }

  const accounts = await loadAccountsById(supabase, orgId)
  const lines = await fetchPostedLines(supabase, orgId, null, asOfDate)
  const agg = aggregateByAccount(lines)

  const rows: TrialBalanceRow[] = []
  let totalDebits = 0
  let totalCredits = 0

  for (const account of accounts.values()) {
    const t = agg.get(account.id) ?? { debit_cents: 0, credit_cents: 0 }
    if (t.debit_cents === 0 && t.credit_cents === 0) continue
    const balance = naturalBalance(account.type, t.debit_cents, t.credit_cents)
    rows.push({
      account_id: account.id,
      account_code: account.code,
      account_name: account.name,
      account_type: account.type,
      debit_total_cents: t.debit_cents,
      credit_total_cents: t.credit_cents,
      balance_cents: balance,
    })
    totalDebits += t.debit_cents
    totalCredits += t.credit_cents
  }

  rows.sort((a, b) => a.account_code.localeCompare(b.account_code))

  return {
    asOfDate,
    accounts: rows,
    totals: {
      debits_cents: totalDebits,
      credits_cents: totalCredits,
      isBalanced: totalDebits === totalCredits,
    },
  }
}

// ============================================================
// 7. GENERAL LEDGER
// ============================================================

export interface GeneralLedgerOptions {
  /** Cap the number of returned entries (default 5000). */
  limit?: number
}

export async function getGeneralLedger(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
  accountId?: string | null,
  options: GeneralLedgerOptions = {}
): Promise<GeneralLedgerReport> {
  if (!startDate || !endDate) {
    throw new ReportError('getGeneralLedger requires both startDate and endDate.')
  }
  const { limit = 5000 } = options
  const accounts = await loadAccountsById(supabase, orgId)

  // Opening balance for the (optional) selected account = balance as of
  // the day before startDate. For "all accounts" mode it's 0 since the
  // running balance is per-account and we don't compute it across rows.
  let openingBalance_cents = 0
  if (accountId) {
    const dayBefore = previousDayIso(startDate)
    const balances = await fetchAccountBalances(supabase, orgId, accounts, dayBefore)
    openingBalance_cents = balances.get(accountId) ?? 0
  }

  // Pull entries in range. We need entry-level fields (number, source,
  // etc.) plus line-level fields, so we go through journal_entry_lines
  // with an inner join.
  let query = supabase
    .from('journal_entry_lines')
    .select(
      'account_id, debit_cents, credit_cents, description, line_number, journal_entries!inner(id, organization_id, entry_date, entry_number, description, source_type, source_id, posted_at, deleted_at)'
    )
    .eq('journal_entries.organization_id', orgId)
    .not('journal_entries.posted_at', 'is', null)
    .is('journal_entries.deleted_at', null)
    .gte('journal_entries.entry_date', startDate)
    .lte('journal_entries.entry_date', endDate)
    .order('entry_date', { foreignTable: 'journal_entries', ascending: true })
    .order('entry_number', { foreignTable: 'journal_entries', ascending: true })
    .order('line_number', { ascending: true })
    .limit(limit)

  if (accountId) {
    query = query.eq('account_id', accountId)
  }

  const { data, error } = await query
  if (error) {
    throw new ReportError(`Failed to fetch general ledger entries: ${error.message}`)
  }

  const account = accountId ? accounts.get(accountId) : null
  let running = openingBalance_cents
  let totalDebits = 0
  let totalCredits = 0
  const entries: GeneralLedgerEntry[] = []

  for (const r of (data ?? []) as unknown as GeneralLedgerRawRow[]) {
    if (!r.journal_entries) continue
    const debit = Number(r.debit_cents) || 0
    const credit = Number(r.credit_cents) || 0
    totalDebits += debit
    totalCredits += credit

    const lineAccount = accounts.get(r.account_id)
    const effectiveAccount = account ?? lineAccount

    if (accountId && effectiveAccount) {
      // Running balance accumulates in the natural direction of the
      // selected account. For asset/expense, debits add; for the rest,
      // credits add.
      const sign =
        effectiveAccount.type === 'asset' || effectiveAccount.type === 'expense' ? 1 : -1
      running += sign * (debit - credit)
    }

    entries.push({
      entry_id: r.journal_entries.id,
      entry_date: r.journal_entries.entry_date,
      entry_number: r.journal_entries.entry_number,
      description: r.description ?? r.journal_entries.description,
      account_id: r.account_id,
      account_code: lineAccount?.code ?? '',
      account_name: lineAccount?.name ?? '',
      debit_cents: debit,
      credit_cents: credit,
      running_balance_cents: accountId ? running : 0,
      source_type: r.journal_entries.source_type,
      source_id: r.journal_entries.source_id,
    })
  }

  const closingBalance_cents = accountId ? running : 0

  return {
    startDate,
    endDate,
    accountId: accountId ?? null,
    entries,
    openingBalance_cents,
    closingBalance_cents,
    totals: { debits_cents: totalDebits, credits_cents: totalCredits },
  }
}

// ============================================================
// 8. SALES TAX SUMMARY
// ============================================================

interface InvoiceForTax {
  id: string
  invoice_date: string
  subtotal_cents: number
  tax_amount_cents: number
  job_id: string | null
}

interface BillForTax {
  id: string
  bill_date: string
  subtotal_cents: number
  tax_amount_cents: number
}

interface JobLineForTax {
  job_id: string
  tax_rate_id: string | null
  total_price_cents: number | null
  is_taxable: boolean
}

interface TaxRateRow {
  id: string
  name: string
  rate_pct: number
}

/**
 * Per-rate tax breakdown for a date range. Collected = tax on invoices
 * (revenue side); paid = tax on bills (recoverable). Net owed = the
 * delta the user remits.
 *
 * For invoices we group line-level taxable revenue by `tax_rate_id` on
 * `job_line_items` (PA's invoice-lines), and pair with the invoice's
 * header tax_amount_cents on a proportional basis. Bills don't have
 * per-line tax rates in v1, so we report them under "Unspecified".
 */
export async function getSalesTaxSummary(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<SalesTaxSummaryReport> {
  if (!startDate || !endDate) {
    throw new ReportError('getSalesTaxSummary requires both startDate and endDate.')
  }

  // 1. Load tax rates so we can label rows.
  const { data: rateRows, error: rateErr } = await supabase
    .from('tax_rates')
    .select('id, name, rate_pct')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
  if (rateErr) {
    throw new ReportError(`Failed to load tax rates: ${rateErr.message}`)
  }
  const ratesById = new Map<string, TaxRateRow>()
  for (const r of (rateRows ?? []) as TaxRateRow[]) {
    ratesById.set(r.id, r)
  }

  // 2. Load invoices in range with tax.
  const { data: invoiceRows, error: invErr } = await supabase
    .from('invoices')
    .select('id, invoice_date, subtotal_cents, tax_amount_cents, job_id')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gte('invoice_date', startDate)
    .lte('invoice_date', endDate)
    .gt('tax_amount_cents', 0)

  if (invErr) {
    throw new ReportError(`Failed to load invoices: ${invErr.message}`)
  }
  const invoices = (invoiceRows ?? []) as InvoiceForTax[]

  // 3. Load matching job lines for per-rate grouping.
  const jobIds = invoices.map((i) => i.job_id).filter((x): x is string => !!x)
  let jobLines: JobLineForTax[] = []
  if (jobIds.length > 0) {
    const { data: lineRows, error: lineErr } = await supabase
      .from('job_line_items')
      .select('job_id, tax_rate_id, total_price_cents, is_taxable')
      .in('job_id', jobIds)
    if (lineErr) {
      throw new ReportError(`Failed to load job line items for tax breakdown: ${lineErr.message}`)
    }
    jobLines = (lineRows ?? []) as JobLineForTax[]
  }

  const linesByJob = new Map<string, JobLineForTax[]>()
  for (const l of jobLines) {
    const arr = linesByJob.get(l.job_id) ?? []
    arr.push(l)
    linesByJob.set(l.job_id, arr)
  }

  // Aggregate by tax_rate_id.
  const groups = new Map<
    string,
    { taxable_subtotal_cents: number; tax_collected_cents: number }
  >()
  const UNSPECIFIED = '__unspecified__'

  for (const inv of invoices) {
    const lines = inv.job_id ? linesByJob.get(inv.job_id) ?? [] : []
    const taxableLines = lines.filter((l) => l.is_taxable && (l.total_price_cents ?? 0) > 0)
    const taxableSubtotal = taxableLines.reduce(
      (a, l) => a + (l.total_price_cents ?? 0),
      0
    )

    if (taxableLines.length === 0 || taxableSubtotal === 0) {
      const cur =
        groups.get(UNSPECIFIED) ?? { taxable_subtotal_cents: 0, tax_collected_cents: 0 }
      cur.taxable_subtotal_cents += inv.subtotal_cents
      cur.tax_collected_cents += inv.tax_amount_cents
      groups.set(UNSPECIFIED, cur)
      continue
    }

    // Allocate tax across rates proportionally to each rate's taxable share.
    const rateSubtotals = new Map<string, number>()
    for (const l of taxableLines) {
      const rateKey = l.tax_rate_id ?? UNSPECIFIED
      rateSubtotals.set(rateKey, (rateSubtotals.get(rateKey) ?? 0) + (l.total_price_cents ?? 0))
    }
    for (const [rateKey, subtotal] of rateSubtotals.entries()) {
      const share = subtotal / taxableSubtotal
      const taxShare = Math.round(inv.tax_amount_cents * share)
      const cur =
        groups.get(rateKey) ?? { taxable_subtotal_cents: 0, tax_collected_cents: 0 }
      cur.taxable_subtotal_cents += subtotal
      cur.tax_collected_cents += taxShare
      groups.set(rateKey, cur)
    }
  }

  // 4. Tax paid on bills (recoverable). v1 lumps all bill tax under
  // "Unspecified" since bills don't carry per-line rate ids in PA.
  const { data: billRows, error: billErr } = await supabase
    .from('bills')
    .select('id, bill_date, subtotal_cents, tax_amount_cents')
    .eq('organization_id', orgId)
    .is('deleted_at', null)
    .gte('bill_date', startDate)
    .lte('bill_date', endDate)
    .gt('tax_amount_cents', 0)

  if (billErr) {
    throw new ReportError(`Failed to load bills: ${billErr.message}`)
  }
  const bills = (billRows ?? []) as BillForTax[]
  let totalBillTax = 0
  for (const b of bills) {
    totalBillTax += b.tax_amount_cents
  }

  // 5. Materialize the report rows.
  const rows: SalesTaxBreakdownRow[] = []
  for (const [rateKey, totals] of groups.entries()) {
    const rate = rateKey === UNSPECIFIED ? null : ratesById.get(rateKey)
    rows.push({
      tax_rate_id: rate?.id ?? null,
      tax_rate_name: rate?.name ?? 'Unspecified',
      rate_pct: rate ? Number(rate.rate_pct) : 0,
      taxable_subtotal_cents: totals.taxable_subtotal_cents,
      tax_collected_cents: totals.tax_collected_cents,
      tax_paid_cents: 0,
      net_tax_owed_cents: totals.tax_collected_cents,
    })
  }

  // Drop bill tax onto "Unspecified" row (or create one if missing).
  if (totalBillTax > 0) {
    const unspec = rows.find((r) => r.tax_rate_id === null)
    if (unspec) {
      unspec.tax_paid_cents += totalBillTax
      unspec.net_tax_owed_cents = unspec.tax_collected_cents - unspec.tax_paid_cents
    } else {
      rows.push({
        tax_rate_id: null,
        tax_rate_name: 'Unspecified',
        rate_pct: 0,
        taxable_subtotal_cents: 0,
        tax_collected_cents: 0,
        tax_paid_cents: totalBillTax,
        net_tax_owed_cents: -totalBillTax,
      })
    }
  }

  rows.sort((a, b) => a.tax_rate_name.localeCompare(b.tax_rate_name))

  const totals = rows.reduce(
    (acc, r) => {
      acc.taxable_subtotal_cents += r.taxable_subtotal_cents
      acc.tax_collected_cents += r.tax_collected_cents
      acc.tax_paid_cents += r.tax_paid_cents
      acc.net_tax_owed_cents += r.net_tax_owed_cents
      return acc
    },
    {
      taxable_subtotal_cents: 0,
      tax_collected_cents: 0,
      tax_paid_cents: 0,
      net_tax_owed_cents: 0,
    }
  )

  return { startDate, endDate, rows, totals }
}
