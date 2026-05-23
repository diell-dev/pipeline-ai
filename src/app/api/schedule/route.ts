/**
 * GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD[&assigned_to=UUID|&crew_id=UUID]
 *
 * Returns all jobs in the date range (by service_date or scheduled_time)
 * for the calendar view, joined with client/site/assigned_to/crew.
 * Excludes cancelled jobs.
 *
 * Optional filters:
 *   - assigned_to=UUID  — only jobs assigned to this user
 *   - crew_id=UUID      — only jobs assigned to this crew
 * Only one of the two may be present per request (400 otherwise).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getApiUser } from '@/lib/api-auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const assignedTo = url.searchParams.get('assigned_to')
    const crewId = url.searchParams.get('crew_id')

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from and to query parameters required (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    if (assignedTo && crewId) {
      return NextResponse.json(
        { error: 'Provide only one of assigned_to or crew_id, not both' },
        { status: 400 }
      )
    }
    if (assignedTo && !UUID_RE.test(assignedTo)) {
      return NextResponse.json({ error: 'assigned_to must be a valid UUID' }, { status: 400 })
    }
    if (crewId && !UUID_RE.test(crewId)) {
      return NextResponse.json({ error: 'crew_id must be a valid UUID' }, { status: 400 })
    }

    // Cap the date range so a stray request can't pull years of data.
    // 92 days covers the longest reasonable calendar view (a quarter).
    const fromDate = new Date(from + 'T00:00:00Z')
    const toDate = new Date(to + 'T00:00:00Z')
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return NextResponse.json(
        { error: 'from and to must be valid YYYY-MM-DD dates' },
        { status: 400 }
      )
    }
    const dayMs = 24 * 60 * 60 * 1000
    const rangeDays = Math.round((toDate.getTime() - fromDate.getTime()) / dayMs)
    if (rangeDays < 0 || rangeDays > 92) {
      return NextResponse.json(
        { error: 'Date range too large; max 92 days' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // We use service_date for date-range filtering since scheduled_time may be null
    // for jobs created on-the-fly by techs (without explicit scheduling).
    //
    // TODO(timezone): service_date is a plain DATE column (no timezone), populated
    // from the browser's local date when the job was created. scheduled_time is a
    // TIMESTAMPTZ stored in UTC. A job at 11pm local Sunday with scheduled_time of
    // 4am Monday UTC will show on Sunday in the jobs list (filtered by service_date)
    // but on Monday in calendar views derived from scheduled_time. Real fix:
    // add a service_date_local column derived from org timezone, or always derive
    // service_date from scheduled_time using the org's stored TZ.
    const isSuperAdmin = auth.role === 'super_admin'
    let jobsQ = supabase
      .from('jobs')
      .select(`
        id, organization_id, client_id, site_id, status, priority,
        service_date, scheduled_time, scheduled_end_time, estimated_duration_minutes,
        assigned_to, crew_id, recurring_schedule_id,
        clients:client_id ( id, company_name ),
        sites:site_id ( id, name, address ),
        assigned_user:assigned_to ( id, full_name, avatar_url ),
        crew:crew_id ( id, name, color )
      `)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .gte('service_date', from)
      .lte('service_date', to)
      .order('scheduled_time', { ascending: true, nullsFirst: false })
      .limit(2000)
    if (!isSuperAdmin) jobsQ = jobsQ.eq('organization_id', auth.organizationId)
    if (assignedTo) jobsQ = jobsQ.eq('assigned_to', assignedTo)
    if (crewId) jobsQ = jobsQ.eq('crew_id', crewId)
    const { data: jobs, error } = await jobsQ

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ jobs: jobs || [] })
  } catch (err) {
    console.error('GET /api/schedule failed:', err)
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })
  }
}
