/**
 * POST /api/books/periods/[id]/lock — lock or unlock a period.
 *
 * Requires the `bookkeeping:lock_period` permission (owner / super_admin
 * only; office_managers cannot lock periods).
 *
 * Body: { locked: boolean }
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:lock_period')
  if (!guard.ok) return guard.response
  const { supabase, userId } = guard

  let body: { locked?: unknown } = {}
  try { body = (await request.json()) as { locked?: unknown } } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const lock = body.locked !== false

  const { data: existing } = await supabase
    .from('accounting_periods')
    .select('id, organization_id')
    .eq('id', id)
    .maybeSingle<{ id: string; organization_id: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  const update = lock
    ? { is_locked: true, locked_at: new Date().toISOString(), locked_by: userId }
    : { is_locked: false, locked_at: null, locked_by: null }

  const { data, error } = await supabase
    .from('accounting_periods')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ period: data })
}
