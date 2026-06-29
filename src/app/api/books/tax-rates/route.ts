/**
 * /api/books/tax-rates — list active tax rates for the current org.
 *
 * Used by the line-items editor on invoice + bill creation to populate
 * the per-line tax dropdown. Read-only for now; CRUD lives in the books
 * settings page (out of scope for this endpoint).
 */
import { NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('tax_rates')
    .select('id, name, rate_pct, is_compound, is_active')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('rate_pct', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ tax_rates: data ?? [] })
}
