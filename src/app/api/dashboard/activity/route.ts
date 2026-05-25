/**
 * GET /api/dashboard/activity
 *
 * Returns the most recent activity_log entries for the dashboard "Recent
 * Activity" timeline. Scoped to the caller's organization (super_admin sees
 * all orgs, matching the rest of the dashboard).
 *
 * Query params:
 *   limit  number 1–25, default 10
 *
 * Response:
 *   {
 *     entries: Array<{
 *       id, action, entity_type, entity_id,
 *       userName,           // full name of the actor (or 'System')
 *       metadata,           // raw metadata jsonb (may be null)
 *       createdAt           // ISO timestamp
 *     }>
 *   }
 *
 * Notes:
 *   - We intentionally don't deep-join entity rows here; the UI builds the
 *     deep-link from entity_type + entity_id and surfaces the action label
 *     from a local config. Joining each entity would double the round-trips
 *     without materially improving the timeline copy.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 25

interface ActivityRow {
  id: string
  action: string
  entity_type: string
  entity_id: string
  metadata: Record<string, unknown> | null
  created_at: string
  user: { full_name: string }[] | { full_name: string } | null
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const { searchParams } = new URL(request.url)
    const rawLimit = parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10)
    const limit = Number.isFinite(rawLimit)
      ? Math.min(MAX_LIMIT, Math.max(1, rawLimit))
      : DEFAULT_LIMIT

    const supabase = await createClient()
    const isSuperAdmin = auth.role === 'super_admin'

    let q = supabase
      .from('activity_log')
      .select(
        'id, action, entity_type, entity_id, metadata, created_at, user:user_id ( full_name )'
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!isSuperAdmin) q = q.eq('organization_id', auth.organizationId)

    const { data, error } = await q
    if (error) {
      console.error('activity_log fetch failed:', error.message)
      return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
    }

    const entries = ((data || []) as ActivityRow[]).map((row) => {
      let userName = 'System'
      if (Array.isArray(row.user) && row.user.length > 0) {
        userName = row.user[0].full_name
      } else if (row.user && !Array.isArray(row.user)) {
        userName = row.user.full_name
      }
      return {
        id: row.id,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        metadata: row.metadata,
        createdAt: row.created_at,
        userName,
      }
    })

    return NextResponse.json({ entries })
  } catch (err) {
    console.error('Dashboard activity route failed:', err)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
}
