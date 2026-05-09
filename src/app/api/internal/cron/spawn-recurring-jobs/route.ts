/**
 * POST /api/internal/cron/spawn-recurring-jobs
 *
 * Daily cron — scans recurring_job_schedules and creates upcoming Job rows
 * `advance_creation_days` ahead of each pattern's next_occurrence_date.
 *
 * Designed to be called by Vercel Cron once a day. Idempotent: re-running
 * the same day is safe — if a job already exists for a (recurring_schedule_id,
 * service_date) pair we skip it.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel Cron sends this
 * automatically when CRON_SECRET is set as an env var.
 *
 * Returns:
 *   { spawned: number, advanced: number, skipped: number, errors: [...] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Service-role: this is a system route, runs across all orgs.
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE env vars')
  }
  return createServiceClient(url, serviceKey)
}

// Force Node.js runtime (Edge can't run for the time we need).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel Hobby max is 60s; this cron is fast even at thousands of patterns.
export const maxDuration = 60

interface RecurringSchedule {
  id: string
  organization_id: string
  client_id: string
  site_id: string
  assigned_to: string | null
  crew_id: string | null
  created_by: string
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly'
  day_of_week: number[]
  day_of_month: number | null
  scheduled_time: string  // HH:MM:SS
  estimated_duration_minutes: number
  service_ids: string[]
  advance_creation_days: number
  next_occurrence_date: string  // YYYY-MM-DD
  is_active: boolean
  paused_until: string | null
  notes: string | null
}

interface ServiceCatalogItem {
  id: string
  name: string
  default_price: number
  unit: string
  organization_id: string
}

export async function POST(request: NextRequest) {
  // ── Auth check (CRON_SECRET) ──
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET || ''}`
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const errors: Array<{ schedule_id: string; error: string }> = []
  let spawned = 0
  let advanced = 0
  let skipped = 0

  try {
    // Fetch active patterns whose next_occurrence_date is within their
    // advance_creation_days window. We compare against today + 14 days as a
    // safe upper bound, then filter precisely below per-row using the
    // schedule's own advance_creation_days.
    const horizon = new Date()
    horizon.setUTCDate(horizon.getUTCDate() + 14)
    const horizonStr = horizon.toISOString().slice(0, 10)

    const { data: schedules, error: scheduleErr } = await supabase
      .from('recurring_job_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('next_occurrence_date', horizonStr)
      .or(`paused_until.is.null,paused_until.lt.${today}`)
      .returns<RecurringSchedule[]>()

    if (scheduleErr) throw new Error(`fetch schedules: ${scheduleErr.message}`)

    for (const schedule of schedules || []) {
      try {
        // Only spawn if next_occurrence_date is within this pattern's
        // own advance window. (We pre-filtered to a safe upper bound; this
        // is the precise check.)
        const advanceDate = new Date()
        advanceDate.setUTCDate(advanceDate.getUTCDate() + (schedule.advance_creation_days || 7))
        const advanceStr = advanceDate.toISOString().slice(0, 10)
        if (schedule.next_occurrence_date > advanceStr) {
          continue
        }

        // Idempotency check — has a job already been spawned for this
        // pattern + date? (Two cron runs in one day shouldn't dupe.)
        const { data: existing } = await supabase
          .from('jobs')
          .select('id')
          .eq('recurring_schedule_id', schedule.id)
          .eq('service_date', schedule.next_occurrence_date)
          .is('deleted_at', null)
          .maybeSingle()

        if (existing) {
          skipped++
          // Still advance the next_occurrence_date so we don't loop
          await advanceNext(supabase, schedule)
          advanced++
          continue
        }

        // Fetch service catalog rows for the configured service_ids — we use
        // these for pricing on the spawned job's line items.
        let services: ServiceCatalogItem[] = []
        if (schedule.service_ids && schedule.service_ids.length > 0) {
          const { data: svcRows } = await supabase
            .from('service_catalog')
            .select('id, name, default_price, unit, organization_id')
            .in('id', schedule.service_ids)
            .eq('organization_id', schedule.organization_id)
            .eq('is_active', true)
            .returns<ServiceCatalogItem[]>()
          services = svcRows || []
        }

        // Compose scheduled_time as a UTC timestamptz from service_date + scheduled_time.
        // The TZ caveat documented elsewhere applies here too.
        const scheduledTime = `${schedule.next_occurrence_date}T${schedule.scheduled_time}`
        const endTime = new Date(scheduledTime)
        endTime.setMinutes(endTime.getMinutes() + (schedule.estimated_duration_minutes || 60))

        // Insert the job
        const { data: newJob, error: jobErr } = await supabase
          .from('jobs')
          .insert({
            organization_id: schedule.organization_id,
            client_id: schedule.client_id,
            site_id: schedule.site_id,
            submitted_by: schedule.created_by,    // recorded as the pattern's creator
            assigned_to: schedule.assigned_to,
            crew_id: schedule.crew_id,
            recurring_schedule_id: schedule.id,
            status: 'scheduled',
            priority: 'normal',
            service_date: schedule.next_occurrence_date,
            scheduled_time: scheduledTime,
            scheduled_end_time: endTime.toISOString(),
            estimated_duration_minutes: schedule.estimated_duration_minutes,
            scheduled_by: schedule.created_by,
            tech_notes: schedule.notes
              ? `Recurring schedule: ${schedule.notes}`
              : null,
            photos: [],
          })
          .select('id')
          .single()

        if (jobErr) throw new Error(`insert job: ${jobErr.message}`)

        // Populate job_line_items from the configured services
        if (services.length > 0 && newJob) {
          const lineItems = services.map((svc) => ({
            job_id: newJob.id,
            service_catalog_id: svc.id,
            service_name: svc.name,
            quantity: 1,
            unit_price: Number(svc.default_price) || 0,
            total_price: Number(svc.default_price) || 0,
          }))
          const { error: liErr } = await supabase
            .from('job_line_items')
            .insert(lineItems)
          if (liErr) {
            console.warn(
              `[cron] line items failed for job ${newJob.id}: ${liErr.message}`
            )
          }
        }

        // Activity log
        await supabase.from('activity_log').insert({
          organization_id: schedule.organization_id,
          user_id: null,                          // system action
          action: 'job_scheduled',
          entity_type: 'job',
          entity_id: newJob?.id,
          metadata: {
            source: 'recurring_schedule',
            recurring_schedule_id: schedule.id,
            service_date: schedule.next_occurrence_date,
          },
        })

        spawned++

        // Advance next_occurrence_date to the next occurrence in the pattern
        await advanceNext(supabase, schedule)
        advanced++
      } catch (rowErr) {
        const msg = rowErr instanceof Error ? rowErr.message : String(rowErr)
        console.error(`[cron] schedule ${schedule.id} failed:`, msg)
        errors.push({ schedule_id: schedule.id, error: msg })
      }
    }

    return NextResponse.json({
      spawned,
      advanced,
      skipped,
      errors,
      ranAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron] spawn-recurring-jobs failed:', msg)
    return NextResponse.json(
      { error: 'Cron run failed', detail: msg },
      { status: 500 }
    )
  }
}

// Allow GET as well so it's easy to test in the browser (still requires auth).
export async function GET(request: NextRequest) {
  return POST(request)
}

/**
 * Compute the NEXT occurrence date based on the pattern frequency and
 * persist it on the schedule row.
 */
