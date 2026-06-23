/**
 * /api/books/accounts — chart of accounts CRUD.
 *
 * GET: list every account for the org, sorted by code.
 * POST: create a new (non-system) account.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'

interface CreateBody {
  code?: unknown
  name?: unknown
  type?: unknown
  subtype?: unknown
  parent_account_id?: unknown
  notes?: unknown
}

const VALID_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const
const VALID_SUBTYPES = [
  'current_asset', 'non_current_asset', 'contra_asset', 'fixed_asset',
  'accounts_receivable', 'bank', 'cash',
  'current_liability', 'long_term_liability', 'accounts_payable',
  'equity', 'retained_earnings', 'contra_equity',
  'operating_income', 'other_income', 'contra_revenue',
  'cogs', 'operating_expense', 'other_expense', 'depreciation_expense',
] as const

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('code', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ accounts: data ?? [] })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  let body: CreateBody = {}
  try { body = (await request.json()) as CreateBody } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const code = typeof body.code === 'string' ? body.code.trim() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = body.type as string
  const subtype = body.subtype as string

  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!VALID_TYPES.includes(type as never)) {
    return NextResponse.json({ error: 'invalid account type' }, { status: 400 })
  }
  if (!VALID_SUBTYPES.includes(subtype as never)) {
    return NextResponse.json({ error: 'invalid account subtype' }, { status: 400 })
  }

  const insert: Record<string, unknown> = {
    organization_id: organizationId,
    code,
    name,
    type,
    subtype,
    is_system: false,
    is_active: true,
  }
  if (typeof body.parent_account_id === 'string' && body.parent_account_id) {
    insert.parent_account_id = body.parent_account_id
  }
  if (typeof body.notes === 'string') insert.notes = body.notes

  const { data, error } = await supabase
    .from('chart_of_accounts')
    .insert(insert)
    .select('*')
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `Account code ${code} already exists` },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ account: data }, { status: 201 })
}
