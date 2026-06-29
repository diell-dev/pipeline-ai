/**
 * /api/books/bills/[id] — read, patch (header-only), soft-delete + reverse.
 */
import { NextRequest, NextResponse } from 'next/server'

import { requireBooksAccess, assertOrgMatch } from '@/lib/books/api-guard'
import {
  softDeleteAndReverse,
  PostingError,
  postBill,
  findExistingActiveEntry,
  reverseJournalEntry,
} from '@/lib/books/posting'

const EDITABLE = [
  'bill_number', 'reference', 'bill_date', 'due_date', 'notes', 'status',
] as const

// Fields that, when changed on an already-posted bill, require the
// existing journal entry to be reversed and a fresh one created so the
// GL matches the bill header. (Notes/reference/bill_number/due_date
// don't move money, so they don't trigger a re-post.)
const POSTING_RELEVANT: readonly string[] = ['bill_date']

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:view')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: bill, error } = await supabase
    .from('bills')
    .select('*, vendor:vendor_id (id, name, email)')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const forbidden = assertOrgMatch(guard, (bill as { organization_id: string }).organization_id)
  if (forbidden) return forbidden

  const { data: lines } = await supabase
    .from('bill_line_items')
    .select('*, account:account_id (id, code, name)')
    .eq('bill_id', id)
    .order('line_number', { ascending: true })

  // Pull associated journal entry (most recent active one).
  const { data: journal } = await supabase
    .from('journal_entries')
    .select('id, entry_number, entry_date, posted_at')
    .eq('source_type', 'bill')
    .eq('source_id', id)
    .is('deleted_at', null)
    .is('reversal_of_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({ bill, lines: lines ?? [], journal })
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('bills').select('id, organization_id, status, locked_at').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; status: string; locked_at: string | null }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden
  if (existing.locked_at) {
    return NextResponse.json({ error: 'Bill is locked' }, { status: 409 })
  }

  let body: Record<string, unknown> = {}
  try { body = (await request.json()) as Record<string, unknown> } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}
  for (const key of EDITABLE) if (key in body) update[key] = body[key]
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No editable fields' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('bills').update(update).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // MB-4: if status just moved out of draft (and not to void), post
  // the journal entry. The bill POST handler only posts when the row
  // is born non-draft; before this fix, draft→open via PATCH wrote the
  // status column and never produced a JE, leaving the bill silently
  // off-books.
  const movedOutOfDraft =
    'status' in update &&
    existing.status === 'draft' &&
    update.status !== 'draft' &&
    update.status !== 'void'

  if (movedOutOfDraft) {
    try {
      await postBill(supabase, id)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'posting failed'
      console.error(`Bill ${id} draft→${update.status} PATCH: postBill failed: ${msg}`)
      // Don't fail the request — the status update already landed.
      // Surface the posting failure so the client can show a warning.
      return NextResponse.json({ bill: data, error: msg, posted: false }, { status: 200 })
    }
  } else {
    // MB-5: if any posting-relevant fields changed AND a JE already
    // exists for this bill, the JE no longer matches the header.
    // Reverse the old entry and post a fresh one.
    const postingChanged = POSTING_RELEVANT.some((k) => k in update)
    const isLive =
      existing.status !== 'draft' &&
      existing.status !== 'void' &&
      (update.status === undefined || (update.status !== 'draft' && update.status !== 'void'))
    if (postingChanged && isLive) {
      try {
        const active = await findExistingActiveEntry(
          supabase,
          existing.organization_id,
          'bill',
          id
        )
        if (active) {
          // Reverse the stale entry (keeps audit trail of the pair),
          // then soft-delete the original so the next postBill() doesn't
          // hit its idempotency cache and skip the re-post. The bill
          // row itself stays live — only the GL needs re-aligning.
          await reverseJournalEntry(
            supabase,
            active.id,
            `Bill ${id} edited (posting-relevant field change)`
          )
          await supabase
            .from('journal_entries')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', active.id)
          await postBill(supabase, id)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'reposting failed'
        console.error(`Bill ${id} re-post after edit failed: ${msg}`)
        return NextResponse.json({ bill: data, error: msg, posted: false }, { status: 200 })
      }
    }
  }

  return NextResponse.json({ bill: data })
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const guard = await requireBooksAccess('bookkeeping:edit')
  if (!guard.ok) return guard.response
  const { supabase } = guard

  const { data: existing } = await supabase
    .from('bills').select('id, organization_id, internal_number').eq('id', id)
    .maybeSingle<{ id: string; organization_id: string; internal_number: string }>()
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const forbidden = assertOrgMatch(guard, existing.organization_id)
  if (forbidden) return forbidden

  try {
    const reversal = await softDeleteAndReverse(
      supabase, 'bills', id, `Deleted bill ${existing.internal_number}`
    )
    return NextResponse.json({ ok: true, reversal })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete bill'
    const code = err instanceof PostingError ? 422 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
