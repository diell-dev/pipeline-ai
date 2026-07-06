/**
 * Pipeline AI — Books Posting Engine (Agent B2)
 *
 * Turns business documents (invoices, bills, payments, expenses) into
 * double-entry journal entries against the chart of accounts that
 * migration 015 set up. Every function is idempotent on a per-source
 * basis: if an active (non-reversed, non-deleted) entry already
 * exists for the source, the helper returns it instead of duplicating.
 *
 * Design rationale (see B2 brief):
 *   - Posting lives in TypeScript, not Postgres triggers, for
 *     debuggability and testability. The DB still enforces the
 *     non-negotiables: trial-balance equality (trg_jel_trial_balance,
 *     DEFERRABLE INITIALLY DEFERRED so two-step inserts are fine) and
 *     locked-period writes (trg_je_period_lock).
 *   - Soft-delete reversal is ALSO TypeScript-side via
 *     `softDeleteAndReverse` — see the module-doc note below.
 *   - All amounts in BIGINT cents. The legacy DECIMAL columns on
 *     invoices/job_line_items stay populated for backwards-compat but
 *     posting reads ONLY from the *_cents columns (migration 015
 *     backfilled them).
 *
 * Soft-delete reversal: WHY TypeScript instead of a Postgres trigger.
 *   - A trigger has to do account lookups, period resolution, and
 *     atomic sequence-number claiming; doable, but every change to
 *     the rules means a new migration.
 *   - The reversal logic IS the posting logic, just inverted. Keeping
 *     it in TS lets us share the validation + lookup paths.
 *   - API routes call `softDeleteAndReverse(...)` for the deletion;
 *     direct deletes via SQL bypass the reversal, but RLS already
 *     restricts who can do that.
 *   - When B6 / future work backfills entries for historical rows,
 *     the same helpers compose cleanly.
 */
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

import {
  AccountLookupError,
  ChartAccountRow,
  STANDARD_ACCOUNTS,
  getAccountByCode,
  getAccountById,
} from './accounts'
import {
  AccountingPeriodRow,
  getOpenPeriodOrFail,
  pickReversalDate,
} from './periods'

// ============================================================
// Public types
// ============================================================

export type PostingSourceType =
  | 'invoice'
  | 'bill'
  | 'payment'
  | 'expense'
  | 'opening_balance'

export interface PostingResult {
  journal_entry_id: string
  entry_number: string
  reused: boolean
}

export interface JournalLineSpec {
  account_id: string
  debit_cents: number
  credit_cents: number
  description?: string | null
}

export interface NewJournalEntryInput {
  organization_id: string
  entry_date: string
  description: string
  reference?: string | null
  source_type:
    | 'manual'
    | 'invoice'
    | 'bill'
    | 'payment'
    | 'expense'
    | 'bank_transaction'
    | 'opening_balance'
    | 'reversal'
    | 'depreciation'
    | 'adjustment'
  source_id?: string | null
  reversal_of_id?: string | null
  period_id?: string | null
  currency?: string
  exchange_rate_to_base?: number
  created_by?: string | null
  lines: JournalLineSpec[]
}

export class PostingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostingError'
  }
}

export class TrialBalanceError extends Error {
  constructor(message: string, public readonly debits: number, public readonly credits: number) {
    super(message)
    this.name = 'TrialBalanceError'
  }
}

// ============================================================
// Source-row shapes (only the fields posting needs)
// ============================================================

interface InvoiceForPosting {
  id: string
  organization_id: string
  invoice_number: string
  invoice_date: string
  status: string
  subtotal_cents: number
  tax_amount_cents: number
  total_cents: number
  currency: string
  job_id: string | null
  deleted_at: string | null
  locked_at: string | null
}

interface InvoiceLineForPosting {
  id: string
  job_id: string
  quantity: number | string
  unit_price_cents: number | null
  total_price_cents: number | null
  account_id: string | null
  tax_rate_id: string | null
  is_taxable: boolean
  line_number: number | null
  notes: string | null
}

interface BillForPosting {
  id: string
  organization_id: string
  internal_number: string
  bill_date: string
  status: string
  subtotal_cents: number
  tax_amount_cents: number
  total_cents: number
  currency: string
  deleted_at: string | null
  locked_at: string | null
}

interface BillLineForPosting {
  id: string
  bill_id: string
  account_id: string
  total_cents: number
  tax_amount_cents: number
  is_taxable: boolean
  line_number: number
  description: string | null
}

interface PaymentForPosting {
  id: string
  organization_id: string
  payment_date: string
  payment_number: string
  type: 'invoice_payment' | 'bill_payment' | 'refund' | 'transfer'
  source_type: string
  source_id: string | null
  amount_cents: number
  currency: string
  deposit_to_account_id: string | null
  payment_method_details: Record<string, unknown>
  deleted_at: string | null
}

interface ExpenseForPosting {
  id: string
  organization_id: string
  expense_date: string
  description: string | null
  expense_account_id: string | null
  expense_category_id: string | null
  payment_account_id: string | null
  amount_cents: number
  tax_amount_cents: number
  total_cents: number
  currency: string
  is_reimbursable: boolean
  is_reimbursed: boolean
  deleted_at: string | null
}

// ============================================================
// Internal: low-level entry insert (atomic)
// ============================================================

interface NextSequenceRow {
  next_books_sequence: string
}

interface InsertedJournalEntry {
  id: string
  entry_number: string
}

