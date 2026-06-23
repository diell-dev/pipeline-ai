/**
 * /api/books/vendors — list / create vendors.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('organization_id', organizationId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ vendors: data ?? [] })
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

  const insert: Record<string, unknown> = {
    organization_id: organizationId,
    name,
    contact_name: body.contact_name ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    address_line1: body.address_line1 ?? null,
    address_line2: body.address_line2 ?? null,
    city: body.city ?? null,
    state: body.state ?? null,
    postal_code: body.postal_code ?? null,
    country: body.country ?? 'US',
    tax_id: body.tax_id ?? null,
    w9_on_file: !!body.w9_on_file,
    is_1099_vendor: !!body.is_1099_vendor,
    payment_terms_days: typeof body.payment_terms_days === 'number' ? body.payment_terms_days : 30,
    default_expense_account_id: body.default_expense_account_id ?? null,
    notes: body.notes ?? null,
  }

  const { data, error } = await supabase.from('vendors').insert(insert).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ vendor: data }, { status: 201 })
}
