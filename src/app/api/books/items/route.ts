/**
 * /api/books/items — list / create catalog items (the bookkeeping catalog
 * used by invoice + bill line items).
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'
import { dollarsToCents } from '@/lib/books/format'

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('items')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const type = (body.type as string) || 'service'
  if (!['service', 'product', 'bundle'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 })
  }

  // Accept either cents directly or a dollar amount.
  const priceCents = typeof body.default_unit_price_cents === 'number'
    ? body.default_unit_price_cents
    : dollarsToCents(body.default_unit_price as string | number | null | undefined)

  const insert: Record<string, unknown> = {
    organization_id: organizationId,
    name,
    description: body.description ?? null,
    type,
    sku: body.sku ?? null,
    default_unit_price_cents: priceCents,
    default_income_account_id: body.default_income_account_id ?? null,
    default_expense_account_id: body.default_expense_account_id ?? null,
    default_tax_rate_id: body.default_tax_rate_id ?? null,
    is_billable: body.is_billable == null ? true : !!body.is_billable,
    is_active: body.is_active == null ? true : !!body.is_active,
  }

  const { data, error } = await supabase.from('items').insert(insert).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ item: data }, { status: 201 })
}
