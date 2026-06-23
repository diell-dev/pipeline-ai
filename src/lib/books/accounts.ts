/**
 * Pipeline AI — Bookkeeping Account Lookups
 *
 * Helpers for resolving chart_of_accounts rows by code (the stable
 * per-org identifier seeded in migration 015). Posting helpers in
 * `./posting.ts` use these to translate a transaction into the right
 * GL accounts without ever hard-coding UUIDs.
 *
 * The "STANDARD_ACCOUNTS" constants must match
 * seed_default_chart_of_accounts() in migration 015. If you change
 * codes there, change them here.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Standard account code map
// ============================================================
// Codes seeded by migration 015's seed_default_chart_of_accounts().
// Every org that enables books has these rows with is_system=TRUE.
// If a user deactivates a system account (is_active=FALSE) the
// posting helpers will throw — they refuse to silently fall back.
export const STANDARD_ACCOUNTS = {
  // Assets
  CASH: '1000',
  OPERATING_BANK: '1010',
  SAVINGS: '1020',
  AR: '1100',
  INVENTORY: '1200',
  PREPAID: '1300',
  EQUIPMENT: '1400',
  ACCUMULATED_DEPRECIATION: '1410',

  // Liabilities
  AP: '2000',
  CREDIT_CARD: '2100',
  SALES_TAX: '2200',
  PAYROLL_TAX: '2300',
  NOTES_PAYABLE: '2400',

  // Equity
  OWNERS_EQUITY: '3000',
  RETAINED_EARNINGS: '3100',
  OWNERS_DRAWINGS: '3200',

  // Income
  SERVICE_REVENUE: '4000',
  PRODUCT_SALES: '4100',
  OTHER_INCOME: '4200',
  SALES_RETURNS: '4900',

  // COGS / expense
  COGS: '5000',
  MATERIALS: '5100',
  SUBCONTRACTORS: '5200',
  SALARIES: '6000',
  RENT: '6100',
  UTILITIES: '6200',
  INSURANCE: '6300',
  VEHICLE: '6400',
  FUEL: '6500',
  TOOLS_EQUIPMENT: '6600',
  OFFICE_SUPPLIES: '6700',
  PROFESSIONAL_FEES: '6800',
  MARKETING: '6900',
  SOFTWARE: '7000',
  BANK_FEES: '7100',
  DEPRECIATION: '7200',
  REPAIRS: '7300',
  MISCELLANEOUS: '7900',
} as const

export type StandardAccountCode =
  (typeof STANDARD_ACCOUNTS)[keyof typeof STANDARD_ACCOUNTS]

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface ChartAccountRow {
  id: string
  organization_id: string
  code: string
  name: string
  type: AccountType
  subtype: string
  is_system: boolean
  is_active: boolean
  deleted_at: string | null
}

export class AccountLookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountLookupError'
  }
}

// ============================================================
// getAccountByCode
// ============================================================
/**
 * Fetch a single chart_of_accounts row by org + code. Returns the
 * row or throws. Used by posting helpers; never returns null because
 * a missing account at posting time is a hard failure (we want the
 * caller to see the error, not silently skip).
 */
export async function getAccountByCode(
  supabase: SupabaseClient,
  orgId: string,
  code: string
): Promise<ChartAccountRow> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, organization_id, code, name, type, subtype, is_system, is_active, deleted_at')
    .eq('organization_id', orgId)
    .eq('code', code)
    .is('deleted_at', null)
    .maybeSingle<ChartAccountRow>()

  if (error) {
    throw new AccountLookupError(
      `Failed to look up account ${code} for org ${orgId}: ${error.message}`
    )
  }
  if (!data) {
    throw new AccountLookupError(
      `Account code "${code}" not found for org ${orgId}. ` +
        `Has seed_default_chart_of_accounts() been run for this org?`
    )
  }
  if (!data.is_active) {
    throw new AccountLookupError(
      `Account "${code}" (${data.name}) is inactive — reactivate it before posting.`
    )
  }

  return data
}

// ============================================================
// getAccountById
// ============================================================
/**
 * Fetch a single chart_of_accounts row by id. Used when a parent row
 * already carries an account_id and we want to validate it. Throws
 * if missing or inactive.
 */
export async function getAccountById(
  supabase: SupabaseClient,
  accountId: string
): Promise<ChartAccountRow> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('id, organization_id, code, name, type, subtype, is_system, is_active, deleted_at')
    .eq('id', accountId)
    .is('deleted_at', null)
    .maybeSingle<ChartAccountRow>()

  if (error) {
    throw new AccountLookupError(
      `Failed to look up account ${accountId}: ${error.message}`
    )
  }
  if (!data) {
    throw new AccountLookupError(`Account ${accountId} not found or deleted.`)
  }
  if (!data.is_active) {
    throw new AccountLookupError(
      `Account "${data.code}" (${data.name}) is inactive — reactivate it before posting.`
    )
  }

  return data
}

// ============================================================
// getOrCreateSystemAccount
// ============================================================
/**
 * Fetch a system account by code; if the row exists but is inactive
 * (rare — only happens if a user deactivated it), reactivate it and
 * return it. If the row is missing entirely, seed it from the
 * STANDARD_ACCOUNTS map by re-invoking the catalog. Useful for repair
 * paths where we need the system account back regardless of what the
 * user did.
 *
 * Requires the caller's Supabase client to have rights to UPDATE/
 * INSERT chart_of_accounts (typically service-role or owner-level).
 */
export async function getOrCreateSystemAccount(
  supabase: SupabaseClient,
  orgId: string,
  code: StandardAccountCode | string
): Promise<ChartAccountRow> {
  // 1. Try the active path first.
  try {
    return await getAccountByCode(supabase, orgId, code)
  } catch (err) {
    if (!(err instanceof AccountLookupError)) throw err
    // fall through — we'll attempt to repair below
  }

  // 2. Re-seed the standard chart for this org (idempotent server-side).
  const { error: seedError } = await supabase.rpc('seed_default_chart_of_accounts', {
    p_org_id: orgId,
  })
  if (seedError) {
    throw new AccountLookupError(
      `Failed to re-seed default chart of accounts for org ${orgId}: ${seedError.message}`
    )
  }

  // 3. Reactivate any inactive row with this code.
  const { error: updateError } = await supabase
    .from('chart_of_accounts')
    .update({ is_active: true, deleted_at: null })
    .eq('organization_id', orgId)
    .eq('code', code)
  if (updateError) {
    throw new AccountLookupError(
      `Failed to reactivate account ${code} for org ${orgId}: ${updateError.message}`
    )
  }

  // 4. Now it must exist + be active.
  return getAccountByCode(supabase, orgId, code)
}
