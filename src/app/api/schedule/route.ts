/**
 * GET /api/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns all jobs in the date range (by service_date or scheduled_time)
 * for the calendar view, joined with client/site/assigned_to/crew.
 * Excludes cancelled jobs.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser } from '@/lib/api-auth'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    if (!from || !to) {
      return NextResponse.json(
        { error: 'from and to query parameters required (YYYY-MM-DD)' },
        { status: 400 }
      )
    }

    const supabase = getServiceClient()

    // We use service_date for date-range filtering since scheduled_time may be null
    // for jobs created on-the-fly by techs (without explicit scheduling).
    const { data: jobs, error } = await supabase
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
      .eq('organization_id', auth.organizationId)
      .is('deleted_at', null)
      .neq('status', 'cancelled')
      .gte('service_date', from)
      .lte('service_date', to)
      .order('scheduled_time', { ascending: true, nullsFirst: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ jobs: jobs || [] })
  } catch (err) {
    console.error('GET /api/schedule failed:', err)
    return NextResponse.json({ error: 'Failed to load schedule' }, { status: 500 })
  }
}
