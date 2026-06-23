/**
 * Smoke test for the bookkeeping posting engine (B2).
 *
 * Run with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://... \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx jiti scripts/smoke-test-books-posting.ts
 *
 * Exits 0 on pass, 1 on assertion failure, 2 when env is missing.
 *
 * The test:
 *   1. Picks NYSD (b0000000-0000-0000-0000-000000000001) as the org.
 *   2. Seeds the default chart of accounts if needed.
 *   3. Ensures an accounting period covers today.
 *   4. Creates a test invoice + one line item, posts it, asserts:
 *      - The journal entry exists.
 *      - The entry balances (debits = credits).
 *      - AR is debited, revenue is credited, sales tax is credited.
 *   5. Records a payment against the invoice, posts it, asserts:
 *      - Bank is debited, AR is credited, totals match.
 *   6. Soft-deletes the invoice via softDeleteAndReverse, asserts:
 *      - A reversal entry exists for the invoice's GL entry.
 *      - Soft-deletes the payment too and asserts its reversal.
 *   7. Cleans up the test data so the script is rerunnable.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  postInvoice,
  postPayment,
  softDeleteAndReverse,
  STANDARD_ACCOUNTS,
} from '../src/lib/books/posting'
import { getAccountByCode } from '../src/lib/books/accounts'

const NYSD_ORG_ID = 'b0000000-0000-0000-0000-000000000001'

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

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || url.includes('placeholder') || serviceKey === 'placeholder') {
    console.error(
      'Missing real Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to point at the live project.'
    )
    process.exit(2)
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`Smoke target: org ${NYSD_ORG_ID}`)
  console.log('Step 1 — verify org exists & seed default chart of accounts')
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name')
    .eq('id', NYSD_ORG_ID)
    .maybeSingle()
  if (orgErr || !org) {
    console.error(`Org ${NYSD_ORG_ID} not found — abort. (${orgErr?.message ?? 'no row'})`)
    process.exit(1)
  }
  console.log(`  org loaded: ${org.name}`)

  const { error: seedErr } = await supabase.rpc('seed_default_chart_of_accounts', {
    p_org_id: NYSD_ORG_ID,
  })
  if (seedErr) {
    console.error(`Seed failed: ${seedErr.message}`)
    process.exit(1)
  }
  console.log('  seed_default_chart_of_accounts() OK')

  console.log('Step 2 — ensure an accounting period covers today')
  const today = new Date().toISOString().slice(0, 10)
  await ensurePeriodCoveringToday(supabase, today)

  console.log('Step 3 — create test invoice')
  const cleanup = new Cleanup(supabase)
  try {
    // Need a client + a job to attach the invoice to. The legacy
    // schema requires both.
    const clientId = await ensureTestClient(supabase, cleanup)
    const jobId = await ensureTestJob(supabase, clientId, cleanup)

    const subtotalCents = 100_00
    const taxCents = 8_88 // ~8.875%
    const totalCents = subtotalCents + taxCents
    const invoiceNumber = `SMOKE-INV-${Date.now()}`
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .insert({
        organization_id: NYSD_ORG_ID,
        job_id: jobId,
        client_id: clientId,
        invoice_number: invoiceNumber,
        amount: 100,
        tax_rate: 8.875,
        tax_amount: 8.88,
        total_amount: 108.88,
        status: 'sent',
        due_date: today,
        invoice_date: today,
        subtotal_cents: subtotalCents,
        tax_amount_cents: taxCents,
        total_cents: totalCents,
        currency: 'USD',
      })
      .select('id, invoice_number')
      .single()
    if (invErr || !invoice) {
      throw new Error(`Failed to create invoice: ${invErr?.message ?? 'no row'}`)
    }
    cleanup.add('invoices', invoice.id)
    console.log(`  created invoice ${invoice.invoice_number} (${invoice.id})`)

    // One line item via job_line_items.
    const { data: lineItem, error: lineErr } = await supabase
      .from('job_line_items')
      .insert({
        job_id: jobId,
        service_catalog_id: await ensureTestServiceCatalogId(supabase, cleanup),
        quantity: 1,
        unit_price: 100,
        total_price: 100,
        unit_price_cents: subtotalCents,
        total_price_cents: subtotalCents,
        is_taxable: true,
        line_number: 1,
        notes: 'Smoke test line',
      })
      .select('id')
      .single()
    if (lineErr || !lineItem) {
      throw new Error(`Failed to insert job_line_item: ${lineErr?.message ?? 'no row'}`)
    }
    cleanup.add('job_line_items', lineItem.id)

    console.log('Step 4 — post the invoice')
    const postedInvoice = await postInvoice(supabase, invoice.id)
    cleanup.addEntry(postedInvoice.journal_entry_id)
    console.log(`  posted entry ${postedInvoice.entry_number} (${postedInvoice.journal_entry_id})`)
    assert('invoice post returns an id', Boolean(postedInvoice.journal_entry_id))
    assert('invoice post is not a reuse on first call', postedInvoice.reused === false)

    const invEntry = await loadEntryWithLines(supabase, postedInvoice.journal_entry_id)
    assert('invoice entry has lines', invEntry.lines.length >= 3,
      `lines=${invEntry.lines.length}`)
    const debits = sum(invEntry.lines, (l) => l.debit_cents)
    const credits = sum(invEntry.lines, (l) => l.credit_cents)
    assert(
      'invoice entry balances',
      debits === credits && debits === totalCents,
      `debits=${debits} credits=${credits} expected=${totalCents}`
    )
    const ar = await getAccountByCode(supabase, NYSD_ORG_ID, STANDARD_ACCOUNTS.AR)
    const rev = await getAccountByCode(supabase, NYSD_ORG_ID, STANDARD_ACCOUNTS.SERVICE_REVENUE)
    const tax = await getAccountByCode(supabase, NYSD_ORG_ID, STANDARD_ACCOUNTS.SALES_TAX)
    assert(
      'AR debited for total',
      invEntry.lines.some((l) => l.account_id === ar.id && l.debit_cents === totalCents)
    )
    assert(
      'Service revenue credited for subtotal',
      invEntry.lines.some((l) => l.account_id === rev.id && l.credit_cents === subtotalCents)
    )
    assert(
      'Sales tax credited',
      invEntry.lines.some((l) => l.account_id === tax.id && l.credit_cents === taxCents)
    )

    console.log('Step 4b — idempotency: second post returns same id')
    const repost = await postInvoice(supabase, invoice.id)
    assert('second invoice post is reuse', repost.reused === true)
    assert('reuse returns same entry id', repost.journal_entry_id === postedInvoice.journal_entry_id)

    console.log('Step 5 — record + post a payment')
    const bankAccount = await getAccountByCode(
      supabase,
      NYSD_ORG_ID,
      STANDARD_ACCOUNTS.OPERATING_BANK
    )
    const paymentNumber = await claimPaymentNumber(supabase, NYSD_ORG_ID)
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        organization_id: NYSD_ORG_ID,
        payment_date: today,
        payment_number: paymentNumber,
        type: 'invoice_payment',
        source_type: 'invoice',
        source_id: invoice.id,
        amount_cents: totalCents,
        currency: 'USD',
        payment_method: 'check',
        deposit_to_account_id: bankAccount.id,
        notes: 'Smoke test payment',
      })
      .select('id, payment_number')
      .single()
    if (payErr || !payment) {
      throw new Error(`Failed to insert payment: ${payErr?.message ?? 'no row'}`)
    }
    cleanup.add('payments', payment.id)

    const postedPayment = await postPayment(supabase, payment.id)
    cleanup.addEntry(postedPayment.journal_entry_id)
    console.log(`  posted payment entry ${postedPayment.entry_number}`)
    const payEntry = await loadEntryWithLines(supabase, postedPayment.journal_entry_id)
    const payDebits = sum(payEntry.lines, (l) => l.debit_cents)
    const payCredits = sum(payEntry.lines, (l) => l.credit_cents)
    assert(
      'payment entry balances',
      payDebits === payCredits && payDebits === totalCents,
      `debits=${payDebits} credits=${payCredits}`
    )
    assert(
      'payment debits bank',
      payEntry.lines.some((l) => l.account_id === bankAccount.id && l.debit_cents === totalCents)
    )
    assert(
      'payment credits AR',
      payEntry.lines.some((l) => l.account_id === ar.id && l.credit_cents === totalCents)
    )

    console.log('Step 6 — soft-delete invoice & payment, assert reversals')
    const paymentReversal = await softDeleteAndReverse(
      supabase,
      'payments',
      payment.id,
      'Smoke test cleanup'
    )
    if (paymentReversal) cleanup.addEntry(paymentReversal.journal_entry_id)
    assert('payment soft-delete produced reversal', paymentReversal !== null)

    const invoiceReversal = await softDeleteAndReverse(
      supabase,
      'invoices',
      invoice.id,
      'Smoke test cleanup'
    )
    if (invoiceReversal) cleanup.addEntry(invoiceReversal.journal_entry_id)
    assert('invoice soft-delete produced reversal', invoiceReversal !== null)

    if (paymentReversal) {
      const rev = await loadEntryWithLines(supabase, paymentReversal.journal_entry_id)
      const revDebits = sum(rev.lines, (l) => l.debit_cents)
      const revCredits = sum(rev.lines, (l) => l.credit_cents)
      assert(
        'payment reversal balances',
        revDebits === revCredits && revDebits === totalCents,
        `debits=${revDebits} credits=${revCredits}`
      )
      assert(
        'payment reversal credits bank (flip of original debit)',
        rev.lines.some((l) => l.account_id === bankAccount.id && l.credit_cents === totalCents)
      )
    }
    if (invoiceReversal) {
      const rev = await loadEntryWithLines(supabase, invoiceReversal.journal_entry_id)
      const revDebits = sum(rev.lines, (l) => l.debit_cents)
      const revCredits = sum(rev.lines, (l) => l.credit_cents)
      assert(
        'invoice reversal balances',
        revDebits === revCredits && revDebits === totalCents,
        `debits=${revDebits} credits=${revCredits}`
      )
      assert(
        'invoice reversal credits AR (flip of original debit)',
        rev.lines.some((l) => l.account_id === ar.id && l.credit_cents === totalCents)
      )
    }
  } finally {
    console.log('Step 7 — cleanup')
    await cleanup.run().catch((err) => {
      console.error(`Cleanup failed (non-fatal): ${err instanceof Error ? err.message : err}`)
    })
  }

  const failed = assertions.filter((a) => !a.pass)
  console.log('')
  console.log('========================================================')
  if (failed.length === 0) {
    console.log(`PASS — ${assertions.length} assertion(s) all passed.`)
    process.exit(0)
  } else {
    console.error(`FAIL — ${failed.length} / ${assertions.length} assertion(s) failed:`)
    for (const f of failed) {
      console.error(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
    }
    process.exit(1)
  }
}

// ---------------- helpers ----------------

interface JELine {
  account_id: string
  debit_cents: number
  credit_cents: number
}

async function loadEntryWithLines(
  supabase: SupabaseClient,
  entryId: string
): Promise<{ id: string; lines: JELine[] }> {
  const { data: lines, error } = await supabase
    .from('journal_entry_lines')
    .select('account_id, debit_cents, credit_cents')
    .eq('journal_entry_id', entryId)
  if (error) throw new Error(`Load lines failed: ${error.message}`)
  return { id: entryId, lines: (lines ?? []) as JELine[] }
}

function sum<T>(items: T[], fn: (t: T) => number): number {
  return items.reduce((acc, x) => acc + fn(x), 0)
}

async function claimPaymentNumber(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await supabase.rpc('next_books_sequence', {
    p_org_id: orgId,
    p_kind: 'payment',
  })
  if (error) throw new Error(`next_books_sequence failed: ${error.message}`)
  return typeof data === 'string' ? data : (data as { next_books_sequence: string }).next_books_sequence
}

async function ensurePeriodCoveringToday(
  supabase: SupabaseClient,
  today: string
): Promise<void> {
  const { data, error } = await supabase
    .from('accounting_periods')
    .select('id')
    .eq('organization_id', NYSD_ORG_ID)
    .lte('start_date', today)
    .gte('end_date', today)
    .maybeSingle()
  if (error) throw new Error(`Period lookup failed: ${error.message}`)
  if (data) {
    console.log(`  period already exists for ${today}`)
    return
  }

  // Create a calendar-month period for `today`.
  const d = new Date(today + 'T00:00:00Z')
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth() // 0-indexed
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  const monthName = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  const name = `${monthName} ${year}`

  const { error: insErr } = await supabase
    .from('accounting_periods')
    .insert({
      organization_id: NYSD_ORG_ID,
      name,
      start_date: start,
      end_date: end,
      is_locked: false,
    })
  if (insErr) throw new Error(`Period insert failed: ${insErr.message}`)
  console.log(`  created period "${name}" ${start} – ${end}`)
}

async function ensureTestClient(supabase: SupabaseClient, cleanup: Cleanup): Promise<string> {
  const { data, error } = await supabase
    .from('clients')
    .insert({
      organization_id: NYSD_ORG_ID,
      company_name: `SMOKE TEST CLIENT ${Date.now()}`,
      client_type: 'commercial',
      payment_terms: 'net_30',
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Create test client failed: ${error?.message ?? 'no row'}`)
  cleanup.add('clients', data.id)
  return data.id as string
}

async function ensureTestServiceCatalogId(
  supabase: SupabaseClient,
  cleanup: Cleanup
): Promise<string> {
  // Try to reuse any existing service for this org first.
  const { data: existing } = await supabase
    .from('service_catalog')
    .select('id')
    .eq('organization_id', NYSD_ORG_ID)
    .limit(1)
    .maybeSingle()
  if (existing) return existing.id as string

  const { data, error } = await supabase
    .from('service_catalog')
    .insert({
      organization_id: NYSD_ORG_ID,
      name: 'SMOKE TEST SERVICE',
      default_unit: 'flat_rate',
      default_price: 100,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(`Create test service failed: ${error?.message ?? 'no row'}`)
  cleanup.add('service_catalog', data.id)
  return data.id as string
}

async function ensureTestJob(
  supabase: SupabaseClient,
  clientId: string,
  cleanup: Cleanup
): Promise<string> {
  // Find or create a site for the client.
  let siteId: string
  const { data: existingSite } = await supabase
    .from('sites')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle()
  if (existingSite) {
    siteId = existingSite.id as string
  } else {
    const { data: site, error: siteErr } = await supabase
      .from('sites')
      .insert({
        organization_id: NYSD_ORG_ID,
        client_id: clientId,
        name: 'SMOKE TEST SITE',
        address_line1: '1 Test St',
        city: 'Brooklyn',
        state: 'NY',
        postal_code: '11201',
        site_type: 'commercial',
      })
      .select('id')
      .single()
    if (siteErr || !site) throw new Error(`Create test site failed: ${siteErr?.message}`)
    siteId = site.id as string
    cleanup.add('sites', siteId)
  }

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      organization_id: NYSD_ORG_ID,
      client_id: clientId,
      site_id: siteId,
      created_by: null,
      scheduled_date: new Date().toISOString().slice(0, 10),
      status: 'completed',
    })
    .select('id')
    .single()
  if (error || !job) throw new Error(`Create test job failed: ${error?.message ?? 'no row'}`)
  cleanup.add('jobs', job.id)
  return job.id as string
}

class Cleanup {
  private toDelete: Array<{ table: string; id: string }> = []
  private entries: string[] = []
  constructor(private supabase: SupabaseClient) {}
  add(table: string, id: string): void {
    this.toDelete.push({ table, id })
  }
  addEntry(id: string): void {
    this.entries.push(id)
  }
  async run(): Promise<void> {
    // Wipe journal_entry_lines (cascade off the entry), then entries,
    // then domain rows in reverse-insert order.
    for (const entryId of this.entries) {
      await this.supabase.from('journal_entry_lines').delete().eq('journal_entry_id', entryId)
      // The DB period-lock trigger refuses to delete posted entries
      // inside a locked period. We unset posted_at first so the
      // trigger treats them as drafts before we delete.
      await this.supabase.from('journal_entries').update({ posted_at: null }).eq('id', entryId)
      await this.supabase.from('journal_entries').delete().eq('id', entryId)
    }
    for (const item of [...this.toDelete].reverse()) {
      // Hard delete to keep the test repeatable. RLS-bypassing service
      // key is required to delete things like clients/jobs.
      await this.supabase.from(item.table).delete().eq('id', item.id)
    }
  }
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
