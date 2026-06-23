/**
 * /api/books/periods — list / create accounting periods.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess } from '@/lib/books/api-guard'

export async function GET() {
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  const { data, error } = await supabase
    .from('accounting_periods')
    .select('*')
    .eq('organization_id', organizationId)
    .order('start_date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ periods: data ?? [] })
}

export async function POST(request: NextRequest) {
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase, organizationId } = guard

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name : ''
  const start = typeof body.start_date === 'string' ? body.start_date : ''
  const end = typeof body.end_date === 'string' ? body.end_date : ''
  if (!name || !start || !end) {
    return NextResponse.json({ error: 'name, start_date, end_date required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('accounting_periods')
    .insert({ organization_id: organizationId, name, start_date: start, end_date: end })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ period: data }, { status: 201 })
}
