/**
 * GET /api/team
 *
 * Lists active users in the caller's organization (excluding clients).
 * Used by the schedule-work-order picker, crew builder, etc. Super-admin
 * sees all orgs.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'
import { hasPermission } from '@/lib/permissions'

export async function GET() {
  const auth = await getApiUser()
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Restrict to dispatchers+ — the team list contains emails and is used by
  // scheduling/assignment UI, not by general users.
  if (!hasPermission(auth.role, 'jobs:create')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = await createClient()
  let q = supabase
    .from('users')
    .select('id, full_name, role, email, avatar_url, organization_id')
    .eq('is_active', true)
    .neq('role', 'client')
    .order('full_name', { ascending: true })

  if (auth.role !== 'super_admin') {
    q = q.eq('organization_id', auth.organizationId)
  }

  const { data, error } = await q.limit(500)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ users: data || [] })
}
