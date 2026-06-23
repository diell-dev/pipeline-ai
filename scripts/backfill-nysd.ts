/**
 * Pipeline AI — B6 NYSD Books Backfill
 *
 * One-shot script run during Books activation for New York Sewer &
 * Drain (org b0000000-0000-0000-0000-000000000001). Walks the org's
 * existing invoices + payments + bills + expenses and creates the
 * journal entries that should have been written when each row was
 * originally saved.
 *
 * Idempotent: re-running is safe; each posting helper skips rows that
 * already have an active (non-reversed, non-deleted) journal entry.
 *
 * Run with:
 *   NEXT_PUBLIC_SUPABASE_URL=https://... \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   npx jiti scripts/backfill-nysd.ts
 *
 * Exits 0 on success, 1 if the backfill reports any per-row errors,
 * 2 when env credentials are missing.
 */
import { createClient } from '@supabase/supabase-js'

import { backfillJournalEntriesForOrg } from '../src/lib/books/backfill'

const NYSD_ORG_ID = 'b0000000-0000-0000-0000-000000000001'

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || url.includes('placeholder') || serviceKey === 'placeholder') {
    console.error(
      'Missing real Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    )
    process.exit(2)
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log(`Target org: ${NYSD_ORG_ID}`)

  // Pre-backfill snapshot
  const { count: beforeCount, error: beforeErr } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', NYSD_ORG_ID)
    .is('deleted_at', null)
  if (beforeErr) {
    console.error(`Pre-snapshot failed: ${beforeErr.message}`)
    process.exit(1)
  }
  console.log(`Existing active journal entries before backfill: ${beforeCount ?? 0}`)

  console.log('Running backfillJournalEntriesForOrg ...')
  const stats = await backfillJournalEntriesForOrg(supabase, NYSD_ORG_ID)

  console.log('\nBackfill stats:')
  console.log(JSON.stringify(stats, null, 2))

  // Post-backfill snapshot
  const { count: afterCount, error: afterErr } = await supabase
    .from('journal_entries')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', NYSD_ORG_ID)
    .is('deleted_at', null)
  if (afterErr) {
    console.error(`Post-snapshot failed: ${afterErr.message}`)
    process.exit(1)
  }
  console.log(`Active journal entries after backfill: ${afterCount ?? 0}`)

  const totalErrors =
    stats.invoices.errors.length +
    stats.bills.errors.length +
    stats.payments.errors.length +
    stats.expenses.errors.length

  if (totalErrors > 0) {
    console.error(`\n${totalErrors} per-row error(s) reported above. Exiting 1.`)
    process.exit(1)
  }

  console.log('\nBackfill complete with no per-row errors.')
}

main().catch((err) => {
  console.error('Backfill crashed:', err)
  process.exit(1)
})
