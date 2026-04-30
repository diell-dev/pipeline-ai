/**
 * /api/recurring-schedules
 *
 * GET — list recurring schedules for the org
 * POST — create a new recurring pattern (managers+)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getApiUser, apiHasPermission } from '@/lib/api-auth'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ── GET ──────────────────────────────────────────────────────
export async function GET() {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const supabase = getServiceClient()
    const { data: schedules, error } = await supabase
      .from('recurring_job_schedules')
      .select(`
        *,
        clients:client_id ( id, company_name ),
        sites:site_id ( id, name, address ),
        assigned_user:assigned_to ( id, full_name ),
        crew:crew_id ( id, name, color )
      `)
      .eq('organization_id', auth.organizationId)
      .order('next_occurrence_date', { ascending: true })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ schedules: schedules || [] })
  } catch (err) {
    console.error('GET /api/recurring-schedules failed:', err)
    return NextResponse.json({ error: 'Failed to load schedules' }, { status: 500 })
  }
}

// ── POST ─────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = await getApiUser()
    if (!auth.authenticated) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }
    if (!apiHasPermission(auth.role, 'recurring:manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const {
      client_id,
      site_id,
      assigned_to,
      crew_id,
      frequency,
      day_of_week,
      day_of_month,
      scheduled_time,
      estimated_duration_minutes,
      service_ids,
      advance_creation_days,
      next_occurrence_date,
      notes,
    } = body as {
      client_id?: string
      site_id?: string
      assigned_to?: string | null
      crew_id?: string | null
      frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly'
      day_of_week?: number[]
      day_of_month?: number | null
      scheduled_time?: string
      estimated_duration_minutes?: number
      service_ids?: string[]
      advance_creation_days?: number
      next_occurrence_date?: string
      notes?: string | null
    }

    if (!client_id || !site_id) {
      return NextResponse.json({ error: 'client_id and site_id are required' }, { status: 400 })
    }
    if (!frequency) {
      return NextResponse.json({ error: 'frequency is required' }, { status: 400 })
    }
    if (!scheduled_time) {
      return NextResponse.json({ error: 'scheduled_time is required (HH:MM:SS)' }, { status: 400 })
    }
    if (!next_occurrence_date) {
      return NextResponse.json({ error: 'next_occurrence_date is required (YYYY-MM-DD)' }, { status: 400 })
    }

    const supabase = getServiceClient()

    const { data: schedule, error } = await supabase
      .from('recurring_job_schedules')
      .insert({
        organization_id: auth.organizationId,
        client_id,
        site_id,
        assigned_to: assigned_to || null,
        crew_id: crew_id || null,
        created_by: auth.userId,
        frequency,
        day_of_week: day_of_week || [],
        day_of_month: day_of_month ?? null,
        scheduled_time,
        estimated_duration_minutes: estimated_duration_minutes || 60,
        service_ids: service_ids || [],
        advance_creation_days: advance_creation_days ?? 7,
        next_occurrence_date,
        is_active: true,
        notes: notes || null,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await supabase.from('activity_log').insert({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      action: 'recurring_schedule_created',
      entity_type: 'job',
      entity_id: schedule.id,
      metadata: { client_id, site_id, frequency },
    })

    return NextResponse.json({ schedule }, { status: 201 })
  } catch (err) {
    console.error('POST /api/recurring-schedules failed:', err)
    return NextResponse.json({ error: 'Failed to create schedule' }, { status: 500 })
  }
}