async function claimEntryNumber(
  supabase: SupabaseClient,
  orgId: string
): Promise<string> {
  const { data, error } = await supabase.rpc('next_books_sequence', {
    p_org_id: orgId,
    p_kind: 'journal_entry',
  })
  if (error) {
    throw new PostingError(
      `Failed to claim next journal_entry sequence for org ${orgId}: ${error.message}`
    )
  }
  // The RPC returns the bare string. Some clients deserialize it as
  // { next_books_sequence: '...' }; handle both.
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'next_books_sequence' in data) {
    return (data as NextSequenceRow).next_books_sequence
  }
  throw new PostingError(
    `next_books_sequence returned unexpected payload: ${JSON.stringify(data)}`
  )
}

/**
 * Insert a journal entry + its lines atomically. The trial-balance
 * trigger is DEFERRABLE INITIALLY DEFERRED so we can insert the
 * entry as posted (posted_at set) and then insert its lines in the
 * same statement-batch; the trigger fires at COMMIT.
 *
 * If anything goes wrong after the entry insert but before the lines
 * land, we delete the entry on the way out so we don't leave an
 * orphan numbered entry behind.
 */
async function insertEntryWithLines(
  supabase: SupabaseClient,
  input: NewJournalEntryInput
): Promise<InsertedJournalEntry> {
  assertBalanced(input.lines)

  const entryNumber = await claimEntryNumber(supabase, input.organization_id)
  const postedAt = new Date().toISOString()

  const { data: entry, error: entryError } = await supabase
    .from('journal_entries')
    .insert({
      organization_id: input.organization_id,
      entry_number: entryNumber,
      entry_date: input.entry_date,
      posted_at: postedAt,
      description: input.description,
      reference: input.reference ?? null,
      source_type: input.source_type,
      source_id: input.source_id ?? null,
      reversal_of_id: input.reversal_of_id ?? null,
      period_id: input.period_id ?? null,
      currency: input.currency ?? 'USD',
      exchange_rate_to_base: input.exchange_rate_to_base ?? 1,
      created_by: input.created_by ?? null,
    })
    .select('id, entry_number')
    .single<InsertedJournalEntry>()

  if (entryError || !entry) {
    throw new PostingError(
      `Failed to insert journal_entry ${entryNumber}: ${entryError?.message ?? 'no row returned'}`
    )
  }

  const linesPayload = input.lines.map((l, idx) => ({
    journal_entry_id: entry.id,
    account_id: l.account_id,
    debit_cents: Math.max(0, Math.round(l.debit_cents)),
    credit_cents: Math.max(0, Math.round(l.credit_cents)),
    description: l.description ?? null,
    line_number: idx + 1,
  }))

  const { error: linesError } = await supabase
    .from('journal_entry_lines')
    .insert(linesPayload)

  if (linesError) {
    // Roll back the entry header so we don't leave a numbered entry
    // with zero lines (which is also out-of-balance once committed).
    await supabase.from('journal_entries').delete().eq('id', entry.id)
    throw new PostingError(
      `Failed to insert journal_entry_lines for ${entry.entry_number}: ${linesError.message}`
    )
  }

  return entry
}

function assertBalanced(lines: JournalLineSpec[]): void {
  if (lines.length < 2) {
    throw new TrialBalanceError(
      'A journal entry needs at least two lines (one debit, one credit).',
      0,
      0
    )
  }
  let debits = 0
  let credits = 0
  for (const l of lines) {
    if (l.debit_cents < 0 || l.credit_cents < 0) {
      throw new TrialBalanceError(
        'Journal entry line amounts must be non-negative.',
        debits,
        credits
      )
    }
    if (l.debit_cents > 0 && l.credit_cents > 0) {
      throw new TrialBalanceError(
        'Each journal entry line must be one-sided (debit XOR credit).',
        debits,
        credits
      )
    }
    debits += l.debit_cents
    credits += l.credit_cents
  }
  if (debits !== credits) {
    throw new TrialBalanceError(
      `Journal entry is out of balance: debits=${debits} credits=${credits}`,
      debits,
      credits
    )
  }
  if (debits === 0) {
    throw new TrialBalanceError(
      'Journal entry totals to zero — refusing to post.',
      0,
      0
    )
  }
}

// ============================================================
// Idempotency: existing-entry lookup
// ============================================================

interface ExistingEntryRow {
  id: string
  entry_number: string
}