async function advanceNext(
  supabase: ReturnType<typeof getServiceClient>,
  schedule: RecurringSchedule
) {
  const current = new Date(schedule.next_occurrence_date + 'T00:00:00Z')
  let nextDate = new Date(current)

  switch (schedule.frequency) {
    case 'daily':
      nextDate.setUTCDate(nextDate.getUTCDate() + 1)
      break
    case 'weekly':
      nextDate = nextWeekdayInPattern(current, schedule.day_of_week, 7)
      break
    case 'biweekly':
      nextDate = nextWeekdayInPattern(current, schedule.day_of_week, 14)
      break
    case 'monthly':
      // Same day-of-month next month. Cap to last day if the next month is shorter.
      nextDate = new Date(current)
      nextDate.setUTCMonth(nextDate.getUTCMonth() + 1)
      const targetDom = schedule.day_of_month || current.getUTCDate()
      const lastDayOfNextMonth = new Date(
        Date.UTC(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, 0)
      ).getUTCDate()
      nextDate.setUTCDate(Math.min(targetDom, lastDayOfNextMonth))
      break
  }

  const nextStr = nextDate.toISOString().slice(0, 10)
  await supabase
    .from('recurring_job_schedules')
    .update({ next_occurrence_date: nextStr, updated_at: new Date().toISOString() })
    .eq('id', schedule.id)
}

/**
 * Given a starting date and an array of day-of-week ints (0=Sun..6=Sat),
 * find the next date that matches one of those days, skipping `intervalDays`
 * if the current date already matched (used for biweekly).
 */
function nextWeekdayInPattern(
  from: Date,
  daysOfWeek: number[],
  intervalDays: number
): Date {
  const sortedDays = (daysOfWeek && daysOfWeek.length > 0 ? daysOfWeek : [from.getUTCDay()])
    .slice()
    .sort((a, b) => a - b)

  // Step day-by-day until we hit a matching weekday at least 1 day after `from`.
  // For biweekly with one weekday, we need to advance ~14 days. For weekly with
  // multiple weekdays, we just step until the next matching one (within the week).
  for (let step = 1; step <= intervalDays * 2; step++) {
    const candidate = new Date(from)
    candidate.setUTCDate(candidate.getUTCDate() + step)
    const dow = candidate.getUTCDay()
    if (sortedDays.includes(dow)) {
      // For biweekly with sparse days, ensure we've crossed the interval.
      if (intervalDays === 14 && step < 8) continue
      return candidate
    }
  }

  // Fallback — should never hit, but advance by interval days.
  const fallback = new Date(from)
  fallback.setUTCDate(fallback.getUTCDate() + intervalDays)
  return fallback
}

