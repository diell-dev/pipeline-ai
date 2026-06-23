/**
 * /api/books/accounts/[id] — read / patch / soft-delete a single account.
 *
 * Deleting an `is_system` account is refused (the RLS policy also blocks
 * it; we surface a friendlier error here). System accounts can still be
 * renamed and deactivated, just not deleted.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forbidden = assertOrgMatch(guard, (data as { organization_id: string }).organization_id)
  if (forbidden) return forbidden
  return NextResponse.json({ account: data })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing, error: loadErr } = await supabase
    .from('chart_of_accounts')
    .select('id, organization_id, is_system')
    .eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; is_system: boolean }>()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Restrict editable columns. System accounts can still rename / deactivate
  // but cannot change type/subtype/code.
  const allowed = existing.is_system
    ? ['name', 'is_active', 'notes', 'parent_account_id']
    : ['name', 'is_active', 'notes', 'parent_account_id', 'code', 'type', 'subtype']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('chart_of_accounts')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ account: data })
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing, error: loadErr } = await supabase
    .from('chart_of_accounts')
    .select('id, organization_id, is_system')
    .eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; is_system: boolean }>()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  if (existing.is_system) {
    return NextResponse.json(
      { error: 'System accounts cannot be deleted; deactivate instead.' },
      { status: 400 }
    )
  }

  const { error } = await supabase
    .from('chart_of_accounts')
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