export async function findExistingActiveEntry(
  supabase: SupabaseClient,
  orgId: string,
  sourceType: PostingSourceType,
  sourceId: string
): Promise<ExistingEntryRow | null> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, entry_number')
    .eq('organization_id', orgId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .is('deleted_at', null)
    .is('reversal_of_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ExistingEntryRow>()

  if (error) {
    throw new PostingError(
      `Failed to look up existing journal entry for ${sourceType} ${sourceId}: ${error.message}`
    )
  }
  return data ?? null
}

// ============================================================
// 1. POST INVOICE
// ============================================================
/**
 * Auto-post an invoice. AR is debited for the gross total; revenue
 * accounts are credited per line (defaulting to Service Revenue when
 * the line has no account_id); sales tax payable is credited for the
 * tax portion (single combined line — per-rate breakdown is a B4
 * problem when we surface tax-rate-level reports).
 *
 * Skips and returns the existing entry if one already exists. Throws
 * on draft invoices, deleted invoices, and locked periods.
 */
export async function postInvoice(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<PostingResult> {
  const { data: invoice, error } = await supabase
    .from('invoices')
    .select(
      'id, organization_id, invoice_number, invoice_date, status, subtotal_cents, tax_amount_cents, total_cents, currency, job_id, deleted_at, locked_at'
    )
    .eq('id', invoiceId)
    .maybeSingle<InvoiceForPosting>()

  if (error) {
    throw new PostingError(`Failed to load invoice ${invoiceId}: ${error.message}`)
  }
  if (!invoice) {
    throw new PostingError(`Invoice ${invoiceId} not found.`)
  }
  if (invoice.deleted_at) {
    throw new PostingError(`Invoice ${invoice.invoice_number} is soft-deleted; cannot post.`)
  }
  if (invoice.status === 'draft') {
    throw new PostingError(
      `Invoice ${invoice.invoice_number} is in draft status; only non-draft invoices post.`
    )
  }
  if (invoice.total_cents <= 0) {
    throw new PostingError(
      `Invoice ${invoice.invoice_number} has total_cents=${invoice.total_cents}; nothing to post.`
    )
  }

  // Idempotency: bail with the existing entry if we've already posted.
  const existing = await findExistingActiveEntry(
    supabase,
    invoice.organization_id,
    'invoice',
    invoice.id
  )
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  const period = await getOpenPeriodOrFail(
    supabase,
    invoice.organization_id,
    invoice.invoice_date
  )

  const arAccount = await getAccountByCode(
    supabase,
    invoice.organization_id,
    STANDARD_ACCOUNTS.AR
  )
  const defaultRevenue = await getAccountByCode(
    supabase,
    invoice.organization_id,
    STANDARD_ACCOUNTS.SERVICE_REVENUE
  )

  const lines: JournalLineSpec[] = []

  // DR — Accounts Receivable
  lines.push({
    account_id: arAccount.id,
    debit_cents: invoice.total_cents,
    credit_cents: 0,
    description: `Invoice ${invoice.invoice_number}`,
  })

  // CR — Revenue accounts (per-line, aggregated by account_id)
  // PA uses job_line_items as its invoice-lines table via invoice.job_id.
  let revenueRemainder = invoice.subtotal_cents
  if (invoice.job_id) {
    const { data: jobLines, error: linesErr } = await supabase
      .from('job_line_items')
      .select(
        'id, job_id, quantity, unit_price_cents, total_price_cents, account_id, tax_rate_id, is_taxable, line_number, notes'
      )
      .eq('job_id', invoice.job_id)
    if (linesErr) {
      throw new PostingError(
        `Failed to load job_line_items for invoice ${invoice.invoice_number}: ${linesErr.message}`
      )
    }

    if (jobLines && jobLines.length > 0) {
      const aggregate = new Map<string, number>()
      for (const line of jobLines as InvoiceLineForPosting[]) {
        const amount = line.total_price_cents ?? 0
        if (amount <= 0) continue
        const accountId = line.account_id ?? defaultRevenue.id
        // Validate non-default accounts belong to this org.
        if (line.account_id) {
          await assertAccountInOrg(supabase, line.account_id, invoice.organization_id)
        }
        aggregate.set(accountId, (aggregate.get(accountId) ?? 0) + amount)
      }

      const aggregateTotal = Array.from(aggregate.values()).reduce((a, b) => a + b, 0)
      if (aggregateTotal !== invoice.subtotal_cents && aggregateTotal > 0) {
        // Drift between line sums and header subtotal can happen when
        // discounts hit the header. Reconcile by pushing the delta onto
        // the default revenue account so the entry still balances.
        const drift = invoice.subtotal_cents - aggregateTotal
        aggregate.set(
          defaultRevenue.id,
          (aggregate.get(defaultRevenue.id) ?? 0) + drift
        )
      }

      for (const [accountId, amount] of aggregate.entries()) {
        if (amount === 0) continue
        lines.push({
          account_id: accountId,
          debit_cents: 0,
          credit_cents: amount,
          description: `Revenue — invoice ${invoice.invoice_number}`,
        })
      }
      revenueRemainder = 0
    }
  } else {
    // Books-native invoice (no job_id): revenue lines live in
    // invoice_line_items, each with its own account_id. Aggregate the
    // pre-tax revenue (line total_cents INCLUDES tax) by account so the
    // P&L shows revenue-by-account instead of dumping it all on 4000. (H3)
    const { data: invLines, error: invLinesErr } = await supabase
      .from('invoice_line_items')
      .select('account_id, total_cents, tax_amount_cents')
      .eq('invoice_id', invoice.id)
    if (invLinesErr) {
      throw new PostingError(
        `Failed to load invoice_line_items for invoice ${invoice.invoice_number}: ${invLinesErr.message}`
      )
    }
    if (invLines && invLines.length > 0) {
      const aggregate = new Map<string, number>()
      for (const line of invLines as Array<{
        account_id: string | null
        total_cents: number | null
        tax_amount_cents: number | null
      }>) {
        const amount = (line.total_cents ?? 0) - (line.tax_amount_cents ?? 0)
        if (amount <= 0) continue
        const accountId = line.account_id ?? defaultRevenue.id
        if (line.account_id) {
          await assertAccountInOrg(supabase, line.account_id, invoice.organization_id)
        }
        aggregate.set(accountId, (aggregate.get(accountId) ?? 0) + amount)
      }
      const aggregateTotal = Array.from(aggregate.values()).reduce((a, b) => a + b, 0)
      if (aggregateTotal !== invoice.subtotal_cents && aggregateTotal > 0) {
        const drift = invoice.subtotal_cents - aggregateTotal
        aggregate.set(defaultRevenue.id, (aggregate.get(defaultRevenue.id) ?? 0) + drift)
      }
      for (const [accountId, amount] of aggregate.entries()) {
        if (amount === 0) continue
        lines.push({
          account_id: accountId,
          debit_cents: 0,
          credit_cents: amount,
          description: `Revenue — invoice ${invoice.invoice_number}`,
        })
      }
      revenueRemainder = 0
    }
  }

  // Fallback: invoice has no line items (or job_id is null). Push the
  // whole subtotal to default revenue.
  if (revenueRemainder > 0) {
    lines.push({
      account_id: defaultRevenue.id,
      debit_cents: 0,
      credit_cents: revenueRemainder,
      description: `Revenue — invoice ${invoice.invoice_number}`,
    })
  }

  // CR — Sales Tax Payable
  if (invoice.tax_amount_cents > 0) {
    const salesTax = await getAccountByCode(
      supabase,
      invoice.organization_id,
      STANDARD_ACCOUNTS.SALES_TAX
    )
    lines.push({
      account_id: salesTax.id,
      debit_cents: 0,
      credit_cents: invoice.tax_amount_cents,
      description: `Sales tax — invoice ${invoice.invoice_number}`,
    })
  }

  const inserted = await insertEntryWithLines(supabase, {
    organization_id: invoice.organization_id,
    entry_date: invoice.invoice_date,
    description: `Invoice ${invoice.invoice_number}`,
    reference: invoice.invoice_number,
    source_type: 'invoice',
    source_id: invoice.id,
    period_id: period?.id ?? null,
    currency: invoice.currency,
    lines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

async function assertAccountInOrg(
  supabase: SupabaseClient,
  accountId: string,
  orgId: string
): Promise<void> {
  const account = await getAccountById(supabase, accountId)
  if (account.organization_id !== orgId) {
    throw new AccountLookupError(
      `Account ${accountId} belongs to org ${account.organization_id}, not the expected ${orgId}.`
    )
  }
}

// ============================================================
// 2. POST BILL
// ============================================================
/**
 * Auto-post a bill. Each line is a debit to its expense account; tax
 * is debited to Sales Tax (recoverable); the gross total credits AP.
 */
export async function postBill(
  supabase: SupabaseClient,
  billId: string
): Promise<PostingResult> {
  const { data: bill, error } = await supabase
    .from('bills')
    .select(
      'id, organization_id, internal_number, bill_date, status, subtotal_cents, tax_amount_cents, total_cents, currency, deleted_at, locked_at'
    )
    .eq('id', billId)
    .maybeSingle<BillForPosting>()

  if (error) {
    throw new PostingError(`Failed to load bill ${billId}: ${error.message}`)
  }
  if (!bill) {
    throw new PostingError(`Bill ${billId} not found.`)
  }
  if (bill.deleted_at) {
    throw new PostingError(`Bill ${bill.internal_number} is soft-deleted; cannot post.`)
  }
  if (bill.status === 'draft') {
    throw new PostingError(
      `Bill ${bill.internal_number} is in draft status; only non-draft bills post.`
    )
  }
  if (bill.total_cents <= 0) {
    throw new PostingError(
      `Bill ${bill.internal_number} has total_cents=${bill.total_cents}; nothing to post.`
    )
  }

  const existing = await findExistingActiveEntry(
    supabase,
    bill.organization_id,
    'bill',
    bill.id
  )
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  const period = await getOpenPeriodOrFail(supabase, bill.organization_id, bill.bill_date)

  const { data: rawLines, error: lineErr } = await supabase
    .from('bill_line_items')
    .select(
      'id, bill_id, account_id, total_cents, tax_amount_cents, is_taxable, line_number, description'
    )
    .eq('bill_id', bill.id)
    .order('line_number', { ascending: true })

  if (lineErr) {
    throw new PostingError(
      `Failed to load bill_line_items for bill ${bill.internal_number}: ${lineErr.message}`
    )
  }
  const billLines: BillLineForPosting[] = (rawLines ?? []) as BillLineForPosting[]
  if (billLines.length === 0) {
    throw new PostingError(
      `Bill ${bill.internal_number} has no line items; cannot determine expense accounts.`
    )
  }

  const apAccount = await getAccountByCode(
    supabase,
    bill.organization_id,
    STANDARD_ACCOUNTS.AP
  )

  // Aggregate expense lines by account_id to keep entries compact.
  const expenseAggregate = new Map<string, number>()
  for (const line of billLines) {
    await assertAccountInOrg(supabase, line.account_id, bill.organization_id)
    if (line.total_cents <= 0) continue
    expenseAggregate.set(
      line.account_id,
      (expenseAggregate.get(line.account_id) ?? 0) + line.total_cents
    )
  }

  const lines: JournalLineSpec[] = []
  for (const [accountId, amount] of expenseAggregate.entries()) {
    if (amount === 0) continue
    lines.push({
      account_id: accountId,
      debit_cents: amount,
      credit_cents: 0,
      description: `Expense — bill ${bill.internal_number}`,
    })
  }

  // US sales tax (USD-only deployment per spec): sales tax paid on
  // business purchases is NOT recoverable like VAT — it becomes part
  // of the cost basis of whatever was purchased. We roll bill tax into
  // the expense accounts proportionally so the Sales Tax Payable
  // account reflects only tax COLLECTED from customers (i.e. what
  // we owe to the state tax authority), never tax we paid out.
  // If we ever support VAT jurisdictions, gate this on org.country
  // and put the tax into a "Recoverable Input Tax" asset account.
  if (bill.tax_amount_cents > 0 && lines.length > 0) {
    const expenseTotal = lines.reduce((sum, l) => sum + l.debit_cents, 0)
    if (expenseTotal > 0) {
      let allocated = 0
      // Distribute proportionally, with the last line absorbing any
      // rounding remainder so the total tax is fully allocated.
      for (let i = 0; i < lines.length; i += 1) {
        const isLast = i === lines.length - 1
        const share = isLast
          ? bill.tax_amount_cents - allocated
          : Math.floor((lines[i].debit_cents * bill.tax_amount_cents) / expenseTotal)
        lines[i].debit_cents += share
        lines[i].description += ' (incl. NY sales tax)'
        allocated += share
      }
    } else {
      // No expense lines (shouldn't happen — guarded above). Fall back
      // to MISCELLANEOUS to keep the entry balanced.
      const misc = await getAccountByCode(
        supabase,
        bill.organization_id,
        STANDARD_ACCOUNTS.MISCELLANEOUS
      )
      lines.push({
        account_id: misc.id,
        debit_cents: bill.tax_amount_cents,
        credit_cents: 0,
        description: `Sales tax — bill ${bill.internal_number}`,
      })
    }
  }

  lines.push({
    account_id: apAccount.id,
    debit_cents: 0,
    credit_cents: bill.total_cents,
    description: `Accounts Payable — bill ${bill.internal_number}`,
  })

  const inserted = await insertEntryWithLines(supabase, {
    organization_id: bill.organization_id,
    entry_date: bill.bill_date,
    description: `Bill ${bill.internal_number}`,
    reference: bill.internal_number,
    source_type: 'bill',
    source_id: bill.id,
    period_id: period?.id ?? null,
    currency: bill.currency,
    lines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

// ============================================================
// 3. POST PAYMENT
// ============================================================
/**
 * Auto-post a payment. The four payment types map to four templates;
 * see the brief for the DR/CR matrix.
 */
export async function postPayment(
  supabase: SupabaseClient,
  paymentId: string
): Promise<PostingResult> {
  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, organization_id, payment_date, payment_number, type, source_type, source_id, amount_cents, currency, deposit_to_account_id, payment_method_details, deleted_at'
    )
    .eq('id', paymentId)
    .maybeSingle<PaymentForPosting>()

  if (error) {
    throw new PostingError(`Failed to load payment ${paymentId}: ${error.message}`)
  }
  if (!payment) {
    throw new PostingError(`Payment ${paymentId} not found.`)
  }
  if (payment.deleted_at) {
    throw new PostingError(`Payment ${payment.payment_number} is soft-deleted; cannot post.`)
  }
  if (payment.amount_cents <= 0) {
    throw new PostingError(
      `Payment ${payment.payment_number} has amount_cents=${payment.amount_cents}; nothing to post.`
    )
  }

  const existing = await findExistingActiveEntry(
    supabase,
    payment.organization_id,
    'payment',
    payment.id
  )
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  const period = await getOpenPeriodOrFail(
    supabase,
    payment.organization_id,
    payment.payment_date
  )

  const bank = await resolveBankAccount(supabase, payment)

  let lines: JournalLineSpec[]
  let description: string

  switch (payment.type) {
    case 'invoice_payment': {
      const ar = await getAccountByCode(
        supabase,
        payment.organization_id,
        STANDARD_ACCOUNTS.AR
      )
      description = `Payment ${payment.payment_number} (invoice)`
      lines = [
        {
          account_id: bank.id,
          debit_cents: payment.amount_cents,
          credit_cents: 0,
          description,
        },
        {
          account_id: ar.id,
          debit_cents: 0,
          credit_cents: payment.amount_cents,
          description,
        },
      ]
      break
    }
    case 'bill_payment': {
      const ap = await getAccountByCode(
        supabase,
        payment.organization_id,
        STANDARD_ACCOUNTS.AP
      )
      description = `Payment ${payment.payment_number} (bill)`
      lines = [
        {
          account_id: ap.id,
          debit_cents: payment.amount_cents,
          credit_cents: 0,
          description,
        },
        {
          account_id: bank.id,
          debit_cents: 0,
          credit_cents: payment.amount_cents,
          description,
        },
      ]
      break
    }
    case 'refund': {
      // A refund moves money the OTHER way relative to the source it
      // refers to. If it refers to an invoice (we're refunding the
      // customer), money leaves the bank and AR rises back up. If it
      // refers to a bill (vendor refunds us), bank goes up, AP rises.
      // Fall back to the invoice-payment shape when source_type is
      // missing — refund of a sale is the most common case.
      const refundOfBill =
        payment.source_type === 'bill' ||
        payment.payment_method_details?.refund_of === 'bill'

      if (refundOfBill) {
        const ap = await getAccountByCode(
          supabase,
          payment.organization_id,
          STANDARD_ACCOUNTS.AP
        )
        description = `Refund ${payment.payment_number} (from vendor)`
        lines = [
          {
            account_id: bank.id,
            debit_cents: payment.amount_cents,
            credit_cents: 0,
            description,
          },
          {
            account_id: ap.id,
            debit_cents: 0,
            credit_cents: payment.amount_cents,
            description,
          },
        ]
      } else {
        const ar = await getAccountByCode(
          supabase,
          payment.organization_id,
          STANDARD_ACCOUNTS.AR
        )
        description = `Refund ${payment.payment_number} (to customer)`
        lines = [
          {
            account_id: ar.id,
            debit_cents: payment.amount_cents,
            credit_cents: 0,
            description,
          },
          {
            account_id: bank.id,
            debit_cents: 0,
            credit_cents: payment.amount_cents,
            description,
          },
        ]
      }
      break
    }
    case 'transfer': {
      // Transfers move between two bank accounts. We need both ids.
      // Convention: deposit_to_account_id = destination, and
      // payment_method_details.source_account_id = source.
      const sourceAccountId =
        (payment.payment_method_details?.source_account_id as string | undefined) ?? null
      if (!sourceAccountId) {
        throw new PostingError(
          `Transfer ${payment.payment_number} is missing payment_method_details.source_account_id.`
        )
      }
      await assertAccountInOrg(supabase, sourceAccountId, payment.organization_id)
      description = `Transfer ${payment.payment_number}`
      lines = [
        {
          account_id: bank.id,
          debit_cents: payment.amount_cents,
          credit_cents: 0,
          description: `${description} (to)`,
        },
        {
          account_id: sourceAccountId,
          debit_cents: 0,
          credit_cents: payment.amount_cents,
          description: `${description} (from)`,
        },
      ]
      break
    }
    default: {
      const exhaustiveCheck: never = payment.type
      throw new PostingError(`Unknown payment type: ${String(exhaustiveCheck)}`)
    }
  }

  const inserted = await insertEntryWithLines(supabase, {
    organization_id: payment.organization_id,
    entry_date: payment.payment_date,
    description,
    reference: payment.payment_number,
    source_type: 'payment',
    source_id: payment.id,
    period_id: period?.id ?? null,
    currency: payment.currency,
    lines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

/**
 * Pick the bank/cash account to use for a payment. Falls back to
 * the standard Operating Bank Account if `deposit_to_account_id` is
 * NULL — preserves backwards-compat with the v015 migration where
 * existing payments were backfilled without a bank.
 */
async function resolveBankAccount(
  supabase: SupabaseClient,
  payment: PaymentForPosting
): Promise<ChartAccountRow> {
  if (payment.deposit_to_account_id) {
    const acct = await getAccountById(supabase, payment.deposit_to_account_id)
    if (acct.organization_id !== payment.organization_id) {
      throw new AccountLookupError(
        `Payment ${payment.payment_number} deposit_to_account_id belongs to a different org.`
      )
    }
    return acct
  }
  return getAccountByCode(supabase, payment.organization_id, STANDARD_ACCOUNTS.OPERATING_BANK)
}

// ============================================================
// 4. POST EXPENSE
// ============================================================
/**
 * Auto-post an expense. Two flavors:
 *  - Reimbursable, not yet reimbursed → DR expense, CR AP (we owe
 *    the employee).
 *  - Anything else → DR expense + DR recoverable tax, CR the bank/CC
 *    account it was paid from.
 *
 * The expense_account_id on the row wins; falling back to the category
 * default, falling back to Miscellaneous.
 */
export async function postExpense(
  supabase: SupabaseClient,
  expenseId: string
): Promise<PostingResult> {
  const { data: expense, error } = await supabase
    .from('expenses')
    .select(
      'id, organization_id, expense_date, description, expense_account_id, expense_category_id, payment_account_id, amount_cents, tax_amount_cents, total_cents, currency, is_reimbursable, is_reimbursed, deleted_at'
    )
    .eq('id', expenseId)
    .maybeSingle<ExpenseForPosting>()

  if (error) {
    throw new PostingError(`Failed to load expense ${expenseId}: ${error.message}`)
  }
  if (!expense) {
    throw new PostingError(`Expense ${expenseId} not found.`)
  }
  if (expense.deleted_at) {
    throw new PostingError(`Expense ${expenseId} is soft-deleted; cannot post.`)
  }
  if (expense.total_cents <= 0) {
    throw new PostingError(
      `Expense ${expenseId} has total_cents=${expense.total_cents}; nothing to post.`
    )
  }

  const existing = await findExistingActiveEntry(
    supabase,
    expense.organization_id,
    'expense',
    expense.id
  )
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  const period = await getOpenPeriodOrFail(
    supabase,
    expense.organization_id,
    expense.expense_date
  )

  // Resolve the expense account: row override → category default → misc fallback.
  const expenseAccount = await resolveExpenseAccount(supabase, expense)

  const lines: JournalLineSpec[] = []
  const description = expense.description ?? `Expense on ${expense.expense_date}`

  // US sales tax on purchases is NOT recoverable, so fold the tax into the
  // expense-account debit rather than debiting Sales Tax Payable (2200) —
  // which would understate the tax liability and break the sales-tax report.
  // Mirrors the bill treatment. (M10)
  lines.push({
    account_id: expenseAccount.id,
    debit_cents: expense.amount_cents + (expense.tax_amount_cents ?? 0),
    credit_cents: 0,
    description,
  })

  if (expense.is_reimbursable && !expense.is_reimbursed) {
    const ap = await getAccountByCode(
      supabase,
      expense.organization_id,
      STANDARD_ACCOUNTS.AP
    )
    lines.push({
      account_id: ap.id,
      debit_cents: 0,
      credit_cents: expense.total_cents,
      description: `Reimbursable — ${description}`,
    })
  } else {
    // Direct expense: credit the funding account.
    let payAccount: ChartAccountRow
    if (expense.payment_account_id) {
      payAccount = await getAccountById(supabase, expense.payment_account_id)
      if (payAccount.organization_id !== expense.organization_id) {
        throw new AccountLookupError(
          `Expense ${expense.id} payment_account_id belongs to a different org.`
        )
      }
    } else {
      payAccount = await getAccountByCode(
        supabase,
        expense.organization_id,
        STANDARD_ACCOUNTS.OPERATING_BANK
      )
    }
    lines.push({
      account_id: payAccount.id,
      debit_cents: 0,
      credit_cents: expense.total_cents,
      description,
    })
  }

  const inserted = await insertEntryWithLines(supabase, {
    organization_id: expense.organization_id,
    entry_date: expense.expense_date,
    description,
    reference: null,
    source_type: 'expense',
    source_id: expense.id,
    period_id: period?.id ?? null,
    currency: expense.currency,
    lines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

async function resolveExpenseAccount(
  supabase: SupabaseClient,
  expense: ExpenseForPosting
): Promise<ChartAccountRow> {
  if (expense.expense_account_id) {
    const acct = await getAccountById(supabase, expense.expense_account_id)
    if (acct.organization_id !== expense.organization_id) {
      throw new AccountLookupError(
        `Expense ${expense.id} expense_account_id belongs to a different org.`
      )
    }
    return acct
  }

  if (expense.expense_category_id) {
    const { data: cat, error: catErr } = await supabase
      .from('expense_categories')
      .select('default_expense_account_id')
      .eq('id', expense.expense_category_id)
      .maybeSingle<{ default_expense_account_id: string | null }>()
    if (catErr) {
      throw new PostingError(
        `Failed to look up expense_category ${expense.expense_category_id}: ${catErr.message}`
      )
    }
    if (cat?.default_expense_account_id) {
      const acct = await getAccountById(supabase, cat.default_expense_account_id)
      if (acct.organization_id !== expense.organization_id) {
        throw new AccountLookupError(
          `Expense category ${expense.expense_category_id} default account belongs to a different org.`
        )
      }
      return acct
    }
  }

  // Last resort: post against Miscellaneous so we never silently drop
  // an expense for lack of routing data. The user can re-categorize.
  return getAccountByCode(
    supabase,
    expense.organization_id,
    STANDARD_ACCOUNTS.MISCELLANEOUS
  )
}

// ============================================================
// 5. REVERSE JOURNAL ENTRY
// ============================================================
/**
 * Build a mirror entry that flips every debit/credit of the original.
 * The reversal lives in the next open accounting period (or the
 * original date when its period is open). `reversal_of_id` links the
 * pair and gives reports a way to net them out.
 *
 * Returns the reversing entry's id + number. If a reversal already
 * exists for this original, returns it (idempotent).
 */
export async function reverseJournalEntry(
  supabase: SupabaseClient,
  entryId: string,
  reason: string,
  dateOverride?: string
): Promise<PostingResult> {
  const { data: orig, error: origErr } = await supabase
    .from('journal_entries')
    .select(
      'id, organization_id, entry_number, entry_date, description, source_type, source_id, currency, exchange_rate_to_base, deleted_at, reversal_of_id'
    )
    .eq('id', entryId)
    .maybeSingle<{
      id: string
      organization_id: string
      entry_number: string
      entry_date: string
      description: string | null
      source_type: NewJournalEntryInput['source_type']
      source_id: string | null
      currency: string
      exchange_rate_to_base: number
      deleted_at: string | null
      reversal_of_id: string | null
    }>()

  if (origErr) {
    throw new PostingError(`Failed to load journal entry ${entryId}: ${origErr.message}`)
  }
  if (!orig) {
    throw new PostingError(`Journal entry ${entryId} not found.`)
  }
  if (orig.reversal_of_id) {
    throw new PostingError(
      `Refusing to reverse entry ${orig.entry_number}: it is itself a reversal.`
    )
  }

  // Idempotency: if a reversal already exists, return it.
  const { data: existing, error: existingErr } = await supabase
    .from('journal_entries')
    .select('id, entry_number')
    .eq('organization_id', orig.organization_id)
    .eq('reversal_of_id', orig.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<ExistingEntryRow>()
  if (existingErr) {
    throw new PostingError(
      `Failed to look up existing reversal of ${orig.entry_number}: ${existingErr.message}`
    )
  }
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  // Load the original's lines.
  const { data: origLines, error: linesErr } = await supabase
    .from('journal_entry_lines')
    .select('account_id, debit_cents, credit_cents, description')
    .eq('journal_entry_id', orig.id)
    .order('line_number', { ascending: true })

  if (linesErr) {
    throw new PostingError(
      `Failed to load lines for journal entry ${orig.entry_number}: ${linesErr.message}`
    )
  }
  if (!origLines || origLines.length === 0) {
    throw new PostingError(
      `Journal entry ${orig.entry_number} has no lines; cannot reverse.`
    )
  }

  // Pick a date for the reversal.
  let reversalDate: string
  let reversalPeriod: AccountingPeriodRow | null = null
  if (dateOverride) {
    reversalDate = dateOverride
    reversalPeriod = await getOpenPeriodOrFail(
      supabase,
      orig.organization_id,
      reversalDate
    )
  } else {
    const picked = await pickReversalDate(
      supabase,
      orig.organization_id,
      orig.entry_date
    )
    reversalDate = picked.date
    reversalPeriod = picked.period
  }

  const flippedLines: JournalLineSpec[] = (origLines as JournalLineSpec[]).map((l) => ({
    account_id: l.account_id,
    debit_cents: l.credit_cents,
    credit_cents: l.debit_cents,
    description: l.description ?? null,
  }))

  const description = `Reversal of ${orig.entry_number}: ${reason}`
  const inserted = await insertEntryWithLines(supabase, {
    organization_id: orig.organization_id,
    entry_date: reversalDate,
    description,
    reference: orig.entry_number,
    source_type: 'reversal',
    source_id: orig.source_id,
    reversal_of_id: orig.id,
    period_id: reversalPeriod?.id ?? null,
    currency: orig.currency,
    exchange_rate_to_base: orig.exchange_rate_to_base,
    lines: flippedLines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

// ============================================================
// 6. POST OPENING BALANCE
// ============================================================
/**
 * Set an account's opening balance as of `asOf`. Creates a single
 * journal entry that debits or credits the target account and offsets
 * to Owner's Equity. Sign of `amountCents`:
 *   - For asset / expense accounts: positive = debit balance.
 *   - For liability / equity / income: positive = credit balance.
 *
 * The function infers the direction from the account's `type`. Pass
 * a negative amount to flip (e.g. an asset that's been overdrawn).
 */
export async function postOpeningBalance(
  supabase: SupabaseClient,
  orgId: string,
  accountId: string,
  amountCents: number,
  asOf: string
): Promise<PostingResult> {
  if (amountCents === 0) {
    throw new PostingError('Opening balance amount cannot be zero.')
  }
  const account = await getAccountById(supabase, accountId)
  if (account.organization_id !== orgId) {
    throw new AccountLookupError(
      `Account ${accountId} belongs to org ${account.organization_id}, not ${orgId}.`
    )
  }

  // Idempotency: one opening balance per account.
  const existing = await findExistingActiveEntry(
    supabase,
    orgId,
    'opening_balance',
    accountId
  )
  if (existing) {
    return {
      journal_entry_id: existing.id,
      entry_number: existing.entry_number,
      reused: true,
    }
  }

  const period = await getOpenPeriodOrFail(supabase, orgId, asOf)
  const equity = await getAccountByCode(supabase, orgId, STANDARD_ACCOUNTS.OWNERS_EQUITY)

  const positiveDebit = account.type === 'asset' || account.type === 'expense'
  const isPositive = amountCents > 0
  const debit = (positiveDebit && isPositive) || (!positiveDebit && !isPositive)
  const abs = Math.abs(amountCents)

  const lines: JournalLineSpec[] = debit
    ? [
        {
          account_id: account.id,
          debit_cents: abs,
          credit_cents: 0,
          description: `Opening balance — ${account.name}`,
        },
        {
          account_id: equity.id,
          debit_cents: 0,
          credit_cents: abs,
          description: `Opening balance offset — ${account.name}`,
        },
      ]
    : [
        {
          account_id: equity.id,
          debit_cents: abs,
          credit_cents: 0,
          description: `Opening balance offset — ${account.name}`,
        },
        {
          account_id: account.id,
          debit_cents: 0,
          credit_cents: abs,
          description: `Opening balance — ${account.name}`,
        },
      ]

  const inserted = await insertEntryWithLines(supabase, {
    organization_id: orgId,
    entry_date: asOf,
    description: `Opening balance — ${account.code} ${account.name}`,
    reference: 'OPENING_BALANCE',
    source_type: 'opening_balance',
    source_id: accountId,
    period_id: period?.id ?? null,
    currency: 'USD',
    lines,
  })

  return {
    journal_entry_id: inserted.id,
    entry_number: inserted.entry_number,
    reused: false,
  }
}

// ============================================================
// 7. SOFT-DELETE + AUTO-REVERSE HELPER
// ============================================================
export type ReversibleTable = 'invoices' | 'bills' | 'payments' | 'expenses'

const TABLE_TO_SOURCE: Record<ReversibleTable, PostingSourceType> = {
  invoices: 'invoice',
  bills: 'bill',
  payments: 'payment',
  expenses: 'expense',
}

/**
 * Soft-delete a source row AND auto-create a reversing journal entry
 * for its active posted entry (if any). Use this from any API route
 * that handles a deletion. Skips reversal cleanly when no posted
 * entry exists (e.g. a draft invoice that was never posted).
 *
 * Returns the inserted reversal's PostingResult, or null when there
 * was nothing to reverse.
 */
export async function softDeleteAndReverse(
  supabase: SupabaseClient,
  table: ReversibleTable,
  rowId: string,
  reason: string
): Promise<PostingResult | null> {
  // 1. Find the row's org so we can target the right journal entry.
  const { data: row, error } = await supabase
    .from(table)
    .select('id, organization_id, deleted_at')
    .eq('id', rowId)
    .maybeSingle<{ id: string; organization_id: string; deleted_at: string | null }>()

  if (error) {
    throw new PostingError(`Failed to load ${table}.${rowId}: ${error.message}`)
  }
  if (!row) {
    throw new PostingError(`${table} row ${rowId} not found.`)
  }
  if (row.deleted_at) {
    // Already soft-deleted; treat as a no-op rather than failing.
    return null
  }

  // 2. Reverse the active posted entry, if any.
  const sourceType = TABLE_TO_SOURCE[table]
  const existing = await findExistingActiveEntry(
    supabase,
    row.organization_id,
    sourceType,
    rowId
  )

  let reversal: PostingResult | null = null
  if (existing) {
    reversal = await reverseJournalEntry(supabase, existing.id, reason)
  }

  // 3. Soft-delete the source row.
  const { error: deleteErr } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', rowId)

  if (deleteErr) {
    throw new PostingError(
      `Failed to soft-delete ${table}.${rowId}: ${deleteErr.message}`
    )
  }

  return reversal
}

// ============================================================
// Helpers re-exported for upstream use
// ============================================================

export { PeriodLockedError } from './periods'
export { AccountLookupError, STANDARD_ACCOUNTS } from './accounts'

// Surface PostgrestError so callers can type-narrow if they catch it.
export type { PostgrestError }
